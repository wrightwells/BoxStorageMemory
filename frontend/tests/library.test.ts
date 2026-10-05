import { describe, expect, it, vi } from "vitest";
import { ClientError } from "../src/services/errors";
import type { JsonSnapshot } from "../src/services/drive";
import { BOX, ITEM, PHOTO, SECOND, fixtureLibrary } from "./library-fixtures";

describe("read-only library", () => {
  it("loads a nested box and normalizes manual numbers", async () => {
    const fixture = fixtureLibrary();
    await fixture.library.load();
    expect(fixture.library.lookup(" box-1 ")?.boxId).toBe(BOX);
    expect((await fixture.library.box(BOX)).inventory.items[0]?.name).toBe(
      "13A Extension Lead",
    );
    expect(fixture.library.lookup("BOX-9999")).toBeUndefined();
    expect(() => fixture.library.lookup("0001")).toThrow("INVALID_BOX_NUMBER");
    expect(fixture.drive.writeJson).not.toHaveBeenCalled();
    expect(fixture.drive.createJson).not.toHaveBeenCalled();
  });
  it("supports empty boxes and a valid empty library", async () => {
    const fixture = fixtureLibrary();
    expect((await fixture.library.box(SECOND)).inventory.items).toEqual([]);
    fixture.index.boxes = [];
    await fixture.library.load(true);
    expect(fixture.library.getSnapshot().index?.boxes).toEqual([]);
  });
  it.each(["missing", "invalid", "newer", "duplicate"])(
    "handles %s index without mutation",
    async (kind) => {
      const fixture = fixtureLibrary();
      if (kind === "missing") fixture.files.delete("index-file");
      if (kind === "invalid")
        fixture.documents.set("index-file", { schemaVersion: 1 });
      if (kind === "newer")
        fixture.documents.set("index-file", { schemaVersion: 2 });
      if (kind === "duplicate")
        fixture.files.set("other-index", {
          ...fixture.indexFile,
          id: "other-index",
        });
      await fixture.library.load();
      expect(fixture.library.getSnapshot().status).toBe("error");
      expect(fixture.library.getSnapshot().index).toBeUndefined();
      expect(fixture.drive.writeJson).not.toHaveBeenCalled();
    },
  );
  it.each(["invalid", "newer", "identity", "duplicate", "missing"])(
    "protects against %s inventory",
    async (kind) => {
      const fixture = fixtureLibrary();
      if (kind === "invalid")
        fixture.documents.set("inventory-file", {
          schemaVersion: 1,
          items: [],
        });
      if (kind === "newer")
        fixture.documents.set("inventory-file", { schemaVersion: 2 });
      if (kind === "identity") fixture.inventory.box.number = "BOX-0010";
      if (kind === "duplicate")
        fixture.files.set("other-inventory", {
          ...fixture.inventoryFile,
          id: "other-inventory",
        });
      if (kind === "missing") fixture.files.delete("inventory-file");
      await expect(fixture.library.box(BOX)).rejects.toBeInstanceOf(
        ClientError,
      );
      expect(fixture.drive.writeJson).not.toHaveBeenCalled();
    },
  );
  it("shows authoritative metadata and picks up external edits after refresh", async () => {
    const fixture = fixtureLibrary();
    await fixture.library.box(BOX);
    fixture.inventory.box.name = "Updated box";
    fixture.inventory.items[0]!.name = "New wording";
    fixture.inventoryFile.version = "2";
    fixture.boxFolder.name = "Renamed in Drive";
    fixture.boxFolder.parents = [fixture.root.id];
    const view = await fixture.library.box(BOX, true);
    expect(view.inventory.box.id).toBe(BOX);
    expect(view.inventory.box.name).toBe("Updated box");
    expect(view.folder.name).toBe("Renamed in Drive");
    expect(view.warnings).toContain("INDEX_STALE");
    expect(view.inventory.items[0]!.name).toBe("New wording");
  });
  it("does not load full photos during box listing and cleans up on context changes", async () => {
    const fixture = fixtureLibrary();
    await fixture.library.box(BOX);
    expect(fixture.drive.image).not.toHaveBeenCalled();
    expect(await fixture.library.photo(BOX, ITEM, PHOTO)).toBe(
      "blob:photo-file",
    );
    fixture.changeContext();
    expect(fixture.drive.releaseImage).toHaveBeenCalledWith("blob:photo-file");
    expect(fixture.library.getSnapshot().index).toBeUndefined();
    expect(fixture.library.getSnapshot().recovery).toBeUndefined();
  });
  it("rejects missing, ambiguous and unreferenced photographs", async () => {
    const fixture = fixtureLibrary();
    fixture.files.delete("photo-file");
    await expect(fixture.library.photo(BOX, ITEM, PHOTO)).rejects.toMatchObject(
      { code: "IMAGE_NOT_FOUND" },
    );
    await expect(
      fixture.library.photo(BOX, ITEM, "unrelated.jpg"),
    ).rejects.toMatchObject({ code: "IMAGE_NOT_FOUND" });
    fixture.files.set("one", {
      id: "one",
      name: PHOTO,
      mimeType: "image/jpeg",
      parents: [fixture.boxFolder.id],
    });
    fixture.files.set("two", { ...fixture.files.get("one")!, id: "two" });
    await expect(fixture.library.photo(BOX, ITEM, PHOTO)).rejects.toMatchObject(
      { code: "DUPLICATE_FILE" },
    );
    expect(fixture.drive.image).not.toHaveBeenCalled();
  });
  it("rejects a delayed inventory response after a root/account change", async () => {
    const fixture = fixtureLibrary();
    await fixture.library.load();
    let resolve!: (value: JsonSnapshot) => void;
    vi.mocked(fixture.drive.readJson).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = fixture.library.box(BOX);
    await vi.waitFor(() => expect(resolve).toBeDefined());
    fixture.changeContext();
    resolve({
      file: fixture.inventoryFile,
      document: fixture.inventory,
      etag: null,
    });
    await expect(pending).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    expect(fixture.library.getSnapshot().index).toBeUndefined();
  });
});

