import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientError } from "../src/services/errors";
import { StorageSession } from "../src/services/session";
import { BOX } from "./library-fixtures";
import { prepare as prepareConnected } from "./connected-fixture";

const sessions: StorageSession[] = [];
async function prepare(simulatedWrites = false) {
  const fixture = await prepareConnected(simulatedWrites);
  sessions.push(fixture.session);
  return fixture;
}
afterEach(() => {
  act(() => {
    sessions.forEach((s) => s.dispose());
  });
  sessions.length = 0;
});

describe("create/edit screens", () => {
  it.each([`/box/${BOX}/edit`, "/library/new"])(
    "retains requested editor route %s through account setup",
    async (path) => {
      const f = await prepare();
      f.open("/login", undefined, { returnTo: path });
      const link = screen.getByRole("link", {
        name:
          path === "/library/new"
            ? "Continue box creation"
            : "Open requested record",
      });
      expect(link).toHaveAttribute("href", path);
      await userEvent.click(link);
      expect(await screen.findByLabelText("Box name")).toHaveValue(
        path === "/library/new" ? "" : "Electrical Box",
      );
    },
  );
  it("edits supported fields while preserving identities and extensions, with production save disabled", async () => {
    const f = await prepare();
    f.inventory.extension = { source: "External" };
    f.open();
    const input = await screen.findByLabelText("Box name");
    await userEvent.clear(input);
    await userEvent.type(input, "Changed box");
    expect(screen.getByText(`Box UUID: ${BOX}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText(/Unsaved changes —/)).toBeInTheDocument();
    expect(f.session.editing.getSnapshot().draft!.document.extension).toEqual({
      source: "External",
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Validate draft" }),
    );
    expect(
      await screen.findByText(
        /Draft passed local and application API validation/,
      ),
    ).toBeInTheDocument();
    expect(f.drive.writeJson).not.toHaveBeenCalled();
  });
  it("reports invalid quantities without sending documents to the API", async () => {
    const f = await prepare();
    f.open();
    const quantity = await screen.findByLabelText("Quantity");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Validate draft" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "/items/0/quantity",
    );
    expect(f.api.validate).not.toHaveBeenCalled();
  });
  it("retains the failed draft and supports validation retry after API unavailability", async () => {
    const f = await prepare();
    vi.mocked(f.api.validate).mockRejectedValueOnce(
      new ClientError("API_UNAVAILABLE"),
    );
    f.open();
    const name = await screen.findByLabelText("Box name");
    await userEvent.clear(name);
    await userEvent.type(name, "Retry name");
    await userEvent.click(
      screen.getByRole("button", { name: "Validate draft" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "application service is unavailable",
    );
    expect(name).toHaveValue("Retry name");
    await userEvent.click(
      screen.getByRole("button", { name: "Validate draft" }),
    );
    expect(await screen.findByText(/Draft passed local/)).toBeInTheDocument();
  });
  it("confirms item deletion and clearly retains photo files", async () => {
    const f = await prepare();
    f.open();
    await screen.findByLabelText("Item name");
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete item" }));
    expect(screen.getByLabelText("Item name")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete item" }));
    expect(screen.queryByLabelText("Item name")).not.toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("all photo files will remain in Drive"),
    );
    expect(f.files.has("photo-file")).toBe(true);
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("creates a valid in-memory proposal without reserving a number or making a folder", async () => {
    const f = await prepare();
    f.open("/library/new");
    expect(await screen.findByLabelText("Box name")).toHaveValue("");
    expect(screen.getByText("BOX-0003")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create box" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Box name"), "Cables");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await userEvent.type(screen.getByLabelText("Item name"), "Cable");
    await userEvent.click(
      screen.getByRole("button", { name: "Validate draft" }),
    );
    expect(await screen.findByText(/Draft passed local/)).toBeInTheDocument();
    expect(f.drive.createPendingFolder).not.toHaveBeenCalled();
  });
  it("shows verified success only after all simulator steps finish", async () => {
    const f = await prepare(true);
    f.open();
    const name = await screen.findByLabelText("Box name");
    await userEvent.clear(name);
    await userEvent.type(name, "Simulator save");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByRole("heading", { name: "Save verified" }),
    ).toBeInTheDocument();
    expect(name).toBeDisabled();
    expect(screen.queryByText(/Unsaved changes —/)).not.toBeInTheDocument();
  });
  it("shows exact partial inventory/index outcomes and retains the intended draft", async () => {
    const f = await prepare(true);
    const atomic = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    vi.mocked(f.drive.writeJson).mockImplementation(
      async (snapshot, document) => {
        if (snapshot.file.id === "index-file")
          throw new ClientError("DRIVE_FORBIDDEN");
        return atomic(snapshot, document);
      },
    );
    f.open();
    const name = await screen.findByLabelText("Box name");
    await userEvent.clear(name);
    await userEvent.type(name, "Partial save");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByRole("heading", { name: "Save not completed" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/inventory: confirmed/)).toBeInTheDocument();
    expect(screen.getByText(/Outcome: partial/)).toBeInTheDocument();
    expect(name).toHaveValue("Partial save");
    expect(
      screen.queryByRole("heading", { name: "Save verified" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Review current Drive state" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reconcile reviewed metadata" }),
      ).toBeEnabled(),
    );
  });
  it("prevents editing when Drive explicitly reports insufficient permissions", async () => {
    const f = await prepare();
    f.inventoryFile.capabilities = { canEdit: false };
    f.open();
    expect(await screen.findByLabelText("Box name")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "insufficient Drive permissions",
    );
  });
  it("prompts before SPA navigation, retains the draft after leaving and restores it on return", async () => {
    const f = await prepare();
    f.open();
    const name = await screen.findByLabelText("Box name");
    await userEvent.clear(name);
    await userEvent.type(name, "Unsaved name");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(
      screen.getByRole("link", { name: "Back to library" }),
    );
    expect(screen.getByLabelText("Box name")).toHaveValue("Unsaved name");
    confirm.mockReturnValue(true);
    await userEvent.click(
      screen.getByRole("link", { name: "Back to library" }),
    );
    await userEvent.click(
      await screen.findByRole("link", { name: /BOX-0001 Electrical Box/ }),
    );
    await userEvent.click(
      await screen.findByRole("link", { name: "Edit box and items" }),
    );
    expect(await screen.findByLabelText("Box name")).toHaveValue(
      "Unsaved name",
    );
  });
  it("blocks browser-back navigation and guards page unload", async () => {
    const f = await prepare();
    const router = f.open(`/box/${BOX}/edit`, "/library");
    await screen.findByLabelText("Box name");
    await userEvent.type(screen.getByLabelText("Notes"), "Unsaved note");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/box/${BOX}/edit`),
    );
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it("clears private drafts immediately on sign-out", async () => {
    const f = await prepare();
    f.open();
    await screen.findByLabelText("Notes");
    await userEvent.type(screen.getByLabelText("Notes"), "Private note");
    act(() => f.session.signOut());
    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
    expect(f.session.editing.getSnapshot().draft).toBeUndefined();
    expect(
      screen.getByRole("link", { name: "Account setup" }),
    ).toBeInTheDocument();
  });
});
