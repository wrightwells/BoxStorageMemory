import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { vi } from "vitest";
import { AppRoutes } from "../src/App";
import { ApiClient } from "../src/services/api";
import {
  GoogleAuthService,
  type GoogleOAuth,
  type TokenResponse,
} from "../src/services/google";
import { StorageSession } from "../src/services/session";
import { editingFixture } from "./editing-fixtures";
import { BOX } from "./library-fixtures";
export async function prepare(simulatedWrites = false) {
  const f = editingFixture();
  let callback!: (response: TokenResponse) => void;
  const oauth: GoogleOAuth = {
    initTokenClient: (options) => {
      callback = options.callback;
      return { requestAccessToken: () => undefined };
    },
    hasGrantedAllScopes: () => true,
    revoke: (_token, done) => done({ successful: true }),
  };
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
  const session = new StorageSession(
    new GoogleAuthService(vi.fn()),
    new ApiClient(vi.fn(async () => new Response(JSON.stringify(config)))),
    async () => oauth,
    { getItem: () => null, setItem: () => undefined },
  );
  vi.spyOn(session.drive, "root", "get").mockImplementation(() => f.root);
  vi.spyOn(session.drive, "account").mockResolvedValue({
    id: "account",
    name: "Test account",
    email: "",
  });
  vi.spyOn(session.drive, "selectRoot").mockResolvedValue(f.root);
  vi.spyOn(session.drive, "folderContents").mockImplementation(
    async (id, signal) => ({
      folder: await session.drive.withinRoot(id, signal),
      files: await session.drive.listChildren(id, signal),
    }),
  );
  vi.spyOn(session.drive, "listChildren").mockImplementation(
    f.drive.listChildren,
  );
  vi.spyOn(session.drive, "withinRoot").mockImplementation(f.drive.withinRoot);
  vi.spyOn(session.drive, "readJson").mockImplementation(f.drive.readJson);
  vi.spyOn(session.drive, "writeJson").mockImplementation(f.drive.writeJson);
  vi.spyOn(session.drive, "createJson").mockImplementation(f.drive.createJson);
  vi.spyOn(session.drive, "createPendingFolder").mockImplementation(
    f.drive.createPendingFolder,
  );
  vi.spyOn(session.drive, "renameFile").mockImplementation(f.drive.renameFile);
  vi.spyOn(session.drive, "trash").mockImplementation(f.drive.trash);
  Object.defineProperty(session.drive, "managePhotos", { value: undefined });
  vi.spyOn(session.drive, "assertPhotoWritesAvailable").mockImplementation(() =>
    session.drive.assertWritesAvailable(),
  );
  // These legacy screen tests intentionally exercise the isolated simulator.
  // Production saves use editBox, covered by the coordinated service tests.
  if (simulatedWrites) {
    Object.defineProperty(session.drive, "editBox", { value: undefined });
    vi.spyOn(session.drive, "assertEditingAvailable").mockImplementation(
      f.drive.assertWritesAvailable,
    );
  }
  if (simulatedWrites)
    vi.spyOn(session.drive, "assertWritesAvailable").mockImplementation(
      f.drive.assertWritesAvailable,
    );
  vi.spyOn(session.api, "validate").mockImplementation(f.api.validate);
  await session.initialize();
  const connecting = session.connect();
  callback({ access_token: "test-token", expires_in: 3600 });
  await connecting;
  await session.selectRoot(f.root.id);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: "ok", version: "1.0.0", apiVersion: "v1" }),
        ),
    ),
  );
  const open = (
    path = `/box/${BOX}/edit`,
    previous?: string,
    navigationState?: unknown,
  ) => {
    const initialUrl = new URL(path, "http://test.local");
    const router = createMemoryRouter(
      [{ path: "*", element: <AppRoutes session={session} dataRouter /> }],
      {
        initialEntries: previous
          ? [previous, path]
          : [
              {
                pathname: initialUrl.pathname,
                search: initialUrl.search,
                state: navigationState,
              },
            ],
        initialIndex: previous ? 1 : 0,
      },
    );
    render(<RouterProvider router={router} />);
    return router;
  };
  return { ...f, session, open };
}
