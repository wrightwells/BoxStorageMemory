import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../src/App";
import { ApiClient } from "../src/services/api";
import { FOLDER_TYPE } from "../src/services/drive";
import {
  GoogleAuthService,
  type GoogleOAuth,
  type TokenResponse,
} from "../src/services/google";
import { StorageSession } from "../src/services/session";

const config = {
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
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const sessions: StorageSession[] = [];
function setup(route = "/login", clientId = config.googleWebClientId) {
  let callback!: (response: TokenResponse) => void;
  let name = "Account A";
  let folderError = false;
  const oauth: GoogleOAuth = {
    initTokenClient: vi.fn((options) => {
      callback = options.callback;
      return { requestAccessToken: vi.fn() };
    }),
    hasGrantedAllScopes: vi.fn(() => true),
    revoke: vi.fn((_token, done) => done({ successful: true })),
  };
  const load = vi.fn(async () => oauth);
  const fetcher = vi.fn(
    (url: string | URL | Request, options?: RequestInit) => {
      const target = new URL(String(url));
      if (target.pathname.endsWith("/about"))
        return Promise.resolve(
          json({ user: { permissionId: name, displayName: name } }),
        );
      if (target.pathname.endsWith("/files")) {
        if (options?.method === "POST") return Promise.resolve(json({}, 503));
        if (folderError) return Promise.resolve(json({}, 403));
        return Promise.resolve(
          json({
            files: [
              { id: "library", name: "Storage room", mimeType: FOLDER_TYPE },
            ],
          }),
        );
      }
      return Promise.resolve(
        json({
          id: "library",
          name: "Storage room",
          mimeType: FOLDER_TYPE,
          capabilities: { canAddChildren: false },
        }),
      );
    },
  );
  const prefs = { getItem: vi.fn(() => null), setItem: vi.fn() };
  const apiFetch = vi.fn(async () =>
    json({ ...config, googleWebClientId: clientId }),
  );
  const session = new StorageSession(
    new GoogleAuthService(fetcher),
    new ApiClient(apiFetch),
    load,
    prefs,
  );
  sessions.push(session);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({ status: "ok", version: "1.0.0", apiVersion: "v1" }),
    ),
  );
  render(
    <MemoryRouter initialEntries={[route]}>
      <AppRoutes session={session} />
    </MemoryRouter>,
  );
  return {
    session,
    load,
    oauth,
    apiFetch,
    prefs,
    fetcher,
    respond: (
      response: TokenResponse = {
        access_token: "private-token",
        expires_in: 3600,
      },
    ) => {
      act(() => callback(response));
    },
    setName: (next: string) => {
      name = next;
    },
    setFolderError: (next: boolean) => {
      folderError = next;
    },
  };
}
async function signIn(runtime: ReturnType<typeof setup>) {
  const button = await screen.findByRole("button", {
    name: "Sign in with Google",
  });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  runtime.respond();
  await screen.findByRole("heading", { name: "Choose a library folder" });
}
afterEach(() => {
  act(() => {
    for (const session of sessions) session.dispose();
  });
  sessions.length = 0;
});

describe("Drive connection screens", () => {
  it("reports disabled Drive API during account lookup instead of blaming a folder", async () => {
    const runtime = setup();
    runtime.fetcher.mockResolvedValueOnce(
      json(
        {
          error: {
            errors: [
              {
                reason: "accessNotConfigured",
                message: "Private Google error details",
              },
            ],
          },
        },
        403,
      ),
    );
    const button = await screen.findByRole("button", {
      name: "Sign in with Google",
    });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    runtime.respond();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google Drive API is disabled",
    );
    expect(
      screen.queryByText(/Private Google error details/),
    ).not.toBeInTheDocument();
    expect(runtime.session.getSnapshot().account).toBeUndefined();
    expect(runtime.fetcher).toHaveBeenCalledTimes(1);
    expect(String(runtime.fetcher.mock.calls[0]![0])).toContain("/about?");
  });
  it("explains missing operator configuration and does not load Google", async () => {
    const runtime = setup("/login", "");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "application operator has not configured Google sign-in",
    );
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeDisabled();
    expect(runtime.load).not.toHaveBeenCalled();
  });
  it("authorizes, browses folders, selects a read-only root and saves only its ID", async () => {
    const runtime = setup();
    await signIn(runtime);
    await userEvent.click(
      await screen.findByRole("button", { name: "Use Storage room" }),
    );
    expect(
      await screen.findByText("This folder is read-only for this account."),
    ).toBeInTheDocument();
    expect(runtime.prefs.setItem).toHaveBeenCalledExactlyOnceWith(
      "box-storage:root:Account%20A",
      "library",
    );
    expect(document.body.textContent).not.toContain("private-token");
    for (const [, options] of runtime.apiFetch.mock.calls as unknown as [
      string,
      RequestInit,
    ][])
      expect(new Headers(options.headers).has("Authorization")).toBe(false);
  });
  it("shows denied consent and allows another user-driven attempt", async () => {
    const runtime = setup();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sign in with Google" }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Sign in with Google" }),
    );
    runtime.respond({ error: "access_denied" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "permission was not granted",
    );
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeEnabled();
    expect(runtime.fetcher).not.toHaveBeenCalled();
  });
  it("clears account and root immediately when switching and when signing out", async () => {
    const runtime = setup("/settings");
    await signIn(runtime);
    await userEvent.click(
      await screen.findByRole("button", { name: "Use Storage room" }),
    );
    await screen.findByRole("button", { name: "Change library folder" });
    await userEvent.click(
      screen.getByRole("button", { name: "Switch account" }),
    );
    expect(screen.queryByText("Account A")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage room")).not.toBeInTheDocument();
    runtime.setName("Account B");
    runtime.respond();
    expect(await screen.findByText("Account B")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.queryByText("Account B")).not.toBeInTheDocument();
    expect(runtime.session.getSnapshot().root).toBeUndefined();
  });
  it("offers explicit renewal after expiration and clears selected data", async () => {
    const runtime = setup();
    await signIn(runtime);
    act(() => runtime.session.auth.clear("expired"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "expired or access was revoked",
    );
    expect(
      screen.getByRole("button", { name: "Reconnect Google Drive" }),
    ).toBeEnabled();
    expect(screen.queryByText("Account A")).not.toBeInTheDocument();
  });
  it("retries a denied folder listing and still allows a manual root ID", async () => {
    const runtime = setup();
    runtime.setFolderError(true);
    await signIn(runtime);
    expect(
      await screen.findByText(/Check the account’s Drive access/),
    ).toBeInTheDocument();
    runtime.setFolderError(false);
    await userEvent.click(
      screen.getByRole("button", { name: "Retry folder listing" }),
    );
    expect(
      await screen.findByRole("button", { name: "Use Storage room" }),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText(/Google Drive folder ID/),
      "library",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Use folder ID" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Library folder" }),
    ).toBeInTheDocument();
  });
  it("reports ambiguous creation without automatically retrying or claiming success", async () => {
    const runtime = setup();
    await signIn(runtime);
    await userEvent.click(
      screen.getByRole("button", { name: "Create library folder" }),
    );
    expect(
      await screen.findByText(/Check Drive before trying again/),
    ).toBeInTheDocument();
    expect(
      runtime.fetcher.mock.calls.filter(
        ([, options]) => options?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(runtime.session.getSnapshot().root).toBeUndefined();
  });
});
