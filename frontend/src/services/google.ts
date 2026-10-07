import { diagnostics, driveOperation } from "./performance";
import { ClientError } from "./errors";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  scope?: string;
}
export interface GoogleOAuth {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void;
    error_callback: () => void;
  }): { requestAccessToken(options: { prompt: string }): void };
  hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
  revoke(
    token: string,
    callback: (result: { successful: boolean }) => void,
  ): void;
}
declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth } };
  }
}

let scriptLoading: Promise<GoogleOAuth> | undefined;
export function loadGoogleOAuth(): Promise<GoogleOAuth> {
  if (window.google?.accounts.oauth2)
    return Promise.resolve(window.google.accounts.oauth2);
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<GoogleOAuth>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.referrerPolicy = "no-referrer";
    const timer = setTimeout(fail, 15000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      reject(new ClientError("GOOGLE_SCRIPT_FAILED"));
    }
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      const oauth = window.google?.accounts.oauth2;
      if (oauth) resolve(oauth);
      else fail();
    };
    document.head.append(script);
  }).catch((error) => {
    scriptLoading = undefined;
    throw error;
  });
  return scriptLoading;
}

export type AuthStatus =
  "signed-out" | "authorizing" | "connected" | "expired" | "error";
export interface AuthState {
  status: AuthStatus;
  error?: string;
}
interface RequestOptions extends RequestInit {
  format?: "json" | "blob";
}
export interface GoogleResult<T> {
  data: T;
  etag: string | null;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ClientError("CONTEXT_CHANGED"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new ClientError("CONTEXT_CHANGED"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Tokens are never exposed through observable state, storage, logs or API-client calls.
export class GoogleAuthService {
  #token: string | undefined;
  #expires = 0;
  #generation = 0;
  #controllers = new Set<AbortController>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: ((error: ClientError) => void) | undefined;
  #active = 0;
  #slots = new Set<() => void>();
  #state: AuthState = { status: "signed-out" };
  private listeners = new Set<() => void>();
  constructor(
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
    private readonly now = Date.now,
  ) {}

  get state(): AuthState {
    return this.#state;
  }
  get generation(): number {
    return this.#generation;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: AuthState) {
    this.#state = state;
    for (const listener of this.listeners) listener();
  }
  assertCurrent(generation: number) {
    if (generation !== this.#generation)
      throw new ClientError("CONTEXT_CHANGED");
    if (!this.#token || this.now() >= this.#expires) {
      this.clear("expired");
      throw new ClientError("AUTH_REQUIRED");
    }
  }
  cancelRequests() {
    this.#generation++;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    for (const wake of this.#slots) wake();
  }
  clear(status: AuthStatus = "signed-out", error?: string) {
    diagnostics.clear();
    this.#token = undefined;
    this.#expires = 0;
    clearTimeout(this.#timer);
    this.cancelRequests();
    this.#pending?.(new ClientError("CONTEXT_CHANGED"));
    this.#pending = undefined;
    this.publish({ status, error });
  }

  // The SDK is loaded ahead of time so this call opens its popup in the click gesture.
  authorize(
    oauth: GoogleOAuth,
    clientId: string,
    prompt = "select_account",
  ): Promise<void> {
    this.clear("authorizing");
    const generation = this.#generation;
    return new Promise((resolve, reject) => {
      let settled = false;
      this.#pending = reject;
      const fail = (code: string) => {
        if (settled || generation !== this.#generation) return;
        settled = true;
        this.#pending = undefined;
        this.clear("error", code);
        reject(new ClientError(code));
      };
      try {
        const client = oauth.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          include_granted_scopes: false,
          callback: (response) => {
            if (settled || generation !== this.#generation) return;
            if (response.error) {
              fail(
                response.error === "access_denied"
                  ? "CONSENT_DENIED"
                  : "AUTH_FAILED",
              );
              return;
            }
            const seconds = Number(response.expires_in);
            if (
              !response.access_token ||
              !oauth.hasGrantedAllScopes(response, DRIVE_SCOPE)
            ) {
              fail("CONSENT_DENIED");
              return;
            }
            if (!Number.isFinite(seconds) || seconds <= 5 || seconds > 86400) {
              fail("AUTH_FAILED");
              return;
            }
            settled = true;
            this.#token = response.access_token;
            this.#expires = this.now() + seconds * 1000 - 5000;
            this.#pending = undefined;
            this.#timer = setTimeout(
              () => this.clear("expired"),
              seconds * 1000 - 5000,
            );
            this.publish({ status: "connected" });
            resolve();
          },
          error_callback: () => fail("POPUP_FAILED"),
        });
        client.requestAccessToken({ prompt });
      } catch {
        fail("AUTH_FAILED");
      }
    });
  }

  async revoke(oauth: GoogleOAuth): Promise<void> {
    const token = this.#token;
    this.clear();
    if (!token) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ClientError("REVOCATION_FAILED")),
        10000,
      );
      try {
        oauth.revoke(token, (result) => {
          clearTimeout(timer);
          if (result.successful) resolve();
          else reject(new ClientError("REVOCATION_FAILED"));
        });
      } catch {
        clearTimeout(timer);
        reject(new ClientError("REVOCATION_FAILED"));
      }
    });
  }

