import { vi } from "vitest";
import inventoryFixture from "../../fixtures/contracts/valid-inventory.json";
import type { BoxIndex, Inventory } from "../../shared/typescript/models";
import {
  FOLDER_TYPE,
  type DriveFile,
  type JsonSnapshot,
} from "../src/services/drive";
import { ClientError } from "../src/services/errors";
import { LibraryService, type LibraryDrive } from "../src/services/library";

export const BOX = inventoryFixture.box.id;
export const ITEM = inventoryFixture.items[0]!.id;
export const PHOTO = inventoryFixture.items[0]!.images[0]!;
export const SECOND = "9a46f128-1b5a-42ad-a240-b9015cff9ca7";
export function fixtureLibrary() {
  const folder = (id: string, name: string, parent?: string): DriveFile => ({
    id,
    name,
    mimeType: FOLDER_TYPE,
    version: "1",
    parents: parent ? [parent] : [],
  });
  const root = folder("library", "My storage");
  const garage = folder("garage", "Garage", root.id);
  const boxFolder = folder("box-folder", "BOX-0001 Electrical Box", garage.id);
  const emptyFolder = folder("empty-folder", "BOX-0002 Spare Box", root.id);
  const file = (
    id: string,
    name: string,
    parent: string,
    mimeType = "application/json",
  ): DriveFile => ({ id, name, parents: [parent], mimeType, version: "1" });
  const indexFile = file("index-file", "box-storage-index.json", root.id);
  const inventoryFile = file("inventory-file", "inventory.json", boxFolder.id);
  const emptyFile = file("empty-inventory", "inventory.json", emptyFolder.id);
  const photoFile = {
    ...file("photo-file", PHOTO, boxFolder.id, "image/jpeg"),
    size: "1024",
  };
  const inventory = structuredClone(inventoryFixture) as Inventory;
  const empty: Inventory = {
    schemaVersion: 1,
    box: {
      ...structuredClone(inventory.box),
      id: SECOND,
      number: "BOX-0002",
      name: "Spare Box",
      nfcIds: [],
    },
    items: [],
  };
  delete empty.box.location;
  const index: BoxIndex = {
    schemaVersion: 1,
    updated: inventory.box.modified,
    boxes: [
      {
        boxId: BOX,
        boxNumber: inventory.box.number,
        name: inventory.box.name,
        location: inventory.box.location,
        driveFolderId: boxFolder.id,
        nfcIds: [...inventory.box.nfcIds],
      },
      {
        boxId: SECOND,
        boxNumber: empty.box.number,
        name: empty.box.name,
        driveFolderId: emptyFolder.id,
        nfcIds: [],
      },
    ],
  };
  const files = new Map(
    [
      root,
      garage,
      boxFolder,
      emptyFolder,
      indexFile,
      inventoryFile,
      emptyFile,
      photoFile,
    ].map((file) => [file.id, file]),
  );
  const documents = new Map<string, unknown>([
    [indexFile.id, index],
    [inventoryFile.id, inventory],
    [emptyFile.id, empty],
  ]);
  const unavailable = new Set<string>();
  const drive: LibraryDrive = {
    root,
    listChildren: vi.fn(async (id) => {
      if (unavailable.has(id) || !files.has(id))
        throw new ClientError("DRIVE_NOT_FOUND");
      return structuredClone(
        [...files.values()].filter((file) => file.parents?.includes(id)),
      );
    }),
    withinRoot: vi.fn(async (id) => {
      const file = files.get(id);
      if (!file || unavailable.has(id))
        throw new ClientError("DRIVE_NOT_FOUND");
      return structuredClone(file);
    }),
    readJson: vi.fn(async (id) => {
      const file = files.get(id);
      if (!file || unavailable.has(id))
        throw new ClientError("DRIVE_NOT_FOUND");
      const document = documents.get(id);
      if (document instanceof Error) throw document;
      return {
        file: structuredClone(file),
        document: structuredClone(document),
        etag: '"observed"',
      } as JsonSnapshot;
    }),
    image: vi.fn(async (id) => ({
      file: structuredClone(files.get(id)!),
      url: `blob:${id}`,
    })),
    releaseImage: vi.fn(),
    writeJson: vi.fn(async () => {
      throw new ClientError("WRITE_GATE_CLOSED");
    }),
    createJson: vi.fn(async () => {
      throw new ClientError("WRITE_GATE_CLOSED");
    }),
  };
  let context = 0;
  const library = new LibraryService(drive, () => context);
  return {
    library,
    drive,
    files,
    documents,
    unavailable,
    inventory,
    empty,
    index,
    root,
    garage,
    boxFolder,
    indexFile,
    inventoryFile,
    changeContext: () => {
      context++;
      library.reset();
    },
  };
}
