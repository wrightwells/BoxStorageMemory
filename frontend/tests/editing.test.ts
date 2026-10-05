import { describe, expect, it, vi } from "vitest";
import { ClientError } from "../src/services/errors";
import { editingFixture } from "./editing-fixtures";
import { BOX, ITEM, SECOND } from "./library-fixtures";
import { SearchService, matchSearch } from "../src/services/search";

const open = async () => {
  const f = editingFixture();
  await f.editing.open(BOX);
  return f;
};
describe("inventory draft editing", () => {
  it("invalidates search after a save and reloads the authoritative item wording", async () => {
    const f = editingFixture();
    const search = new SearchService(
      { ...f.drive, image: vi.fn(), releaseImage: vi.fn() },
      f.library,
      () => 1,
    );
    await search.load();
    await f.editing.open(BOX);
    await search.load();
    expect(search.getSnapshot().records).not.toEqual([]);
    f.editing.item(ITEM, { description: "New searchable wording" });
    expect((await f.editing.save())?.outcome).toBe("complete");
    expect(search.getSnapshot().records).toEqual([]);
    await search.load();
    expect(
      matchSearch(search.getSnapshot().records, "searchable wording")[0]
        ?.itemId,
    ).toBe(ITEM);
    expect(f.files.get("box-folder")!.description).toContain("BOX-0001");
    search.dispose();
  });
  it("clears search when inventory saves but folder metadata publication fails", async () => {
    const f = editingFixture();
    const search = new SearchService(
      { ...f.drive, image: vi.fn(), releaseImage: vi.fn() },
      f.library,
      () => 1,
    );
    await search.load();
    await f.editing.open(BOX);
    await search.load();
    expect(search.getSnapshot().records).not.toEqual([]);
    f.editing.item(ITEM, { notes: "Published before metadata failure" });
    vi.mocked(f.drive.renameFile).mockRejectedValue(
      new ClientError("DRIVE_FORBIDDEN"),
    );
    expect((await f.editing.save())?.outcome).toBe("partial");
    expect(search.getSnapshot().records).toEqual([]);
    await search.load();
    expect(
      matchSearch(search.getSnapshot().records, "metadata failure")[0]?.itemId,
    ).toBe(ITEM);
    search.dispose();
  });
  it("preserves extension fields, UUIDs, numbers, creation time and image references", async () => {
    const f = editingFixture();
    f.inventory.extraRoot = { source: "external" };
    f.inventory.box.extraBox = { label: 7 };
    f.inventory.items[0]!.extraItem = { untouched: true };
    f.index.boxes[0]!.extraIndex = { preserved: true };
    f.index.extraRoot = "index";
    await f.editing.open(BOX);
    f.editing.box({
      name: "Electrical supplies",
      location: "Attic",
      tags: ["Power"],
    });
    f.editing.item(ITEM, {
      quantity: 0,
      description: "Updated details",
      notes: "Check cable",
      tags: ["Cable"],
    });
    const result = await f.editing.save();
    expect(result?.outcome).toBe("complete");
    const saved = f.documents.get("inventory-file") as typeof f.inventory;
    expect(saved.extraRoot).toEqual({ source: "external" });
    expect(saved.box.extraBox).toEqual({ label: 7 });
    expect(saved.box.id).toBe(BOX);
    expect(saved.box.number).toBe("BOX-0001");
    expect(saved.box.created).toBe(f.inventory.box.created);
    expect(saved.items[0]!.extraItem).toEqual({ untouched: true });
    expect(saved.items[0]!.images).toEqual(f.inventory.items[0]!.images);
    expect(saved.items[0]!.quantity).toBe(0);
    expect(f.files.get("box-folder")!.name).toBe(
      "BOX-0001 Electrical supplies",
    );
    const index = f.documents.get("index-file") as typeof f.index;
    expect(index.extraRoot).toBe("index");
    expect(index.boxes.find((b) => b.boxId === BOX)!.extraIndex).toEqual({
      preserved: true,
    });
    expect(index.boxes.find((b) => b.boxId === BOX)!.location).toBe("Attic");
  });
  it("rejects identity and image/NFC edits", async () => {
    const f = await open();
    expect(() => f.editing.box({ number: "BOX-0009" })).toThrow(
      "IMMUTABLE_IDENTITY",
    );
    expect(() => f.editing.box({ nfcIds: [] })).toThrow("IMMUTABLE_IDENTITY");
    expect(() => f.editing.item(ITEM, { id: crypto.randomUUID() })).toThrow(
      "IMMUTABLE_IDENTITY",
    );
    expect(() => f.editing.item(ITEM, { images: [] })).toThrow(
      "IMMUTABLE_IDENTITY",
    );
  });
  it("adds stable UUID items and requires explicit removal confirmation, retaining photos", async () => {
    const f = await open();
    const id = f.editing.addItem();
    f.editing.item(id, { name: "New cable", quantity: 2 });
    expect(() => f.editing.removeItem(ITEM, false)).toThrow(
      "DELETE_CONFIRMATION_REQUIRED",
    );
    f.editing.removeItem(ITEM, true);
    await f.editing.save();
    expect(
      (f.documents.get("inventory-file") as typeof f.inventory).items[0]!.id,
    ).toBe(id);
    expect(f.files.has("photo-file")).toBe(true);
    expect(f.drive.trash).not.toHaveBeenCalled();
  });
  it.each([
    { name: "   " },
    { quantity: -1 },
    { quantity: 1.5 },
    { quantity: NaN },
    { tags: ["duplicate", "duplicate"] },
  ])("blocks invalid item edits %j before API/writes", async (changes) => {
    const f = await open();
    f.editing.item(ITEM, changes);
    expect(await f.editing.validate()).toBe(false);
    expect(f.editing.getSnapshot().issues.length).toBeGreaterThan(0);
    expect(f.api.validate).not.toHaveBeenCalled();
    expect(f.drive.writeJson).not.toHaveBeenCalled();
  });
  it("validates both documents with the API and retains drafts on API failure", async () => {
    const f = await open();
    f.editing.box({ name: "Changed name" });
    vi.mocked(f.api.validate).mockRejectedValue(
      new ClientError("API_UNAVAILABLE"),
    );
    expect(await f.editing.save()).toBeUndefined();
    expect(f.editing.getSnapshot().error).toBe("API_UNAVAILABLE");
    expect(f.editing.getSnapshot().draft!.document.box.name).toBe(
      "Changed name",
    );
    expect(f.drive.writeJson).not.toHaveBeenCalled();
  });
  it("shows remote validation errors without performing a write", async () => {
    const f = await open();
    f.editing.box({ name: "Changed" });
    vi.mocked(f.api.validate).mockResolvedValue({
      valid: false,
      errors: [
        { path: "/box/name", code: "SCHEMA_VIOLATION", message: "Rejected" },
      ],
    });
    expect(await f.editing.save()).toBeUndefined();
    expect(f.editing.getSnapshot().issues[0]!.path).toBe("/box/name");
    expect(f.drive.writeJson).not.toHaveBeenCalled();
  });
  it("opens explicit read-only permissions and safely refuses newer/invalid documents", async () => {
    const f = editingFixture();
    f.inventoryFile.capabilities = { canEdit: false };
    await f.editing.open(BOX);
    expect(f.editing.getSnapshot().draft!.readOnly).toBe(true);
    expect(() => f.editing.box({ name: "No" })).toThrow("DRIVE_FORBIDDEN");
    f.documents.set("inventory-file", { schemaVersion: 2 });
    await f.editing.open(BOX, true);
    expect(f.editing.getSnapshot().error).toBe("UNSUPPORTED_SCHEMA");
    expect(f.editing.getSnapshot().draft).toBeUndefined();
  });
  it("fails closed before any mutation, retaining a valid draft", async () => {
    const f = await open();
    f.editing.box({ name: "Changed" });
    vi.mocked(f.drive.assertWritesAvailable).mockImplementation(() => {
      throw new ClientError("WRITE_GATE_CLOSED");
    });
    expect((await f.editing.save())?.outcome).toBe("blocked");
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    expect(f.editing.getSnapshot().dirty).toBe(true);
    expect(f.editing.getSnapshot().locked).toBe(false);
  });
  it("detects a stale inventory or index without overwriting external changes", async () => {
    for (const id of ["inventory-file", "index-file"]) {
      const f = await open();
      f.editing.box({ name: "Draft" });
      f.files.get(id)!.version = "2";
      expect((await f.editing.save())?.outcome).toBe("conflict");
      expect(f.drive.writeJson).not.toHaveBeenCalled();
      expect(f.editing.getSnapshot().draft!.document.box.name).toBe("Draft");
    }
  });
  it("rejects duplicates introduced after editor load", async () => {
    const f = await open();
    f.editing.box({ name: "Draft" });
    f.files.set("duplicate", { ...f.inventoryFile, id: "duplicate" });
    expect((await f.editing.save())?.code).toBe("DUPLICATE_INVENTORY");
    expect(f.drive.writeJson).not.toHaveBeenCalled();
  });
  it("records inventory success and index failure, then reconciles current authoritative metadata", async () => {
    const f = await open();
    f.editing.box({ name: "Committed inventory" });
    const atomic = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    vi.mocked(f.drive.writeJson).mockImplementation(async (snapshot, value) => {
      if (snapshot.file.id === "index-file")
        throw new ClientError("DRIVE_FORBIDDEN");
      return atomic(snapshot, value);
    });
    const result = await f.editing.save();
    expect(result?.outcome).toBe("partial");
    expect(result?.steps.map((s) => s.phase)).toEqual(["inventory"]);
    expect(f.editing.getSnapshot().locked).toBe(true);
    await expect(f.editing.save()).rejects.toThrow("EDIT_LOCKED");
    vi.mocked(f.drive.writeJson).mockImplementation(atomic);
    await f.editing.reviewOperation();
    expect(f.editing.getSnapshot().reconciliation!.document.box.name).toBe(
      "Committed inventory",
    );
    await expect(f.editing.reconcile(false)).rejects.toThrow(
      "CONFIRMATION_REQUIRED",
    );
    const calls = vi.mocked(f.drive.writeJson).mock.calls.length;
    expect((await f.editing.reconcile(true))?.outcome).toBe("complete");
    expect(
      vi
        .mocked(f.drive.writeJson)
        .mock.calls.slice(calls)
        .map((c) => c[0].file.id),
    ).toEqual(["index-file"]);
  });
  it("reports an ambiguous committed write and never retries it automatically", async () => {
    const f = await open();
    f.editing.box({ name: "Ambiguous" });
    const atomic = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    vi.mocked(f.drive.writeJson).mockImplementation(async (snapshot, value) => {
      await atomic(snapshot, value);
      throw new ClientError("AMBIGUOUS_WRITE");
    });
    const result = await f.editing.save();
    expect(result?.outcome).toBe("ambiguous");
    expect(result?.steps).toEqual([
      { phase: "inventory", status: "uncertain" },
    ]);
    expect(f.drive.writeJson).toHaveBeenCalledTimes(1);
    expect(f.editing.getSnapshot().dirty).toBe(true);
    await f.editing.reviewOperation();
    expect(f.editing.getSnapshot().inspection!.inventory).toMatchObject({
      box: { name: "Ambiguous" },
    });
  });
  it("does not report success when folder naming fails after inventory/index commits", async () => {
    const f = await open();
    f.editing.box({ name: "Rename" });
    vi.mocked(f.drive.renameFile).mockRejectedValue(
      new ClientError("DRIVE_FORBIDDEN"),
    );
    const result = await f.editing.save();
    expect(result?.outcome).toBe("partial");
    expect(result?.phase).toBe("folder");
    expect(result?.steps.map((s) => s.phase)).toEqual(["inventory", "index"]);
  });
  it("clears drafts and ignores late API responses after a context change", async () => {
    const f = await open();
    f.editing.box({ name: "Private draft" });
    let finish!: (value: { valid: boolean; errors: [] }) => void;
    vi.mocked(f.api.validate).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.editing.save();
    f.resetContext();
    finish({ valid: true, errors: [] });
    expect(await pending).toBeUndefined();
    expect(f.editing.getSnapshot().draft).toBeUndefined();
    expect(f.drive.writeJson).not.toHaveBeenCalled();
  });
  it("never repaints an old operation result after context reset during a write", async () => {
    const f = await open();
    f.editing.box({ name: "Private draft" });
    let finish!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const atomic = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    vi.mocked(f.drive.writeJson).mockImplementation(async (snapshot, value) => {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return atomic(snapshot, value);
    });
    const pending = f.editing.save();
    await startedPromise;
    f.resetContext();
    finish();
    await pending;
    expect(f.editing.getSnapshot().draft).toBeUndefined();
    expect(f.editing.getSnapshot().result).toBeUndefined();
  });
});

