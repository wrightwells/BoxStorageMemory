import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/services/api";
import { DriveStorageService, FOLDER_TYPE } from "../src/services/drive";
import {
  GoogleAuthService,
  DRIVE_SCOPE,
  type GoogleOAuth,
  type TokenResponse,
} from "../src/services/google";
import { StorageSession } from "../src/services/session";

export const publicConfig = {
  appName: "Box Storage",
  applicationVersion: "1.0.0",
  apiVersion: "v1",
  publicUrl: "https://boxes.example",
  googleWebClientId: "test.apps.googleusercontent.com",
  features: { webNfc: false, qrFormat: "png" },
  compatibility: {
    supportedSchemaVersions: [1],
    minimumWebClientVersion: "1.0.0",
    minimumAndroidClientVersion: "1.0.0",
  },
};
const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), { status, headers });
const folder = (id: string, parents: string[] = []) => ({
  id,
  name: id,
  mimeType: FOLDER_TYPE,
  parents,
  version: "1",
});
const file = (id: string, version = "1", parents = ["library"]) => ({
  id,
  name: id,
  mimeType: "application/json",
  parents,
  version,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
export function mockOAuth() {
  let callback!: (response: TokenResponse) => void;
  let popupError!: () => void;
  const request = vi.fn();
  const oauth: GoogleOAuth = {
    initTokenClient: vi.fn((config) => {
      callback = config.callback;
      popupError = config.error_callback;
      return { requestAccessToken: request };
    }),
    hasGrantedAllScopes: vi.fn(() => true),
    revoke: vi.fn((_token, done) => done({ successful: true })),
  };
  return {
    oauth,
    request,
    respond: (
      response: TokenResponse = {
        access_token: "token-sentinel",
        expires_in: 3600,
      },
    ) => callback(response),
    popupError: () => popupError(),
  };
}
const services: GoogleAuthService[] = [];
function authService(fetcher: typeof fetch = vi.fn()) {
  const auth = new GoogleAuthService(fetcher);
  services.push(auth);
  return auth;
}
async function connect(auth: GoogleAuthService, sdk = mockOAuth()) {
  const result = auth.authorize(sdk.oauth, "client");
  sdk.respond();
  await result;
  return sdk;
}
afterEach(() => {
  for (const auth of services) auth.clear();
  services.length = 0;
  vi.useRealTimers();
});

describe("browser token lifecycle and boundaries", () => {
  it("requires the exact Drive scope, user gesture, finite expiry and all permissions", async () => {
    const auth = authService();
    const sdk = mockOAuth();
    const promise = auth.authorize(sdk.oauth, "client");
    expect(sdk.request).toHaveBeenCalledWith({ prompt: "select_account" });
    expect(sdk.oauth.initTokenClient).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: DRIVE_SCOPE,
        include_granted_scopes: false,
      }),
    );
    sdk.respond();
    await promise;
    expect(JSON.stringify(auth.state)).not.toContain("token-sentinel");
    expect(auth.state.status).toBe("connected");
    vi.mocked(sdk.oauth.hasGrantedAllScopes).mockReturnValue(false);
    const denied = auth.authorize(sdk.oauth, "client");
    sdk.respond();
    await expect(denied).rejects.toMatchObject({ code: "CONSENT_DENIED" });
    expect(auth.state.status).toBe("error");
    vi.mocked(sdk.oauth.hasGrantedAllScopes).mockReturnValue(true);
    const invalid = auth.authorize(sdk.oauth, "client");
    sdk.respond({ access_token: "x", expires_in: "NaN" });
    await expect(invalid).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
  it("handles closed popups and consent denial", async () => {
    const auth = authService();
    const sdk = mockOAuth();
    const denied = auth.authorize(sdk.oauth, "client");
    sdk.respond({ error: "access_denied" });
    await expect(denied).rejects.toMatchObject({ code: "CONSENT_DENIED" });
    const popup = auth.authorize(sdk.oauth, "client");
    sdk.popupError();
    await expect(popup).rejects.toMatchObject({ code: "POPUP_FAILED" });
  });
  it("ignores callbacks after sign-out and duplicate token callbacks", async () => {
    const auth = authService();
    const sdk = mockOAuth();
    const pending = auth.authorize(sdk.oauth, "client");
    auth.clear();
    sdk.respond();
    await expect(pending).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    expect(auth.state.status).toBe("signed-out");
    await connect(auth, sdk);
    sdk.respond({ error: "access_denied" });
    expect(auth.state.status).toBe("connected");
  });
  it("expires proactively and refuses requests until a new user authorization", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    const auth = authService(fetcher);
    const sdk = mockOAuth();
    const pending = auth.authorize(sdk.oauth, "client");
    sdk.respond({ access_token: "short", expires_in: 10 });
    await pending;
    await vi.advanceTimersByTimeAsync(5000);
    expect(auth.state.status).toBe("expired");
    await expect(
      auth.request("https://www.googleapis.com/drive/v3/files"),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "https://boxes.example/api/v1/config",
    "https://evil.example/drive/v3/files",
    "https://www.googleapis.com/calendar/v3/events",
    "https://www.googleapis.com/drive/v3/files/id/evil",
    "https://user@www.googleapis.com/drive/v3/files",
  ])("rejects token destination %s", async (url) => {
    const fetcher = vi.fn();
    const auth = authService(fetcher);
    await connect(auth);
    await expect(auth.request(url)).rejects.toMatchObject({
      code: "TOKEN_DESTINATION_REJECTED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("clears access on a revoked token, without surfacing Google error contents", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json({ secret: "error-sentinel" }, 401));
    const auth = authService(fetcher);
    await connect(auth);
    await expect(
      auth.request("https://www.googleapis.com/drive/v3/files"),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(auth.state.status).toBe("expired");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("clears locally before a failed remote revocation", async () => {
    const auth = authService();
    const sdk = await connect(auth);
    vi.mocked(sdk.oauth.revoke).mockImplementation((_token, done) => {
      expect(auth.state.status).toBe("signed-out");
      done({ successful: false });
    });
    await expect(auth.revoke(sdk.oauth)).rejects.toMatchObject({
      code: "REVOCATION_FAILED",
    });
    expect(auth.state.status).toBe("signed-out");
  });
  it("rejects a late parsed response even if fetch ignores abort", async () => {
    const body = deferred<unknown>();
    const response = json({});
    vi.spyOn(response, "json").mockReturnValue(body.promise);
    const auth = authService(vi.fn().mockResolvedValue(response));
    await connect(auth);
    const pending = auth.request("https://www.googleapis.com/drive/v3/files");
    await vi.waitFor(() => expect(response.json).toHaveBeenCalled());
    auth.cancelRequests();
    body.resolve({ private: "old-account" });
    await expect(pending).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
  });
  it("limits parallel requests to four, including queued cancellation", async () => {
    const replies = Array.from({ length: 6 }, () => deferred<Response>());
    const fetcher = vi
      .fn()
      .mockImplementation(
        () => replies[fetcher.mock.calls.length - 1]!.promise,
      );
    const auth = authService(fetcher);
    await connect(auth);
    const pending = Array.from({ length: 6 }, () =>
      auth.request("https://www.googleapis.com/drive/v3/files"),
    );
    const settled = Promise.allSettled(pending);
    expect(fetcher).toHaveBeenCalledTimes(4);
    auth.clear();
    replies.forEach((reply) => reply.resolve(json({})));
    expect(
      (await settled).every((result) => result.status === "rejected"),
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("retries transient reads with bounded backoff but never ambiguous writes", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { "Retry-After": "1" }))
      .mockResolvedValueOnce(json({ ok: true }));
    const auth = authService(fetcher);
    await connect(auth);
    const read = auth.request("https://www.googleapis.com/drive/v3/files");
    await vi.advanceTimersByTimeAsync(1100);
    await expect(read).resolves.toMatchObject({ data: { ok: true } });
    const options = fetcher.mock.calls[0]![1] as RequestInit;
    expect(new Headers(options.headers).get("Authorization")).toBe(
      "Bearer token-sentinel",
    );
    expect(options).toMatchObject({
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    fetcher.mockReset().mockResolvedValue(json({}, 503));
    await expect(
      auth.request("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
      }),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_WRITE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("distinguishes rate-limit 403 from permission denial", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, 403),
      )
      .mockResolvedValueOnce(json({ ok: true }));
    const auth = authService(fetcher);
    await connect(auth);
    const read = auth.request("https://www.googleapis.com/drive/v3/files");
    await vi.advanceTimersByTimeAsync(400);
    await read;
    fetcher
      .mockReset()
      .mockResolvedValue(
        json(
          { error: { errors: [{ reason: "insufficientFilePermissions" }] } },
          403,
        ),
      );
    await expect(
      auth.request("https://www.googleapis.com/drive/v3/files"),
    ).rejects.toMatchObject({ code: "DRIVE_FORBIDDEN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ errors: [{ reason: "accessNotConfigured" }] }, "DRIVE_API_DISABLED"],
    [{ details: [{ reason: "SERVICE_DISABLED" }] }, "DRIVE_API_DISABLED"],
    [
      { errors: [{ reason: "insufficientPermissions" }] },
      "DRIVE_SCOPE_REQUIRED",
    ],
    [
      { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] },
      "DRIVE_SCOPE_REQUIRED",
    ],
    [{ errors: [{ reason: "domainPolicy" }] }, "DRIVE_DOMAIN_POLICY"],
    [
      {
        message: "Private error contents",
        details: [{ reason: "UNKNOWN_REASON" }],
      },
      "DRIVE_FORBIDDEN",
    ],
  ])(
    "classifies setup/consent/policy failures without exposing Google response contents (%j)",
    async (error, code) => {
      const fetcher = vi.fn().mockResolvedValue(json({ error }, 403));
      const auth = authService(fetcher);
      await connect(auth);
      await expect(
        auth.request("https://www.googleapis.com/drive/v3/about?fields=user"),
      ).rejects.toMatchObject({ code, message: code });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});

describe("root-bound Drive adapter", () => {
  it("lists all pages and uses minimal fields and escaped queries", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ files: [folder("a")], nextPageToken: "next" }),
      )
      .mockResolvedValueOnce(json({ files: [folder("b")] }));
    const auth = authService(fetcher);
    await connect(auth);
    const drive = new DriveStorageService(auth);
    expect((await drive.browseFolders()).map((f) => f.id)).toEqual(["a", "b"]);
    const url = new URL(fetcher.mock.calls[1]![0]);
    expect(url.searchParams.get("pageToken")).toBe("next");
    expect(url.searchParams.get("fields")).not.toContain("*");
    await expect(
      drive.browseFolders("a' or trashed=true"),
    ).rejects.toMatchObject({ code: "INVALID_DRIVE_ID" });
  });
  it("rejects incomplete searches and repeated pagination tokens", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json({ files: [], nextPageToken: "loop" }));
    const auth = authService(fetcher);
    await connect(auth);
    const drive = new DriveStorageService(auth);
    await expect(drive.browseFolders()).rejects.toMatchObject({
      code: "INVALID_DRIVE_DATA",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher
      .mockReset()
      .mockResolvedValue(json({ files: [], incompleteSearch: true }));
    await expect(drive.browseFolders()).rejects.toMatchObject({
      code: "INVALID_DRIVE_DATA",
    });
  });
  it("requires a folder root and rejects files outside it before downloading", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      const id = new URL(url).pathname.split("/").pop();
      return Promise.resolve(
        json(id === "library" ? folder("library") : file(id!, "1", ["other"])),
      );
    });
    const auth = authService(fetcher);
    await connect(auth);
    const drive = new DriveStorageService(auth);
    await expect(drive.selectRoot("photo")).rejects.toMatchObject({
      code: "ROOT_NOT_FOLDER",
    });
    await drive.selectRoot("library");
    await expect(drive.readJson("external")).rejects.toMatchObject({
      code: "OUTSIDE_ROOT",
    });
    expect(
      fetcher.mock.calls.every(([url]) => !url.includes("alt=media")),
    ).toBe(true);
  });
  it("loads a coherent nested snapshot and fails closed on changing versions", async () => {
    let changed = false;
    let version = 1;
    const fetcher = vi.fn().mockImplementation((url: string) => {
      const target = new URL(url);
      const id = target.pathname.split("/").pop()!;
      if (target.searchParams.get("alt") === "media")
        return Promise.resolve(
          json({ box: "test" }, 200, { ETag: '"candidate"' }),
        );
      return Promise.resolve(
        json(
          id === "library"
            ? folder(id)
            : id === "nested"
              ? folder(id, ["library"])
              : file(id, String(changed ? version++ : 1), ["nested"]),
        ),
      );
    });
    const auth = authService(fetcher);
    await connect(auth);
    const drive = new DriveStorageService(auth);
    await drive.selectRoot("library");
    expect(await drive.readJson("inventory")).toMatchObject({
      document: { box: "test" },
      etag: '"candidate"',
      file: { version: "1" },
    });
    changed = true;
    await expect(drive.readJson("inventory")).rejects.toMatchObject({
      code: "READ_CONFLICT",
    });
  });
  it("rejects duplicate authoritative filenames", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          json(
            new URL(url).pathname.endsWith("/library")
              ? folder("library")
              : { files: [file("a"), file("b")] },
          ),
        ),
      );
    const auth = authService(fetcher);
    await connect(auth);
    const drive = new DriveStorageService(auth);
    await drive.selectRoot("library");
    await expect(
      drive.findFile("library", "inventory.json"),
    ).rejects.toMatchObject({ code: "DUPLICATE_FILE" });
  });
  it("never retries ambiguous root creation and keeps mutations gated", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("network-sensitive-details"));
    const auth = authService(fetcher);
    await connect(auth);
    const drive = new DriveStorageService(auth);
    await expect(drive.createRoot("Library")).rejects.toMatchObject({
      code: "AMBIGUOUS_WRITE",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    const mutations = [
      drive.createPendingFolder("library", "operation"),
      drive.renameFile(file("a"), "inventory.json"),
      drive.createJson("library", "inventory.json", {}),
      drive.uploadImage("library", "photo.jpg", new Blob()),
      drive.trash("photo"),
      drive.writeJson({ file: file("a"), document: {}, etag: '"strong"' }, {}),
    ];
    for (const mutation of mutations)
      await expect(mutation).rejects.toMatchObject({
        code: "WRITE_GATE_CLOSED",
      });
    expect(() => drive.assertWritesAvailable()).toThrow("WRITE_GATE_CLOSED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("releases photo URLs when runtime context is cleared", async () => {
    vi.stubGlobal("URL", URL);
    URL.createObjectURL = vi.fn(() => "blob:photo");
    URL.revokeObjectURL = vi.fn();
    const fetcher = vi.fn().mockImplementation((url: string) => {
      const target = new URL(url);
      if (target.searchParams.get("alt") === "media")
        return Promise.resolve(
          new Response("photo", { headers: { "Content-Type": "image/jpeg" } }),
        );
      return Promise.resolve(
        json(
          target.pathname.endsWith("/library")
            ? folder("library")
            : { ...file("photo"), mimeType: "image/jpeg" },
        ),
      );
    });
    const auth = authService(fetcher);
    await connect(auth);
    const drive = new DriveStorageService(auth);
    await drive.selectRoot("library");
    expect((await drive.image("photo")).url).toBe("blob:photo");
    drive.clear();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:photo");
    expect(drive.root).toBeUndefined();
  });
});

describe("session account isolation and token-free API", () => {
  it("only calls fixed API routes without Google credentials", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(json(publicConfig)));
    const api = new ApiClient(fetcher);
    await api.config();
    await api.schema("inventory");
    await api.validate("index", null);
    await api.qr("box-id");
    await api.driveFolderQr("drive-folder-id");
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/v1/qr/drive-folder");
    expect(JSON.parse(fetcher.mock.calls.at(-1)?.[1].body)).toEqual({
      folderId: "drive-folder-id",
    });
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toMatch(/^\/api\/v1\//);
      expect(options.credentials).toBe("omit");
      expect(new Headers(options.headers).has("Authorization")).toBe(false);
      expect(JSON.stringify(options)).not.toContain("token-sentinel");
    }
  });
  it("rejects incompatible API minimum versions", async () => {
    const api = new ApiClient(
      vi.fn().mockResolvedValue(
        json({
          ...publicConfig,
          compatibility: {
            ...publicConfig.compatibility,
            minimumWebClientVersion: "1.1.0",
          },
        }),
      ),
    );
    await expect(api.config()).rejects.toMatchObject({
      code: "API_INCOMPATIBLE",
    });
  });
  it("clears old roots before the chooser and restores only the correct account preference", async () => {
    const sdk = mockOAuth();
    let account = "account-a";
    const fetcher = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          json(
            url.includes("/about?")
              ? { user: { permissionId: account, displayName: account } }
              : folder(new URL(url).pathname.split("/").pop()!),
          ),
        ),
      );
    const prefs = {
      getItem: vi.fn((key: string) =>
        key.endsWith("account-a") ? "library-a" : "library-b",
      ),
      setItem: vi.fn(),
    };
    const auth = authService(fetcher);
    const session = new StorageSession(
      auth,
      new ApiClient(vi.fn().mockResolvedValue(json(publicConfig))),
      async () => sdk.oauth,
      prefs,
    );
    await session.initialize();
    const first = session.connect();
    sdk.respond();
    await first;
    expect(session.getSnapshot().root?.id).toBe("library-a");
    account = "account-b";
    const second = session.connect();
    expect(session.getSnapshot().account).toBeUndefined();
    expect(session.getSnapshot().root).toBeUndefined();
    sdk.respond({ access_token: "second-token", expires_in: 3600 });
    await second;
    expect(session.getSnapshot().account?.id).toBe("account-b");
    expect(session.getSnapshot().root?.id).toBe("library-b");
    expect(sdk.oauth.initTokenClient).toHaveBeenCalledTimes(2);
    for (const [request] of vi.mocked(sdk.oauth.initTokenClient).mock.calls) {
      expect(request.client_id).toBe(publicConfig.googleWebClientId);
    }
    expect(session.getSnapshot().config?.googleWebClientId).toBe(
      publicConfig.googleWebClientId,
    );
    await session.selectRoot("chosen-b");
    expect(prefs.setItem).toHaveBeenCalledExactlyOnceWith(
      "box-storage:root:account-b",
      "chosen-b",
    );
    expect(JSON.stringify(prefs.setItem.mock.calls)).not.toMatch(
      /token|inventory|photo/,
    );
    session.signOut();
    expect(session.getSnapshot().root).toBeUndefined();
    session.dispose();
  });
  it("does not repopulate roots from a delayed request after switching accounts", async () => {
    const delayed = deferred<Response>();
    const sdk = mockOAuth();
    const fetcher = vi
      .fn()
      .mockImplementation((url: string) =>
        url.includes("/about?")
          ? Promise.resolve(json({ user: { permissionId: "a" } }))
          : delayed.promise,
      );
    const auth = authService(fetcher);
    const session = new StorageSession(
      auth,
      new ApiClient(vi.fn().mockResolvedValue(json(publicConfig))),
      async () => sdk.oauth,
      undefined,
    );
    await session.initialize();
    const first = session.connect();
    sdk.respond();
    await first;
    const selection = session.selectRoot("old-root");
    session.signOut();
    delayed.resolve(json(folder("old-root")));
    await selection;
    expect(session.getSnapshot()).toMatchObject({
      auth: { status: "signed-out" },
    });
    expect(session.getSnapshot().root).toBeUndefined();
    expect(session.drive.root).toBeUndefined();
    session.dispose();
  });
});
