import { diagnostics } from "./performance";
import { ClientError } from "./errors";

export interface PublicConfig {
  appName: string;
  applicationVersion: string;
  apiVersion: "v1";
  publicUrl: string;
  googleWebClientId: string;
  features: { webNfc: boolean; qrFormat: "png" };
  compatibility: {
    supportedSchemaVersions: number[];
    minimumWebClientVersion: string;
    minimumAndroidClientVersion: string;
  };
}
export interface ValidationResult {
  valid: boolean;
  errors: { path: string; code: string; message: string }[];
}

// Fixed, same-origin routes only. No caller-controlled headers or credentials.
export class ApiClient {
  constructor(
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async call<T>(
    path: string,
    signal?: AbortSignal,
    document?: unknown,
    format: "json" | "blob" = "json",
    post = false,
  ): Promise<T> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, 15000);
    const finish = diagnostics.start("api.request");
    let status = 0;
    try {
      const response = await this.fetcher(`/api/v1/${path}`, {
        method: post ? "POST" : "GET",
        headers: !post ? undefined : { "Content-Type": "application/json" },
        body: post ? JSON.stringify(document) : undefined,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      status = response.status;
      if (!response.ok) throw new ClientError("API_UNAVAILABLE");
      const data = await (format === "blob"
        ? response.blob()
        : response.json());
      if (controller.signal.aborted) throw new ClientError("API_UNAVAILABLE");
      return data as T;
    } catch {
      throw new ClientError("API_UNAVAILABLE");
    } finally {
      finish(status);
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }

  async config(signal?: AbortSignal): Promise<PublicConfig> {
    try {
      const data = await this.call<PublicConfig>("config", signal);
      const minimum = data.compatibility?.minimumWebClientVersion;
      const parts =
        typeof minimum === "string" && /^\d+\.\d+\.\d+$/.test(minimum)
          ? minimum.split(".").map(Number)
          : [];
      if (
        data.apiVersion !== "v1" ||
        !Array.isArray(data.compatibility?.supportedSchemaVersions) ||
        !data.compatibility.supportedSchemaVersions.includes(1) ||
        parts.length !== 3 ||
        parts[0]! > 1 ||
        (parts[0] === 1 && (parts[1]! > 0 || parts[2]! > 0)) ||
        typeof data.googleWebClientId !== "string" ||
        typeof data.publicUrl !== "string" ||
        typeof data.appName !== "string" ||
        data.features?.qrFormat !== "png"
      ) {
        throw new ClientError("API_INCOMPATIBLE");
      }
      return data;
    } catch (error) {
      throw error instanceof ClientError
        ? error
        : new ClientError("API_INCOMPATIBLE");
    }
  }

  async health(
    signal?: AbortSignal,
  ): Promise<{ status: "ok"; version: string; apiVersion: "v1" }> {
    const data = await this.call<{
      status: "ok";
      version: string;
      apiVersion: "v1";
    }>("health", signal);
    if (
      data?.status !== "ok" ||
      data.apiVersion !== "v1" ||
      typeof data.version !== "string"
    )
      throw new ClientError("API_INCOMPATIBLE");
    return data;
  }

  async schema(
    kind: "inventory" | "index",
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.call(`schema/${kind}`, signal);
  }
  async validate(
    kind: "inventory" | "index",
    document: unknown,
    signal?: AbortSignal,
  ): Promise<ValidationResult> {
    return this.call(`validate/${kind}`, signal, document, "json", true);
  }
  async qr(boxId: string, signal?: AbortSignal): Promise<Blob> {
    return this.call("qr/generate", signal, { boxId }, "blob", true);
  }
  async driveFolderQr(folderId: string, signal?: AbortSignal): Promise<Blob> {
    return this.call("qr/drive-folder", signal, { folderId }, "blob", true);
  }
}