describe("recovery reports and guarded replacement", () => {
  it("rebuilds a missing index recursively and preserves authoritative NFC associations", async () => {
    const fixture = fixtureLibrary();
    fixture.files.delete("index-file");
    const report = await fixture.library.recover();
    expect(report.complete).toBe(true);
    expect(report.discovered).toBe(2);
    expect(
      report.candidate.boxes.find((box) => box.boxId === BOX)?.nfcIds,
    ).toEqual(fixture.inventory.box.nfcIds);
    expect(
      report.candidate.boxes.find((box) => box.boxId === BOX)?.driveFolderId,
    ).toBe("box-folder");
    expect(fixture.drive.writeJson).not.toHaveBeenCalled();
    expect(fixture.drive.createJson).not.toHaveBeenCalled();
  });
  it("finds moved boxes by UUID and preserves supported index extension fields", async () => {
    const fixture = fixtureLibrary();
    fixture.index.futureRoot = { keep: true };
    fixture.index.boxes[0]!.futureEntry = "keep";
    const newFolder = {
      ...fixture.boxFolder,
      id: "moved-folder",
      name: "Moved box",
    };
    fixture.files.delete("box-folder");
    fixture.files.set(newFolder.id, newFolder);
    fixture.inventoryFile.parents = [newFolder.id];
    fixture.files.get("photo-file")!.parents = [newFolder.id];
    const report = await fixture.library.recover();
    expect(report.complete).toBe(true);
    const entry = report.candidate.boxes.find((box) => box.boxId === BOX)!;
    expect(entry.driveFolderId).toBe(newFolder.id);
    expect(entry.futureEntry).toBe("keep");
    expect(report.candidate.futureRoot).toEqual({ keep: true });
  });
  it("retains and reports unavailable entries rather than silently dropping them", async () => {
    const fixture = fixtureLibrary();
    fixture.unavailable.add("empty-folder");
    const report = await fixture.library.recover();
    expect(report.retained).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.candidate.boxes.some((box) => box.boxId === SECOND)).toBe(
      true,
    );
    expect(
      report.issues.some(
        (issue) => issue.code === "UNAVAILABLE_RECORD_RETAINED",
      ),
    ).toBe(true);
    await expect(
      fixture.library.installRecovery(report, true),
    ).rejects.toMatchObject({ code: "RECOVERY_INCOMPLETE" });
  });
  it.each(["number", "uuid", "nfc"])(
    "reports duplicate %s across authoritative inventories",
    async (kind) => {
      const fixture = fixtureLibrary();
      if (kind === "number")
        fixture.empty.box.number = fixture.inventory.box.number;
      if (kind === "uuid") fixture.empty.box.id = BOX;
      if (kind === "nfc")
        fixture.empty.box.nfcIds = [...fixture.inventory.box.nfcIds];
      const report = await fixture.library.recover();
      expect(report.complete).toBe(false);
      expect(
        report.issues.some(
          (issue) =>
            issue.code ===
            {
              number: "DUPLICATE_BOX_NUMBER",
              uuid: "DUPLICATE_BOX_ID",
              nfc: "DUPLICATE_NFC_ID",
            }[kind],
        ),
      ).toBe(true);
    },
  );
  it("reports invalid JSON and newer inventories without changing originals", async () => {
    const fixture = fixtureLibrary();
    fixture.documents.set("inventory-file", new ClientError("INVALID_JSON"));
    fixture.documents.set("empty-inventory", { schemaVersion: 2 });
    const report = await fixture.library.recover();
    expect(report.complete).toBe(false);
    expect(report.retained).toBe(2);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["INVALID_JSON", "UNSUPPORTED_SCHEMA"]),
    );
    expect(fixture.drive.writeJson).not.toHaveBeenCalled();
  });
  it("requires confirmation and rejects an inventory change after preview", async () => {
    const fixture = fixtureLibrary();
    const report = await fixture.library.recover();
    await expect(
      fixture.library.installRecovery(report, false),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    fixture.inventoryFile.version = "2";
    await expect(
      fixture.library.installRecovery(report, true),
    ).rejects.toMatchObject({ code: "READ_CONFLICT" });
    expect(fixture.drive.writeJson).not.toHaveBeenCalled();
  });
  it("rejects newly added inventories and stale reports after context changes", async () => {
    const fixture = fixtureLibrary();
    const report = await fixture.library.recover();
    fixture.files.set("new-inventory", {
      ...fixture.inventoryFile,
      id: "new-inventory",
    });
    await expect(
      fixture.library.installRecovery(report, true),
    ).rejects.toMatchObject({ code: "READ_CONFLICT" });
    fixture.changeContext();
    await expect(
      fixture.library.installRecovery(report, true),
    ).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
  });
  it("fails closed on the write gate even after a clean reviewed snapshot", async () => {
    const fixture = fixtureLibrary();
    const report = await fixture.library.recover();
    await expect(
      fixture.library.installRecovery(report, true),
    ).rejects.toMatchObject({ code: "WRITE_GATE_CLOSED" });
    expect(fixture.drive.createJson).not.toHaveBeenCalled();
    expect(fixture.drive.writeJson).toHaveBeenCalledExactlyOnceWith(
      report.source,
      report.candidate,
    );
  });
});