describe("creation and concurrent-client simulator", () => {
  it.each(["marker", "draft", "claim", "cleanup"] as const)(
    "reports interrupted %s creation with its durable state and no false success",
    async (phase) => {
      const f = editingFixture();
      await f.editing.open();
      f.editing.box({ name: "Interrupted creation" });
      const create = vi.mocked(f.drive.createJson).getMockImplementation()!;
      if (phase === "marker" || phase === "draft")
        vi.mocked(f.drive.createJson).mockImplementation(
          async (parent, name, value) => {
            if (
              name ===
              (phase === "marker"
                ? "box-storage-pending.json"
                : "inventory.pending.json")
            )
              throw new ClientError("DRIVE_FORBIDDEN");
            return create(parent, name, value);
          },
        );
      if (phase === "claim")
        vi.mocked(f.drive.writeJson).mockRejectedValue(
          new ClientError("DRIVE_CONFLICT"),
        );
      if (phase === "cleanup")
        vi.mocked(f.drive.trash).mockRejectedValue(
          new ClientError("DRIVE_FORBIDDEN"),
        );
      const result = await f.editing.save();
      expect(result?.outcome).toBe("partial");
      expect(result?.folderId).toBeDefined();
      expect(f.editing.getSnapshot().dirty).toBe(true);
      expect(
        (f.documents.get("index-file") as typeof f.index).boxes.length,
      ).toBe(phase === "cleanup" ? 3 : 2);
      const report = await f.library.recover();
      expect(report.complete).toBe(false);
      expect(
        report.issues.some((issue) => issue.code === "PENDING_CREATION"),
      ).toBe(true);
      await expect(f.editing.save()).rejects.toThrow("EDIT_LOCKED");
    },
  );
  it("preserves both committed inventories when separate boxes race the root index, then reconciles the loser", async () => {
    const f = await open();
    const second = f.makeEditor().editing;
    await second.open(SECOND);
    f.editing.box({ name: "First committed box" });
    second.box({ name: "Second committed box" });
    const atomic = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    let arrived = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.drive.writeJson).mockImplementation(
      async (source, document) => {
        if (source.file.id === "index-file") {
          arrived++;
          if (arrived === 2) release();
          await barrier;
        }
        return atomic(source, document);
      },
    );
    const results = await Promise.all([f.editing.save(), second.save()]);
    expect(results.map((r) => r?.outcome).sort()).toEqual([
      "complete",
      "partial",
    ]);
    expect(
      (f.documents.get("inventory-file") as typeof f.inventory).box.name,
    ).toBe("First committed box");
    expect(
      (f.documents.get("empty-inventory") as typeof f.inventory).box.name,
    ).toBe("Second committed box");
    vi.mocked(f.drive.writeJson).mockImplementation(atomic);
    const loser = results[0]!.outcome === "partial" ? f.editing : second;
    await loser.reviewOperation();
    expect((await loser.reconcile(true))?.outcome).toBe("complete");
    expect(
      (f.documents.get("index-file") as typeof f.index).boxes
        .map((e) => e.name)
        .sort(),
    ).toEqual(["First committed box", "Second committed box"]);
  });
  it("creates one UUID box, claims the number before publication and cleans the marker last", async () => {
    const f = editingFixture();
    await f.editing.open();
    f.editing.box({ name: "Cables", location: "Garage" });
    const draft = f.editing.getSnapshot().draft!;
    expect(draft.document.box.number).toBe("BOX-0003");
    const result = await f.editing.save();
    expect(result?.outcome).toBe("complete");
    expect(result?.steps.map((s) => s.phase)).toEqual([
      "pending-folder",
      "pending-marker",
      "draft-inventory",
      "number-claim",
      "publish-inventory",
      "folder",
      "marker-cleanup",
    ]);
    const files = [...f.files.values()].filter((file) =>
      file.parents?.includes(result!.folderId!),
    );
    expect(files.map((file) => file.name)).toEqual(["inventory.json"]);
    const stored = f.documents.get(files[0]!.id) as typeof f.inventory;
    expect(stored.box.id).toBe(draft.document.box.id);
    expect(stored.box.number).toBe("BOX-0003");
    expect(f.files.get(result!.folderId!)!.name).toBe("BOX-0003 Cables");
    expect(
      (f.documents.get("index-file") as typeof f.index).boxes,
    ).toHaveLength(3);
  });
  it("blocks missing, duplicate, inconsistent and pending libraries before creation", async () => {
    for (const scenario of [
      "missing",
      "duplicate",
      "unindexed",
      "pending",
    ] as const) {
      const f = editingFixture();
      if (scenario === "missing") f.files.delete("index-file");
      if (scenario === "duplicate")
        f.files.set("duplicate", { ...f.indexFile, id: "duplicate" });
      if (scenario === "unindexed") f.index.boxes.pop();
      if (scenario === "pending")
        f.files.set("pending", {
          id: "pending",
          name: ".box-storage-pending-test",
          mimeType: f.root.mimeType,
          parents: [f.root.id],
          version: "1",
        });
      await f.editing.open();
      expect(f.editing.getSnapshot().status).toBe("error");
      expect(f.drive.createPendingFolder).not.toHaveBeenCalled();
    }
  });
  it("leaves an incomplete claimed creation discoverable without inventing an empty inventory", async () => {
    const f = editingFixture();
    await f.editing.open();
    f.editing.box({ name: "Pending" });
    vi.mocked(f.drive.renameFile).mockRejectedValue(
      new ClientError("DRIVE_FORBIDDEN"),
    );
    const result = await f.editing.save();
    expect(result?.outcome).toBe("partial");
    expect(result?.phase).toBe("publish-inventory");
    const files = [...f.files.values()].filter((file) =>
      file.parents?.includes(result!.folderId!),
    );
    expect(files.map((file) => file.name).sort()).toEqual([
      "box-storage-pending.json",
      "inventory.pending.json",
    ]);
    const report = await f.library.recover();
    expect(report.issues.some((i) => i.code === "PENDING_CREATION")).toBe(true);
    expect(report.retained).toBe(1);
    await f.editing.reviewOperation();
    expect(f.editing.getSnapshot().reconciliation).toBeUndefined();
  });
  it("treats ambiguous folder creation as uncertain and does not create again", async () => {
    const f = editingFixture();
    await f.editing.open();
    f.editing.box({ name: "Pending" });
    vi.mocked(f.drive.createPendingFolder).mockRejectedValue(
      new ClientError("AMBIGUOUS_WRITE"),
    );
    expect((await f.editing.save())?.outcome).toBe("ambiguous");
    expect(f.drive.createPendingFolder).toHaveBeenCalledTimes(1);
    await expect(f.editing.save()).rejects.toThrow("EDIT_LOCKED");
  });
  it("prevents simultaneous inventory writers from silently overwriting", async () => {
    const f = await open();
    const second = f.makeEditor().editing;
    await second.open(BOX);
    f.editing.item(ITEM, { notes: "Writer A" });
    second.item(ITEM, { notes: "Writer B" });
    const atomic = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    let arrived = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.drive.writeJson).mockImplementation(
      async (source, document) => {
        if (source.file.id === "inventory-file") {
          arrived++;
          if (arrived === 2) release();
          await barrier;
        }
        return atomic(source, document);
      },
    );
    const results = await Promise.all([f.editing.save(), second.save()]);
    expect(results.map((r) => r?.outcome).sort()).toEqual([
      "complete",
      "conflict",
    ]);
    const winner = results[0]!.outcome === "complete" ? "Writer A" : "Writer B";
    expect(
      (f.documents.get("inventory-file") as typeof f.inventory).items[0]!.notes,
    ).toBe(winner);
  });
  it("allows only one simultaneous number claim and retains the loser's pending state", async () => {
    const f = editingFixture();
    const secondContext = f.makeEditor();
    const second = secondContext.editing;
    await f.editing.open();
    await second.open();
    f.editing.box({ name: "A" });
    second.box({ name: "B" });
    const atomic = vi.mocked(f.drive.writeJson).getMockImplementation()!;
    let arrived = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.drive.writeJson).mockImplementation(async (source, value) => {
      arrived++;
      if (arrived === 2) release();
      await barrier;
      return atomic(source, value);
    });
    // Both pass discovery before either side effect begins, then race the atomic claim.
    let scans = 0,
      allowMutation!: () => void;
    const scanBarrier = new Promise<void>((resolve) => {
      allowMutation = resolve;
    });
    for (const library of [f.library, secondContext.library]) {
      const scan = library.recover.bind(library);
      vi.spyOn(library, "recover").mockImplementation(async () => {
        const report = await scan();
        scans++;
        if (scans === 2) allowMutation();
        await scanBarrier;
        return report;
      });
    }
    const results = await Promise.all([f.editing.save(), second.save()]);
    expect(results.map((r) => r?.outcome).sort()).toEqual([
      "complete",
      "partial",
    ]);
    const index = f.documents.get("index-file") as typeof f.index;
    expect(index.boxes.filter((b) => b.boxNumber === "BOX-0003")).toHaveLength(
      1,
    );
    expect(results.find((r) => r?.outcome === "partial")!.code).toBe(
      "DRIVE_CONFLICT",
    );
  });
});
