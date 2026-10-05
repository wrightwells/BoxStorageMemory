import { vi } from "vitest";
import type { ApiClient } from "../src/services/api";
import { FOLDER_TYPE, type DriveFile } from "../src/services/drive";
import { EditingService, type EditingDrive } from "../src/services/editing";
import { ClientError } from "../src/services/errors";
import { LibraryService } from "../src/services/library";
import { fixtureLibrary } from "./library-fixtures";

// Atomic compare-and-swap simulator, never installed in the production session.
export function editingFixture() {
  const fixture = fixtureLibrary();
  let generation = 1;
  const api: Pick<ApiClient, "validate"> = {
    validate: vi.fn(async () => ({ valid: true, errors: [] })),
  };
  const drive: EditingDrive = {
    ...fixture.drive,
    assertWritesAvailable: vi.fn(() => undefined),
    writeJson: vi.fn(async (snapshot, document) => {
      const file = fixture.files.get(snapshot.file.id)!;
      if (file.version !== snapshot.file.version)
        throw new ClientError("DRIVE_CONFLICT");
      fixture.documents.set(file.id, structuredClone(document));
      file.version = String(Number(file.version) + 1);
      return structuredClone(file);
    }),
    createPendingFolder: vi.fn(async (parent, operationId) => {
      const file: DriveFile = {
        id: crypto.randomUUID(),
        name: `.box-storage-pending-${operationId}`,
        mimeType: FOLDER_TYPE,
        parents: [parent],
        version: "1",
      };
      fixture.files.set(file.id, file);
      return structuredClone(file);
    }),
    createJson: vi.fn(async (parent, name, document) => {
      const file: DriveFile = {
        id: crypto.randomUUID(),
        name,
        mimeType: "application/json",
        parents: [parent],
        version: "1",
      };
      fixture.files.set(file.id, file);
      fixture.documents.set(file.id, structuredClone(document));
      return structuredClone(file);
    }),
    renameFile: vi.fn(async (snapshot, name, description) => {
      const file = fixture.files.get(snapshot.id)!;
      if (file.version !== snapshot.version)
        throw new ClientError("DRIVE_CONFLICT");
      file.name = name;
      if (description !== undefined) file.description = description;
      file.version = String(Number(file.version) + 1);
      return structuredClone(file);
    }),
    trash: vi.fn(async (id) => {
      const file = fixture.files.get(id)!;
      fixture.files.delete(id);
      fixture.documents.delete(id);
      return { ...file, trashed: true };
    }),
  };
  const makeEditor = () => {
    const library = new LibraryService(
      {
        ...fixture.drive,
        writeJson: drive.writeJson,
        createJson: drive.createJson,
      },
      () => generation,
    );
    return {
      library,
      editing: new EditingService(drive, library, api, () => generation),
    };
  };
  const { editing, library } = makeEditor();
  return {
    ...fixture,
    drive,
    api,
    editing,
    library,
    makeEditor,
    resetContext: () => {
      generation++;
      editing.reset();
      library.reset();
    },
  };
}
