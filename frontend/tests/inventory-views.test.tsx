import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../src/App";
import { ApiClient } from "../src/services/api";
import {
  GoogleAuthService,
  type GoogleOAuth,
  type TokenResponse,
} from "../src/services/google";
import { StorageSession } from "../src/services/session";
import { BOX, ITEM, SECOND, fixtureLibrary } from "./library-fixtures";

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
const sessions: StorageSession[] = [];
async function prepare() {
  const fixture = fixtureLibrary();
  let callback!: (response: TokenResponse) => void;
  const oauth: GoogleOAuth = {
    initTokenClient: (options) => {
      callback = options.callback;
      return { requestAccessToken: () => undefined };
    },
    hasGrantedAllScopes: () => true,
    revoke: (_token, done) => done({ successful: true }),
  };
  const session = new StorageSession(
    new GoogleAuthService(vi.fn()),
    new ApiClient(vi.fn(async () => new Response(JSON.stringify(config)))),
    async () => oauth,
    { getItem: () => null, setItem: () => undefined },
  );
  sessions.push(session);
  vi.spyOn(session.drive, "root", "get").mockImplementation(
    () => fixture.drive.root,
  );
  vi.spyOn(session.drive, "account").mockResolvedValue({
    id: "test-account",
    name: "Test account",
    email: "",
  });
  vi.spyOn(session.drive, "selectRoot").mockResolvedValue(fixture.root);
  vi.spyOn(session.drive, "listChildren").mockImplementation(
    fixture.drive.listChildren,
  );
  vi.spyOn(session.drive, "withinRoot").mockImplementation(
    fixture.drive.withinRoot,
  );
  vi.spyOn(session.drive, "readJson").mockImplementation(
    fixture.drive.readJson,
  );
  vi.spyOn(session.drive, "image").mockImplementation(fixture.drive.image);
  vi.spyOn(session.drive, "releaseImage").mockImplementation(
    fixture.drive.releaseImage,
  );
  await session.initialize();
  const connecting = session.connect();
  callback({ access_token: "test-token", expires_in: 3600 });
  await connecting;
  await session.selectRoot("library");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: "ok", version: "1.0.0", apiVersion: "v1" }),
        ),
    ),
  );
  const open = (route = "/library", navigationState?: unknown) =>
    render(
      <MemoryRouter
        initialEntries={[{ pathname: route, state: navigationState }]}
      >
        <AppRoutes session={session} />
      </MemoryRouter>,
    );
  return { ...fixture, session, open };
}
afterEach(() => {
  act(() => {
    sessions.forEach((session) => session.dispose());
  });
  sessions.length = 0;
});

