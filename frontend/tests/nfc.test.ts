import { describe, it, expect, vi } from "vitest";
import { NfcService } from "../src/services/nfc";
import { ClientError } from "../src/services/errors";
import { editingFixture } from "./editing-fixtures";
import { BOX, SECOND } from "./library-fixtures";
const UID = "04AABBCCDDEE11";
function fixture() {
  const f = editingFixture();
  const nfc = new NfcService(
    { ...f.drive, image: vi.fn(), releaseImage: vi.fn() },
    f.library,
    f.api,
    () => 1,
    () => true,
    () => false,
  );
  return { ...f, nfc };
}
const options = { confirmed: true, moveConfirmed: false, replace: false };
describe("authoritative NFC mapping workflow", () => {
  it("resolves registered/unknown identifiers and ignores stale derived mappings", async () => {
    const f = fixture();
    f.index.boxes[0]!.nfcIds = [];
    expect((await f.nfc.review("04:aa:bb:cc:dd:ee:11")).owner?.boxId).toBe(BOX);
    expect((await f.nfc.review("11:22")).owner).toBeUndefined();
    await expect(f.nfc.review("bad")).rejects.toThrow("INVALID_NFC_ID");
  });
  it("blocks ambiguous or incomplete lookup", async () => {
    const f = fixture();
    f.empty.box.nfcIds = [UID];
    await expect(f.nfc.review(UID)).rejects.toThrow("DUPLICATE_NFC_ID");
    f.empty.box.nfcIds = [];
    f.unavailable.add("box-folder");
    await expect(f.nfc.review(UID)).rejects.toThrow("RECOVERY_INCOMPLETE");
  });
  it("registers, replaces and removes tags without changing identity or extension fields", async () => {
    const f = fixture();
    f.inventory.box.extra = "preserved";
    expect((await f.nfc.assign("12:34", BOX, options)).complete).toBe(true);
    let document = f.documents.get("inventory-file") as typeof f.inventory;
    expect(document.box.nfcIds).toEqual([UID, "1234"]);
    expect(
      (await f.nfc.assign("aa:bb", BOX, { ...options, replace: true }))
        .complete,
    ).toBe(true);
    document = f.documents.get("inventory-file") as typeof f.inventory;
    expect(document.box.nfcIds).toEqual(["AABB"]);
    expect(document.box.id).toBe(BOX);
    expect(document.box.number).toBe("BOX-0001");
    expect(document.box.extra).toBe("preserved");
    expect(f.files.get("box-folder")!.id).toBe("box-folder");
    expect((await f.nfc.remove("aa-bb", BOX, true)).complete).toBe(true);
    expect((await f.nfc.review("AABB")).owner).toBeUndefined();
  });
  it("requires explicit confirmation of a move and removes old authority/index before adding new", async () => {
    const f = fixture();
    await expect(
      f.nfc.assign(UID, SECOND, { ...options, confirmed: false }),
    ).rejects.toThrow("CONFIRMATION_REQUIRED");
    expect((await f.nfc.assign(UID, SECOND, options)).code).toBe(
      "NFC_MOVE_CONFIRMATION_REQUIRED",
    );
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    const result = await f.nfc.assign(UID, SECOND, {
      ...options,
      moveConfirmed: true,
    });
    expect(result.complete).toBe(true);
    expect(result.steps.map((step) => step.boxId)).toEqual([BOX, SECOND]);
    expect(
      vi
        .mocked(f.drive.writeJson)
        .mock.calls.map(([snapshot]) => snapshot.file.id),
    ).toEqual([
      "inventory-file",
      "index-file",
      "empty-inventory",
      "index-file",
    ]);
    expect((await f.nfc.review(UID)).owner?.boxId).toBe(SECOND);
  });
  it("reports old-box partial save and never adds the tag to a second box", async () => {
    const f = fixture();
    const write = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    vi.mocked(f.drive.writeJson).mockImplementation(
      async (snapshot, document) => {
        if (snapshot.file.id === "index-file")
          throw new ClientError("DRIVE_FORBIDDEN");
        return write(snapshot, document);
      },
    );
    const result = await f.nfc.assign(UID, SECOND, {
      ...options,
      moveConfirmed: true,
    });
    expect(result.complete).toBe(false);
    expect(result.steps[0]?.result.outcome).toBe("partial");
    expect(
      (f.documents.get("empty-inventory") as typeof f.empty).box.nfcIds,
    ).toEqual([]);
    expect((await f.nfc.review(UID)).owner).toBeUndefined();
  });
  it("does not bypass production gates or accept context changes", async () => {
    const f = fixture();
    vi.mocked(f.drive.assertWritesAvailable).mockImplementation(() => {
      throw new ClientError("WRITE_GATE_CLOSED");
    });
    await expect(f.nfc.assign("1234", BOX, options)).rejects.toThrow(
      "WRITE_GATE_CLOSED",
    );
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    const read = vi.mocked(f.drive.readJson).getMockImplementation()!;
    vi.mocked(f.drive.readJson).mockImplementation(async (...args) => {
      const result = await read(...args);
      f.nfc.reset();
      return result;
    });
    await expect(f.nfc.review(UID)).rejects.toThrow("CONTEXT_CHANGED");
  });
});
