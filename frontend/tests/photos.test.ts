import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Inventory } from "../../shared/typescript/models";
import { ClientError } from "../src/services/errors";
import {
  PhotoService,
  photoFilename,
  type PhotoDrive,
} from "../src/services/photos";
import { editingFixture } from "./editing-fixtures";
import { BOX, ITEM, PHOTO } from "./library-fixtures";

function fixture(dirty = false) {
  const f = editingFixture();
  const uploaded: Blob[] = [];
  const drive: PhotoDrive = {
    ...f.drive,
    uploadImage: vi.fn(async (parent, name, blob, appProperties) => {
      uploaded.push(blob);
      const file = {
        id: crypto.randomUUID(),
        name,
        mimeType: blob.type,
        parents: [parent],
        version: "1",
        appProperties,
      };
      f.files.set(file.id, file);
      return structuredClone(file);
    }),
  };
  let generation = 1;
  const process = vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" }));
  const photos = new PhotoService(
    drive,
    f.library,
    f.api,
    () => generation,
    () => dirty,
    process,
  );
  return {
    ...f,
    drive,
    photos,
    process,
    uploaded,
    reset: () => {
      generation++;
      photos.reset();
      f.library.reset();
    },
  };
}
async function ready() {
  const f = fixture();
  await f.photos.open(BOX, ITEM);
  await f.photos.select([new Blob(["source"], { type: "image/png" })]);
  return f;
}
function owned(f: ReturnType<typeof fixture>) {
  f.files.get("photo-file")!.appProperties = {
    bsmBoxId: BOX,
    bsmItemId: ITEM,
    bsmPhotoOperationId: "prior-operation",
  };
}
beforeEach(() => {
  let id = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:preview-${++id}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());
describe("photo mutations using the atomic simulator", () => {
  it("uploads descriptive box/item context with an ordinary JPEG filename", async () => {
    const f = await ready();
    await f.photos.save({ kind: "add" });
    const args = vi.mocked(f.drive.uploadImage).mock.calls[0]!;
    expect(args[1]).toContain("BOX-0001");
    expect(args[1]).toMatch(/\.jpg$/);
    expect(args[4]).toContain("BOX-0001");
    expect(args[4]).toContain("13A Extension Lead");
    expect(args[4]).toContain(`Item ID: ${ITEM}`);
  });
  it("retains the losing writer's upload when two clients race the inventory", async () => {
    const f = await ready();
    const other = new PhotoService(
      f.drive,
      f.makeEditor().library,
      f.api,
      () => 1,
      () => false,
      f.process,
    );
    await other.open(BOX, ITEM);
    await other.select([new Blob(["other"])]);
    const upload = vi.mocked(f.drive.uploadImage).getMockImplementation()!;
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.drive.uploadImage).mockImplementation(async (...args) => {
      const result = await upload(...args);
      if (++arrived === 2) release();
      await barrier;
      return result;
    });
    const outcomes = await Promise.allSettled([
      f.photos.save({ kind: "add" }),
      other.save({ kind: "add" }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (f.documents.get("inventory-file") as Inventory).items[0]!.images,
    ).toHaveLength(2);
    expect(f.uploaded).toHaveLength(2);
    expect(f.drive.trash).not.toHaveBeenCalled();
    expect(
      [f.photos, other].filter((photos) => photos.getSnapshot().locked),
    ).toHaveLength(1);
    other.reset();
    f.photos.reset();
  });
  it("rejects insufficient permissions before upload", async () => {
    const f = await ready();
    f.files.get("inventory-file")!.capabilities = { canEdit: false };
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "DRIVE_FORBIDDEN",
    });
    expect(f.drive.uploadImage).not.toHaveBeenCalled();
    expect(f.drive.writeJson).not.toHaveBeenCalled();
  });
  it("removes missing photo references and allows item removal without deleting unrelated files", async () => {
    const f = fixture();
    f.files.delete("photo-file");
    await f.photos.open(BOX, ITEM);
    await f.photos.save({ kind: "remove", filename: PHOTO }, true);
    expect(
      (f.documents.get("inventory-file") as Inventory).items[0]!.images,
    ).toEqual([]);
    expect(f.photos.getSnapshot().messages.join(" ")).toContain(
      "already missing",
    );
    expect(f.drive.trash).not.toHaveBeenCalled();
    await f.photos.save({ kind: "item" }, true);
    expect((f.documents.get("inventory-file") as Inventory).items).toEqual([]);
    expect(f.files.has("inventory-file")).toBe(true);
  });
  it("stops cleanup when another client introduces invalid shared references", async () => {
    const f = fixture();
    owned(f);
    await f.photos.open(BOX, ITEM);
    await f.photos.save({ kind: "remove", filename: PHOTO }, true);
    const inventory = f.documents.get("inventory-file") as Inventory;
    inventory.items[0]!.images = [PHOTO];
    inventory.items.push({
      id: crypto.randomUUID(),
      name: "Shared",
      quantity: 1,
      images: [PHOTO],
    });
    f.files.get("inventory-file")!.version = "3";
    await expect(f.photos.cleanup(true)).rejects.toMatchObject({
      code: "INVALID_INVENTORY",
    });
    expect(f.drive.trash).not.toHaveBeenCalled();
    expect(f.photos.getSnapshot().operation).toBeDefined();
  });
  it("uploads all JPEGs before publishing filename-only references and preserves identity/extensions", async () => {
    const f = await ready();
    await f.photos.select([new Blob(["another"])]);
    const order: string[] = [];
    const upload = vi.mocked(f.drive.uploadImage).getMockImplementation()!;
    vi.spyOn(f.drive, "uploadImage").mockImplementation(async (...args) => {
      order.push("upload");
      return upload(...args);
    });
    const write = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    vi.spyOn(f.drive, "writeJson").mockImplementation(async (...args) => {
      order.push("reference");
      return write(...args);
    });
    await f.photos.save({ kind: "add" });
    expect(order).toEqual(["upload", "upload", "reference"]);
    const document = f.documents.get("inventory-file") as Inventory;
    expect(document.box.id).toBe(BOX);
    expect(document.box.nfcIds).toEqual(f.inventory.box.nfcIds);
    expect(document.items[0]!.id).toBe(ITEM);
    expect(document.items[0]!.images).toHaveLength(3);
    expect(
      document.items[0]!.images!.every((name) => !name.includes("data:")),
    ).toBe(true);
    expect(f.uploaded.every((blob) => blob.type === "image/jpeg")).toBe(true);
    expect(document.items[0]!.images![1]).toMatch(
      new RegExp(`^BOX-0001-.+-${ITEM}-.+\\.jpg$`),
    );
    expect(f.photos.getSnapshot().selected).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("keeps known uploaded orphans after a failed CAS and explicitly retries references without reupload", async () => {
    const f = await ready();
    vi.mocked(f.drive.writeJson).mockRejectedValueOnce(
      new ClientError("NETWORK_FAILED"),
    );
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "NETWORK_FAILED",
    });
    expect(f.photos.getSnapshot().locked).toBe(true);
    expect(f.photos.getSnapshot().operation!.uploaded).toHaveLength(1);
    expect(f.inventory.items[0]!.images).toEqual([PHOTO]);
    expect(f.drive.trash).not.toHaveBeenCalled();
    await expect(f.photos.review(true, false)).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });
    await f.photos.review(true, true);
    expect(f.drive.uploadImage).toHaveBeenCalledTimes(1);
    expect(f.photos.getSnapshot().operation).toBeUndefined();
    expect(
      (f.documents.get("inventory-file") as Inventory).items[0]!.images,
    ).toHaveLength(2);
  });
  it("recognises a lost successful CAS response by rereading, without repeating it", async () => {
    const f = await ready();
    const write = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    vi.spyOn(f.drive, "writeJson").mockImplementation(async (...args) => {
      await write(...args);
      throw new ClientError("AMBIGUOUS_WRITE");
    });
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "AMBIGUOUS_WRITE",
    });
    await f.photos.review();
    expect(f.photos.getSnapshot().operation).toBeUndefined();
    expect(f.drive.writeJson).toHaveBeenCalledTimes(1);
    expect(f.drive.uploadImage).toHaveBeenCalledTimes(1);
  });
  it("retains unknown ambiguous uploads and prohibits automatic replay", async () => {
    const f = await ready();
    const upload = vi.mocked(f.drive.uploadImage).getMockImplementation()!;
    vi.spyOn(f.drive, "uploadImage").mockImplementation(async (...args) => {
      await upload(...args);
      throw new ClientError("AMBIGUOUS_WRITE");
    });
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "AMBIGUOUS_WRITE",
    });
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "EDIT_LOCKED",
    });
    await expect(f.photos.review(true, true)).rejects.toMatchObject({
      code: "DRIVE_CONFLICT",
    });
    await f.photos.cleanup(true);
    expect(f.photos.getSnapshot().messages.join(" ")).toContain(
      "Upload response was lost",
    );
    expect(f.drive.trash).not.toHaveBeenCalled();
    expect(f.photos.getSnapshot().locked).toBe(true);
  });
  it("replaces references before separately confirmed cleanup of an owned old file", async () => {
    const f = await ready();
    owned(f);
    await expect(
      f.photos.save({ kind: "replace", filename: PHOTO }),
    ).rejects.toMatchObject({ code: "DELETE_CONFIRMATION_REQUIRED" });
    await f.photos.save({ kind: "replace", filename: PHOTO }, true);
    expect(
      (f.documents.get("inventory-file") as Inventory).items[0]!.images,
    ).not.toContain(PHOTO);
    expect(f.files.has("photo-file")).toBe(true);
    await expect(f.photos.cleanup(false)).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });
    await f.photos.cleanup(true);
    expect(f.files.has("photo-file")).toBe(false);
    expect(f.drive.trash).toHaveBeenCalledWith("photo-file");
  });
  it("rejects invalid shared ownership before any photo mutation", async () => {
    const f = fixture();
    owned(f);
    f.inventory.items.push({
      id: crypto.randomUUID(),
      name: "Other",
      quantity: 1,
      images: [PHOTO],
    });
    await expect(f.photos.open(BOX, ITEM)).rejects.toMatchObject({
      code: "INVALID_INVENTORY",
    });
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("retains old files with no app ownership metadata", async () => {
    const f = fixture();
    await f.photos.open(BOX, ITEM);
    await f.photos.save({ kind: "item" }, true);
    expect(
      (f.documents.get("inventory-file") as Inventory).items.some(
        (item) => item.id === ITEM,
      ),
    ).toBe(false);
    await f.photos.cleanup(true);
    expect(f.drive.trash).not.toHaveBeenCalled();
    expect(f.files.has("photo-file")).toBe(true);
  });
  it("rejects external inventory changes before upload", async () => {
    const f = await ready();
    f.files.get("inventory-file")!.version = "2";
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "DRIVE_CONFLICT",
    });
    expect(f.drive.uploadImage).not.toHaveBeenCalled();
    expect(f.photos.getSnapshot().locked).toBe(false);
  });
  it("rejects inventory changes during upload, preserving the new file for review", async () => {
    const f = await ready();
    const upload = vi.mocked(f.drive.uploadImage).getMockImplementation()!;
    vi.spyOn(f.drive, "uploadImage").mockImplementation(async (...args) => {
      const file = await upload(...args);
      f.files.get("inventory-file")!.version = "2";
      return file;
    });
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "DRIVE_CONFLICT",
    });
    await expect(f.photos.review(true, true)).rejects.toMatchObject({
      code: "DRIVE_CONFLICT",
    });
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("blocks cleanup if the filename became duplicated or file was replaced/changed", async () => {
    const f = fixture();
    owned(f);
    await f.photos.open(BOX, ITEM);
    await f.photos.save({ kind: "remove", filename: PHOTO }, true);
    const photo = f.files.get("photo-file")!;
    f.files.set("duplicate", { ...photo, id: "duplicate" });
    await expect(f.photos.cleanup(true)).rejects.toMatchObject({
      code: "DUPLICATE_FILE",
    });
    expect(f.drive.trash).not.toHaveBeenCalled();
    f.files.delete("duplicate");
    photo.version = "2";
    await f.photos.cleanup(true);
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("rechecks references on cleanup and retains a newly referenced file", async () => {
    const f = fixture();
    owned(f);
    await f.photos.open(BOX, ITEM);
    await f.photos.save({ kind: "remove", filename: PHOTO }, true);
    const inventory = f.documents.get("inventory-file") as Inventory;
    inventory.items[0]!.images = [PHOTO];
    f.files.get("inventory-file")!.version = "3";
    await f.photos.cleanup(true);
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("retains orphan records on trash failure and recognises already removed files on retry", async () => {
    const f = await ready();
    vi.mocked(f.drive.writeJson).mockRejectedValueOnce(
      new ClientError("DRIVE_CONFLICT"),
    );
    await expect(f.photos.save({ kind: "add" })).rejects.toBeInstanceOf(
      ClientError,
    );
    const trash = vi.mocked(f.drive.trash).getMockImplementation()!;
    vi.spyOn(f.drive, "trash").mockImplementationOnce(async (id) => {
      await trash(id);
      throw new ClientError("AMBIGUOUS_WRITE");
    });
    await expect(f.photos.cleanup(true)).rejects.toMatchObject({
      code: "AMBIGUOUS_WRITE",
    });
    expect(f.photos.getSnapshot().operation).toBeDefined();
    await f.photos.cleanup(true);
    expect(f.photos.getSnapshot().operation).toBeUndefined();
  });
  it("does not publish or expose late upload completion after a root/account change", async () => {
    const f = await ready();
    const upload = vi.mocked(f.drive.uploadImage).getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.drive, "uploadImage").mockImplementation(async (...args) => {
      await pending;
      return upload(...args);
    });
    const saving = f.photos.save({ kind: "add" });
    await vi.waitFor(() => expect(f.drive.uploadImage).toHaveBeenCalled());
    f.reset();
    release();
    await expect(saving).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    expect(f.photos.getSnapshot().view).toBeUndefined();
    expect(f.photos.getSnapshot().selected).toEqual([]);
  });
  it("fails closed before any upload, reference write or trash when production gate is closed", async () => {
    const f = await ready();
    vi.mocked(f.drive.assertWritesAvailable).mockImplementation(() => {
      throw new ClientError("WRITE_GATE_CLOSED");
    });
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "WRITE_GATE_CLOSED",
    });
    expect(f.drive.uploadImage).not.toHaveBeenCalled();
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    expect(f.drive.trash).not.toHaveBeenCalled();
    expect(f.photos.getSnapshot().selected).toHaveLength(1);
  });
  it("blocks photo mutations while an inventory draft is dirty", async () => {
    const f = fixture(true);
    await f.photos.open(BOX, ITEM);
    await f.photos.select([new Blob(["source"])]);
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "PHOTO_EDITOR_DIRTY",
    });
    expect(f.drive.uploadImage).not.toHaveBeenCalled();
  });
  it("retains uploaded files if service-side validation is unavailable", async () => {
    const f = await ready();
    vi.mocked(f.api.validate).mockRejectedValueOnce(
      new ClientError("API_UNAVAILABLE"),
    );
    await expect(f.photos.save({ kind: "add" })).rejects.toMatchObject({
      code: "API_UNAVAILABLE",
    });
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    expect(f.drive.trash).not.toHaveBeenCalled();
    expect(f.photos.getSnapshot().operation!.uploaded).toHaveLength(1);
  });
});
describe("photo selections", () => {
  it("bounds batches, retains valid earlier selections, releases previews on removal and reset", async () => {
    const f = fixture();
    await f.photos.open(BOX, ITEM);
    await expect(
      f.photos.select(Array.from({ length: 21 }, () => new Blob(["image"]))),
    ).rejects.toMatchObject({ code: "TOO_MANY_PHOTOS" });
    await f.photos.select([new Blob(["image"])]);
    const id = f.photos.getSnapshot().selected[0]!.id;
    f.photos.drop(id);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    await f.photos.select([new Blob(["image"])]);
    f.reset();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it("uses descriptive safe bounded filenames with unique photo UUIDs", () => {
    const f = fixture();
    f.inventory.items[0]!.name = "../Power sockets %?# $ camera".repeat(20);
    const one = photoFilename(f.inventory, ITEM, crypto.randomUUID()),
      two = photoFilename(f.inventory, ITEM, crypto.randomUUID());
    expect(one).not.toBe(two);
    expect(one.length).toBeLessThan(256);
    expect(one).not.toMatch(/[/%?#]/);
    expect(one).toContain(ITEM);
  });
});
describe("owned upload recovery after restart", () => {
  async function interrupted() {
    const f = await ready();
    vi.mocked(f.drive.writeJson).mockRejectedValueOnce(
      new ClientError("NETWORK_FAILED"),
    );
    await expect(f.photos.save({ kind: "add" })).rejects.toBeInstanceOf(
      ClientError,
    );
    const file = f.photos.getSnapshot().operation!.uploaded[0]!;
    f.photos.reset();
    const restarted = new PhotoService(
      f.drive,
      f.library,
      f.api,
      () => 1,
      () => false,
      f.process,
    );
    await restarted.open(BOX, ITEM);
    return { ...f, restarted, file };
  }
  it("discovers a lost-response upload after restart and associates it explicitly without reupload", async () => {
    const f = await ready();
    const upload = vi.mocked(f.drive.uploadImage).getMockImplementation()!;
    vi.mocked(f.drive.uploadImage).mockImplementationOnce(async (...args) => {
      await upload(...args);
      throw new ClientError("AMBIGUOUS_WRITE");
    });
    await expect(f.photos.save({ kind: "add" })).rejects.toBeInstanceOf(
      ClientError,
    );
    await expect(f.photos.forgetOperation(false)).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });
    await f.photos.forgetOperation(true);
    const recovered = f.photos
      .getSnapshot()
      .recovered.filter((p) => p.eligible);
    expect(recovered).toHaveLength(1);
    expect(f.photos.getSnapshot().operation).toBeUndefined();
    await expect(
      f.photos.recoverFiles([recovered[0]!.file.id], "associate", false),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await f.photos.recoverFiles([recovered[0]!.file.id], "associate", true);
    expect(
      (f.documents.get("inventory-file") as Inventory).items[0]!.images,
    ).toContain(recovered[0]!.file.name);
    expect(f.drive.uploadImage).toHaveBeenCalledTimes(1);
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("reconstructs only owned orphan candidates after memory is cleared and supports confirmed cleanup", async () => {
    const f = await interrupted();
    const recovered = await f.restarted.discover();
    expect(recovered.filter((p) => p.eligible).map((p) => p.file.id)).toEqual([
      f.file.id,
    ]);
    expect(f.drive.trash).not.toHaveBeenCalled();
    await f.restarted.recoverFiles([f.file.id], "cleanup", true);
    expect(f.files.has(f.file.id)).toBe(false);
    expect(f.files.has("photo-file")).toBe(true);
    expect(f.drive.uploadImage).toHaveBeenCalledTimes(1);
  });
  it("retains referenced, duplicate, malformed and unrelated files", async () => {
    const f = await interrupted();
    f.files.set("duplicate", { ...f.file, id: "duplicate" });
    expect((await f.restarted.discover()).every((p) => !p.eligible)).toBe(true);
    f.files.delete("duplicate");
    f.files.get(f.file.id)!.appProperties!.bsmPhotoOperationId =
      "not-an-operation-uuid";
    expect((await f.restarted.discover()).every((p) => !p.eligible)).toBe(true);
    f.files.get(f.file.id)!.appProperties!.bsmPhotoOperationId =
      crypto.randomUUID();
    (f.documents.get("inventory-file") as Inventory).items[0]!.images!.push(
      f.file.name,
    );
    f.files.get("inventory-file")!.version = "3";
    const referenced = await f.restarted.discover();
    expect(referenced[0]!.eligible).toBe(false);
    expect(referenced[0]!.reason).toContain("Referenced");
    expect(referenced.some((p) => p.file.id === "photo-file")).toBe(false);
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("rejects files changed or newly referenced since the recovery review", async () => {
    const f = await interrupted();
    await f.restarted.discover();
    f.files.get(f.file.id)!.version = "2";
    await expect(
      f.restarted.recoverFiles([f.file.id], "cleanup", true),
    ).rejects.toMatchObject({ code: "DRIVE_CONFLICT" });
    await f.restarted.discover();
    (f.documents.get("inventory-file") as Inventory).items[0]!.images!.push(
      f.file.name,
    );
    f.files.get("inventory-file")!.version = "3";
    await expect(
      f.restarted.recoverFiles([f.file.id], "associate", true),
    ).rejects.toMatchObject({ code: "DRIVE_CONFLICT" });
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it("allows owned file review for a deleted item without recreating it", async () => {
    const f = await interrupted();
    (f.documents.get("inventory-file") as Inventory).items = [];
    f.files.get("inventory-file")!.version = "3";
    await f.restarted.open(BOX, ITEM);
    await f.restarted.discover();
    await expect(
      f.restarted.recoverFiles([f.file.id], "associate", true),
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    await f.restarted.recoverFiles([f.file.id], "cleanup", true);
    expect((f.documents.get("inventory-file") as Inventory).items).toEqual([]);
    await expect(
      f.restarted.open(BOX, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
  });
  it("permits read-only discovery while keeping production recovery mutations gated", async () => {
    const f = await interrupted();
    vi.mocked(f.drive.assertWritesAvailable).mockImplementation(() => {
      throw new ClientError("WRITE_GATE_CLOSED");
    });
    expect(
      (await f.restarted.discover()).filter((p) => p.eligible),
    ).toHaveLength(1);
    await expect(
      f.restarted.recoverFiles([f.file.id], "associate", true),
    ).rejects.toMatchObject({ code: "WRITE_GATE_CLOSED" });
    expect(f.drive.trash).not.toHaveBeenCalled();
    expect(f.drive.writeJson).toHaveBeenCalledTimes(1);
  });
});