describe("inventory screens", () => {
  it("shows box numbers, metadata and manual lookup to a nested box", async () => {
    const fixture = await prepare();
    fixture.open();
    expect(
      await screen.findByRole("link", { name: /BOX-0001 Electrical Box/ }),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Find a box number"), "box-1");
    await userEvent.click(screen.getByRole("button", { name: "Open box" }));
    expect(
      await screen.findByRole("link", { name: "13A Extension Lead" }),
    ).toBeInTheDocument();
    expect(fixture.drive.image).not.toHaveBeenCalled();
  });
  it("browses folders and resolves a box deep link directly", async () => {
    const fixture = await prepare();
    fixture.open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Garage" }),
    );
    expect(
      await screen.findByRole("button", { name: "BOX-0001 Electrical Box" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "BOX-0001 Electrical Box" }),
    );
    expect(
      screen.getAllByRole("link", { name: /BOX-0001 Electrical Box/ }),
    ).toHaveLength(2);
    await userEvent.click(
      screen.getAllByRole("link", { name: /BOX-0001 Electrical Box/ })[1]!,
    );
    expect(
      await screen.findByRole("link", { name: "13A Extension Lead" }),
    ).toBeInTheDocument();
  });
  it("returns to a requested item after account and root setup", async () => {
    const fixture = await prepare();
    const path = `/box/${BOX}/item/${ITEM}`;
    fixture.open("/login", { returnTo: path });
    const link = screen.getByRole("link", { name: "Open requested record" });
    expect(link).toHaveAttribute("href", path);
    await userEvent.click(link);
    expect(
      await screen.findByRole("heading", { name: "13A Extension Lead" }),
    ).toBeInTheDocument();
  });
  it("rejects an external account-setup return destination", async () => {
    const fixture = await prepare();
    fixture.open("/login", { returnTo: "https://untrusted.example" });
    expect(
      screen.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/library");
  });
  it("opens an empty box and reports a missing item", async () => {
    const fixture = await prepare();
    fixture.open(`/box/${SECOND}/item/${ITEM}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This item is not in the current box inventory",
    );
    await userEvent.click(screen.getByRole("link", { name: "Back to box" }));
    expect(await screen.findByText("This box is empty.")).toBeInTheDocument();
  });
  it("does not download images until asked and releases them on close", async () => {
    const fixture = await prepare();
    fixture.open(`/box/${BOX}/item/${ITEM}`);
    const button = await screen.findByRole("button", { name: "Load photo" });
    expect(fixture.drive.image).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(
      await screen.findByRole("img", { name: /Item photograph/ }),
    ).toHaveAttribute("src", "blob:photo-file");
    await userEvent.click(screen.getByRole("button", { name: "Close photo" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(fixture.drive.releaseImage).toHaveBeenCalledWith("blob:photo-file");
  });
  it("reports a missing image with a retry instead of a broken placeholder", async () => {
    const fixture = await prepare();
    fixture.files.delete("photo-file");
    fixture.open(`/box/${BOX}/item/${ITEM}`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Load photo" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This photograph is missing",
    );
    expect(screen.getByRole("button", { name: "Retry photo" })).toBeEnabled();
  });
  it("refreshes externally changed inventories and reports stale lookup metadata", async () => {
    const fixture = await prepare();
    fixture.open(`/box/${BOX}`);
    await screen.findByRole("link", { name: "13A Extension Lead" });
    fixture.inventory.items[0]!.name = "Edited externally";
    fixture.inventory.box.name = "External name";
    fixture.inventoryFile.version = "2";
    await userEvent.click(screen.getByRole("button", { name: "Refresh box" }));
    expect(
      await screen.findByRole("link", { name: "Edited externally" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/The index metadata differs/)).toBeInTheDocument();
  });
  it("previews a missing-index rebuild and keeps replacement disabled", async () => {
    const fixture = await prepare();
    fixture.files.delete("index-file");
    fixture.open();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "library index is missing",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Preview rebuilt index" }),
    );
    expect(
      await screen.findByText(/Found 2 valid inventories/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Replace index after review" }),
    ).toBeDisabled();
    expect(fixture.drive.writeJson).not.toHaveBeenCalled();
    expect(fixture.drive.createJson).not.toHaveBeenCalled();
  });
  it("protects newer inventories without displaying assumed fields", async () => {
    const fixture = await prepare();
    fixture.documents.set("inventory-file", {
      schemaVersion: 2,
      box: { name: "Future name" },
    });
    fixture.open(`/box/${BOX}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("newer schema");
    expect(screen.queryByText("Future name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Save/ }),
    ).not.toBeInTheDocument();
  });
  it("clears displayed records and photo URLs immediately on sign-out", async () => {
    const fixture = await prepare();
    fixture.open(`/box/${BOX}/item/${ITEM}`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Load photo" }),
    );
    await screen.findByRole("img");
    act(() => fixture.session.signOut());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "13A Extension Lead" }),
    ).not.toBeInTheDocument();
    expect(fixture.drive.releaseImage).toHaveBeenCalledWith("blob:photo-file");
    expect(
      screen.getByRole("link", { name: "Account setup" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fixture.session.library.getSnapshot().index).toBeUndefined(),
    );
  });
});