it("previews a restored synthetic library with changed Drive IDs while retaining permanent identities and filenames", async () => {
  const f = fixtureLibrary();
  const backupFiles = [...f.files.values()].map((file) =>
    structuredClone(file),
  );
  const backupDocuments = structuredClone([...f.documents]);
  const remap = (id: string) =>
    backupFiles.some((file) => file.id === id) ? `restored-${id}` : id;
  f.root.id = remap(f.root.id);
  f.files.clear();
  f.documents.clear();
  for (const file of backupFiles)
    f.files.set(remap(file.id), {
      ...file,
      id: remap(file.id),
      parents: file.parents?.map(remap),
    });
  for (const [id, document] of backupDocuments)
    f.documents.set(remap(id), document);
  f.library.reset();
  const report = await f.library.recover();
  expect(report.complete).toBe(true);
  expect(
    report.candidate.boxes.find((box) => box.boxId === BOX)?.driveFolderId,
  ).toBe("restored-box-folder");
  expect(
    report.candidate.boxes.find((box) => box.boxId === BOX)?.boxNumber,
  ).toBe("BOX-0001");
  expect(
    (f.documents.get("restored-inventory-file") as typeof f.inventory).items[0]
      ?.images,
  ).toEqual(f.inventory.items[0]?.images);
  // Test fixture publication only: production replacement remains gated.
  f.documents.set("restored-index-file", report.candidate);
  f.library.reset();
  expect((await f.library.box(BOX)).inventory.box.nfcIds).toEqual(
    f.inventory.box.nfcIds,
  );
});
