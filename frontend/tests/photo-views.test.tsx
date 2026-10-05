import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type StorageSession } from "../src/services/session";
import { photoFilename } from "../src/services/photos";
import { prepare } from "./connected-fixture";
import { BOX, ITEM } from "./library-fixtures";

const sessions: StorageSession[] = [];
async function open(ownedUpload = false) {
  const f = await prepare();
  const orphanName = photoFilename(f.inventory, ITEM, crypto.randomUUID());
  if (ownedUpload)
    f.files.set("owned-orphan", {
      id: "owned-orphan",
      name: orphanName,
      mimeType: "image/jpeg",
      version: "1",
      parents: ["box-folder"],
      appProperties: {
        bsmBoxId: BOX,
        bsmItemId: ITEM,
        bsmPhotoOperationId: crypto.randomUUID(),
      },
    });
  sessions.push(f.session);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 100, height: 50, close: vi.fn() })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) =>
    done(new Blob(["jpeg"], { type: "image/jpeg" })),
  );
  const router = f.open(`/box/${BOX}/item/${ITEM}/photos`);
  await screen.findByRole("heading", { name: "13A Extension Lead" });
  return { ...f, router, orphanName };
}
afterEach(() => {
  act(() => sessions.forEach((session) => session.dispose()));
  sessions.length = 0;
  vi.restoreAllMocks();
});
describe("photograph controls", () => {
  it("scans and displays recovered owned uploads while keeping production recovery actions disabled", async () => {
    const f = await open(true);
    await userEvent.click(
      screen.getByRole("button", { name: "Scan owned uploads" }),
    );
    const selection = await screen.findByLabelText(f.orphanName);
    expect(selection).toBeEnabled();
    await userEvent.click(selection);
    expect(
      screen.getByRole("button", {
        name: "Associate selected recovered photos",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Clean up selected recovered photos",
      }),
    ).toBeDisabled();
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("prepares JPEG previews with optional resizing while production mutations remain disabled", async () => {
    const f = await open();
    expect(screen.getByLabelText(/Resize new selections/)).toBeChecked();
    await userEvent.upload(screen.getByLabelText(/Choose photographs/), [
      new File(["png"], "one.png", { type: "image/png" }),
      new File(["png"], "two.png", { type: "image/png" }),
    ]);
    expect(
      await screen.findByAltText("New photograph preview 2"),
    ).toHaveAttribute("src", "blob:preview");
    expect(
      screen.getByRole("button", { name: "Upload selected photographs" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove photograph reference" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove preview 1" }),
    );
    expect(f.session.photos.getSnapshot().selected).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    act(() => f.session.signOut());
    expect(f.session.photos.getSnapshot().selected).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByAltText("New photograph preview 1"),
    ).not.toBeInTheDocument();
  });
  it("reports camera denial and keeps file selection usable", async () => {
    await open();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("Denied", "NotAllowedError");
        }),
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Open camera" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Camera access is unavailable or was denied",
    );
    expect(screen.getByLabelText(/Choose photographs/)).toBeEnabled();
  });
  it("guards navigation with selected previews and releases them on confirmed departure", async () => {
    const f = await open();
    await userEvent.upload(
      screen.getByLabelText(/Choose photographs/),
      new File(["png"], "one.png", { type: "image/png" }),
    );
    await screen.findByAltText("New photograph preview 1");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(screen.getByRole("link", { name: "Back to item" }));
    expect(screen.getByAltText("New photograph preview 1")).toBeInTheDocument();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("link", { name: "Back to item" }));
    await waitFor(() =>
      expect(f.router.state.location.pathname).toBe(`/box/${BOX}/item/${ITEM}`),
    );
    expect(f.session.photos.getSnapshot().selected).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