  async request<T>(
    url: string,
    options: RequestOptions = {},
  ): Promise<GoogleResult<T>> {
    const target = new URL(url);
    if (
      target.origin !== "https://www.googleapis.com" ||
      target.username ||
      target.password ||
      target.hash ||
      !(
        /^\/(?:upload\/)?drive\/v3\/(?:files(?:\/[A-Za-z0-9_-]+)?|about)$/.test(
          target.pathname,
        ) ||
        /^\/(?:upload\/)?drive\/v2\/files\/[A-Za-z0-9_-]+$/.test(
          target.pathname,
        )
      )
    ) {
      throw new ClientError("TOKEN_DESTINATION_REJECTED");
    }
    const generation = this.#generation;
    this.assertCurrent(generation);
    const controller = new AbortController();
    const externalAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener("abort", externalAbort, { once: true });
    this.#controllers.add(controller);
    const method = options.method ?? "GET";
    const read = method === "GET" || method === "HEAD";
    let timedOut = false;
    const check = () => {
      this.assertCurrent(generation);
      if (controller.signal.aborted)
        throw new ClientError(
          timedOut
            ? read
              ? "NETWORK_FAILED"
              : "AMBIGUOUS_WRITE"
            : "CONTEXT_CHANGED",
        );
    };
    const finishQueue = diagnostics.start("drive.queue");
    let acquired = false;
    try {
      check();
      while (this.#active >= 4) {
        await new Promise<void>((resolve) => {
          const wake = () => {
            this.#slots.delete(wake);
            controller.signal.removeEventListener("abort", wake);
            resolve();
          };
          this.#slots.add(wake);
          controller.signal.addEventListener("abort", wake, { once: true });
        });
        check();
      }
      check();
      this.#active++;
      acquired = true;
      finishQueue(200);
      for (let attempt = 0; ; attempt++) {
        const finishRequest = diagnostics.start(driveOperation(target, method));
        let perfStatus = 0,
          perfBytes: number | null = null,
          perfCount: number | null = null;
        check();
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, 20000);
        try {
          let response: Response;
          try {
            const headers = new Headers(options.headers);
            headers.set("Authorization", `Bearer ${this.#token}`);
            response = await this.fetcher(target.href, {
              ...options,
              method,
              headers,
              signal: controller.signal,
              credentials: "omit",
              redirect: "error",
              cache: "no-store",
            });
          } catch {
            check();
            if (!read) throw new ClientError("AMBIGUOUS_WRITE");
            if (attempt >= 2) throw new ClientError("NETWORK_FAILED");
            clearTimeout(timeout);
            await pause(250 * 2 ** attempt, controller.signal);
            continue;
          }
          perfStatus = response.status;
          const length = response.headers.get("Content-Length");
          if (length !== null && Number.isFinite(Number(length)))
            perfBytes = Number(length);
          check();
          if (response.status === 401) {
            this.clear("expired");
            throw new ClientError("AUTH_REQUIRED");
          }
          if (!response.ok) {
            let limited = response.status === 429;
            let forbiddenCode = "DRIVE_FORBIDDEN";
            if (response.status === 403) {
              try {
                const body = (await response.json()) as {
                  error?: {
                    errors?: { reason?: string }[];
                    details?: { reason?: string }[];
                  };
                };
                const reasons = [
                  ...(Array.isArray(body?.error?.errors)
                    ? body.error.errors
                    : []),
                  ...(Array.isArray(body?.error?.details)
                    ? body.error.details
                    : []),
                ].map((entry) => entry?.reason);
                limited = reasons.some((reason) =>
                  ["rateLimitExceeded", "userRateLimitExceeded"].includes(
                    reason ?? "",
                  ),
                );
                if (
                  reasons.some((reason) =>
                    [
                      "accessNotConfigured",
                      "SERVICE_DISABLED",
                      "API_DISABLED",
                    ].includes(reason ?? ""),
                  )
                )
                  forbiddenCode = "DRIVE_API_DISABLED";
                else if (
                  reasons.some((reason) =>
                    [
                      "insufficientPermissions",
                      "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
                    ].includes(reason ?? ""),
                  )
                )
                  forbiddenCode = "DRIVE_SCOPE_REQUIRED";
                else if (reasons.includes("domainPolicy"))
                  forbiddenCode = "DRIVE_DOMAIN_POLICY";
              } catch {
                /* Error contents are never reported or logged. */
              }
              check();
            }
            const transient =
              limited || [500, 502, 503, 504].includes(response.status);
            if (read && transient && attempt < 2) {
              const retry = Number(response.headers.get("Retry-After"));
              await pause(
                Math.min(
                  8000,
                  Math.max(
                    250 * 2 ** attempt + Math.random() * 100,
                    Number.isFinite(retry) ? retry * 1000 : 0,
                  ),
                ),
                controller.signal,
              );
              continue;
            }
            throw new ClientError(
              !read && transient
                ? "AMBIGUOUS_WRITE"
                : response.status === 412
                  ? "DRIVE_CONFLICT"
                  : response.status === 409
                    ? "DRIVE_ALREADY_EXISTS"
                    : response.status === 404
                      ? "DRIVE_NOT_FOUND"
                      : limited || transient
                        ? "DRIVE_BUSY"
                        : response.status === 403
                          ? forbiddenCode
                          : "DRIVE_FAILED",
            );
          }
          let data: T;
          try {
            data = (await (options.format === "blob"
              ? response.blob()
              : response.json())) as T;
          } catch {
            check();
            throw new ClientError(
              read ? "INVALID_DRIVE_DATA" : "AMBIGUOUS_WRITE",
            );
          }
          check();
          if (
            data &&
            typeof data === "object" &&
            "files" in data &&
            Array.isArray(data.files)
          )
            perfCount = data.files.length;
          return { data, etag: response.headers.get("ETag") };
        } finally {
          finishRequest(perfStatus, attempt, perfBytes, perfCount);
          clearTimeout(timeout);
        }
      }
    } finally {
      if (acquired) this.#active--;
      for (const wake of this.#slots) wake();
      this.#controllers.delete(controller);
      options.signal?.removeEventListener("abort", externalAbort);
    }
  }
}
