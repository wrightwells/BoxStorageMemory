import { describe, it, expect, vi } from "vitest";
import {
  SearchService,
  matchSearch,
  searchRecords,
} from "../src/services/search";
import { ClientError } from "../src/services/errors";
import { fixtureLibrary, BOX, ITEM } from "./library-fixtures";
function fixture() {
  const f = fixtureLibrary();
  const search = new SearchService(f.drive, f.library, () => 1);
  return { ...f, search };
}
describe("search matching", () => {
  it.each([
    "BOX-0001",
    "0001",
    "electrical",
    "GARAGE",
    "extension",
    "10 metre",
    "coiled",
  ])("matches case-insensitive partial %s with box/item context", (query) => {
    const f = fixture();
    const results = matchSearch(searchRecords(f.inventory), query);
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every((r) => r.boxId === BOX && r.boxNumber === "BOX-0001"),
    ).toBe(true);
    if (["extension", "10 metre", "coiled"].includes(query))
      expect(results[0]!.itemId).toBe(ITEM);
  });
  it("matches box and item tags and Unicode normalization, and handles literal punctuation/empty queries", () => {
    const f = fixture();
    f.inventory.box.tags = ["Kitchen"];
    f.inventory.items[0]!.tags = ["Fragile"];
    f.inventory.items[0]!.name = "Ｃａｆｅ [A]";
    const records = searchRecords(f.inventory);
    expect(matchSearch(records, "kitchen").length).toBe(2);
    expect(matchSearch(records, "fragile")[0]!.kind).toBe("item");
    expect(matchSearch(records, "cafe [a]")[0]!.itemId).toBe(ITEM);
    expect(matchSearch(records, "  ")).toEqual([]);
    expect(matchSearch(records, ".*")).toEqual([]);
  });
});
describe("runtime global search", () => {
  it("limits concurrent inventory reads to four workers", async () => {
    const f = fixture();
    for (let i = 3; i <= 8; i++) {
      const id = crypto.randomUUID();
      const folderId = `folder-${i}`;
      const document = structuredClone(f.empty);
      document.box.id = id;
      document.box.number = `BOX-${String(i).padStart(4, "0")}`;
      f.index.boxes.push({
        ...f.index.boxes[1]!,
        boxId: id,
        boxNumber: document.box.number,
        driveFolderId: folderId,
      });
      f.files.set(folderId, { ...f.files.get("empty-folder")!, id: folderId });
      f.files.set(`inventory-${i}`, {
        ...f.files.get("empty-inventory")!,
        id: `inventory-${i}`,
        parents: [folderId],
      });
      f.documents.set(`inventory-${i}`, document);
    }
    let active = 0,
      maximum = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.mocked(f.drive.readJson).getMockImplementation()!;
    vi.mocked(f.drive.readJson).mockImplementation(async (id, ...args) => {
      if (id !== "index-file") {
        maximum = Math.max(maximum, ++active);
        await pending;
        active--;
      }
      return read(id, ...args);
    });
    const loading = f.search.load();
    await vi.waitFor(() => expect(active).toBe(4));
    release();
    await loading;
    expect(maximum).toBe(4);
    expect(f.search.getSnapshot().loaded).toBe(8);
  });
  it("reads all indexed inventories, including empty boxes, without downloading photos or writing", async () => {
    const f = fixture();
    await f.search.load();
    const state = f.search.getSnapshot();
    expect(state.status).toBe("ready");
    expect(state.loaded).toBe(2);
    expect(state.records).toHaveLength(3);
    expect(f.drive.image).not.toHaveBeenCalled();
    expect(f.drive.writeJson).not.toHaveBeenCalled();
    const count = vi.mocked(f.drive.readJson).mock.calls.length;
    await f.search.load();
    expect(f.drive.readJson).toHaveBeenCalledTimes(count);
  });
  it("publishes available results while an inventory is still loading", async () => {
    const f = fixture();
    const read = vi.mocked(f.drive.readJson).getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.drive.readJson).mockImplementation(async (id, ...args) => {
      if (id === "inventory-file") await pending;
      return read(id, ...args);
    });
    const loading = f.search.load();
    await vi.waitFor(() => expect(f.search.getSnapshot().loaded).toBe(1));
    expect(f.search.getSnapshot().status).toBe("loading");
    expect(f.search.getSnapshot().records[0]!.boxNumber).toBe("BOX-0002");
    release();
    await loading;
    expect(f.search.getSnapshot().status).toBe("ready");
  });
  it("reports inaccessible boxes and explicit partial results, then retries on refresh", async () => {
    const f = fixture();
    f.unavailable.add("box-folder");
    await f.search.load();
    expect(f.search.getSnapshot().status).toBe("partial");
    expect(f.search.getSnapshot().issues).toEqual([
      { boxId: BOX, boxNumber: "BOX-0001", code: "DRIVE_NOT_FOUND" },
    ]);
    expect(matchSearch(f.search.getSnapshot().records, "extension")).toEqual(
      [],
    );
    f.unavailable.clear();
    await f.search.load(true);
    expect(f.search.getSnapshot().status).toBe("ready");
    expect(f.search.getSnapshot().issues).toEqual([]);
  });
  it("rejects corrupt/newer inventories and malformed root indexes rather than claiming complete results", async () => {
    const f = fixture();
    f.documents.set("inventory-file", new ClientError("INVALID_JSON"));
    await f.search.load();
    expect(f.search.getSnapshot().issues[0]!.code).toBe("INVALID_JSON");
    f.documents.set("inventory-file", { ...f.inventory, schemaVersion: 2 });
    await f.search.load(true);
    expect(f.search.getSnapshot().issues[0]!.code).toBe("UNSUPPORTED_SCHEMA");
    f.documents.set("index-file", { schemaVersion: 1 });
    await f.search.load(true);
    expect(f.search.getSnapshot().status).toBe("error");
    expect(f.search.getSnapshot().records).toEqual([]);
  });
  it("uses authoritative inventory metadata and reports stale derived index fields", async () => {
    const f = fixture();
    f.inventory.box.name = "Current name";
    await f.search.load();
    expect(
      matchSearch(f.search.getSnapshot().records, "current name"),
    ).toHaveLength(2);
    expect(
      f.search.getSnapshot().warnings.some((w) => w.code === "INDEX_STALE"),
    ).toBe(true);
  });
  it("invalidates results on source refresh and reflects external/item/photo changes on next load", async () => {
    const f = fixture();
    await f.search.load();
    f.inventory.items[0]!.notes = "Updated note";
    f.files.get("inventory-file")!.version = "2";
    f.library.reset();
    expect(f.search.getSnapshot().status).toBe("idle");
    expect(f.search.getSnapshot().records).toEqual([]);
    await f.search.load();
    expect(
      matchSearch(f.search.getSnapshot().records, "Updated note"),
    ).toHaveLength(1);
  });
  it("clears old-root/account results and rejects late responses during context invalidation", async () => {
    const f = fixture();
    const read = vi.mocked(f.drive.readJson).getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.drive.readJson).mockImplementation(async (id, ...args) => {
      if (id === "inventory-file") await pending;
      return read(id, ...args);
    });
    const loading = f.search.load();
    await vi.waitFor(() => expect(f.search.getSnapshot().loaded).toBe(1));
    f.changeContext();
    expect(f.search.getSnapshot().records).toEqual([]);
    release();
    await loading;
    expect(f.search.getSnapshot().status).toBe("idle");
    expect(f.search.getSnapshot().records).toEqual([]);
  });
  it("does not allow superseded refresh completion to replace newer results", async () => {
    const f = fixture();
    const read = vi.mocked(f.drive.readJson).getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    vi.mocked(f.drive.readJson).mockImplementation(async (id, ...args) => {
      if (id === "inventory-file" && first) {
        first = false;
        await pending;
      }
      return read(id, ...args);
    });
    const old = f.search.load();
    await vi.waitFor(() => expect(f.search.getSnapshot().loaded).toBe(1));
    await f.search.load(true);
    release();
    await old;
    expect(f.search.getSnapshot().status).toBe("ready");
    expect(f.search.getSnapshot().records).toHaveLength(3);
  });
  it("reports an empty valid index as a ready empty library", async () => {
    const f = fixture();
    f.index.boxes = [];
    await f.search.load();
    expect(f.search.getSnapshot().status).toBe("ready");
    expect(f.search.getSnapshot().total).toBe(0);
  });
});

it("reuses current view data, refreshes explicitly and clears copied data on context change", async () => {
  const f = fixtureLibrary();
  const search = new SearchService(f.drive, f.library, () => 0);
  await f.library.box(BOX);
  vi.mocked(f.drive.readJson).mockClear();
  await search.load();
  expect(f.drive.readJson).toHaveBeenCalledTimes(1); // only unopened second box
  expect(search.getSnapshot().records).toHaveLength(3);
  await search.load(true);
  expect(f.drive.readJson).toHaveBeenCalledTimes(4); // fresh index and both inventories
  f.changeContext();
  expect(search.getSnapshot().records).toHaveLength(0);
  search.dispose();
});

it("does not seed a newly opened search with view data older than one minute", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const f = fixtureLibrary();
  await f.library.box(BOX);
  clock.mockReturnValue(60_001);
  vi.mocked(f.drive.readJson).mockClear();
  const search = new SearchService(f.drive, f.library, () => 0);
  await search.load();
  expect(f.drive.readJson).toHaveBeenCalledTimes(3); // fresh index and both inventories
  search.dispose();
  clock.mockRestore();
});
