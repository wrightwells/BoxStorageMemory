import { validator } from "./validation";
import {
  normalizeBoxNumber,
  schemaMode,
} from "../../../shared/typescript/contracts";
import type {
  BoxIndex,
  BoxIndexEntry,
  Inventory,
} from "../../../shared/typescript/models";
import {
  FOLDER_TYPE,
  type DriveFile,
  type DriveStorageService,
  type JsonSnapshot,
} from "./drive";
import { ClientError } from "./errors";

export type LibraryDrive = Pick<
  DriveStorageService,
  | "root"
  | "listChildren"
  | "withinRoot"
  | "readJson"
  | "image"
  | "releaseImage"
  | "writeJson"
  | "createJson"
>;
export interface BoxView {
  inventory: Inventory;
  snapshot: JsonSnapshot;
  folder: DriveFile;
  files: DriveFile[];
  warnings: string[];
}
export interface RecoveryIssue {
  code: string;
  folderId?: string;
  boxNumber?: string;
  path?: string;
}
interface FolderScan {
  folder: DriveFile;
  files: DriveFile[];
}
export interface RecoveryReport {
  candidate: BoxIndex;
  issues: RecoveryIssue[];
  discovered: number;
  retained: number;
  complete: boolean;
  baselineFiles: DriveFile[];
  scans: FolderScan[];
  inventories: JsonSnapshot[];
  source?: JsonSnapshot;
  epoch: number;
}
export interface LibraryState {
  status: "idle" | "loading" | "ready" | "error";
  index?: BoxIndex;
  error?: string;
  revision: number;
  recovery?: RecoveryReport;
  recovering: boolean;
  emptyLibrary?: boolean;
}

const codeOf = (error: unknown) =>
  error instanceof ClientError ? error.code : "UNAVAILABLE";
const fingerprint = (files: DriveFile[]) =>
  JSON.stringify(
    files
      .map((f) => [f.id, f.name, f.mimeType, f.version ?? ""])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
export const validUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    id,
  );

export class LibraryService {
  #state: LibraryState = { status: "idle", revision: 0, recovering: false };
  #listeners = new Set<() => void>();
  #epoch = 0;
  #controllers = new Set<AbortController>();
  #boxes = new Map<string, BoxView>();
  #versions = new Map<string, string>();
  #photos = new Set<string>();
  #loading?: Promise<void>;
  constructor(
    private readonly drive: LibraryDrive,
    private readonly context: () => number,
  ) {}
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  private update(patch: Partial<LibraryState>) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
  reset() {
    this.#epoch++;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    for (const url of this.#photos) this.drive.releaseImage(url);
    this.#photos.clear();
    this.#boxes.clear();
    this.#versions.clear();
    this.#loading = undefined;
    this.#state = {
      status: "idle",
      revision: this.#state.revision + 1,
      recovering: false,
    };
    for (const listener of this.#listeners) listener();
  }
  private task() {
    const epoch = this.#epoch;
    const generation = this.context();
    const controller = new AbortController();
    this.#controllers.add(controller);
    return {
      epoch,
      signal: controller.signal,
      check: () => {
        if (
          epoch !== this.#epoch ||
          generation !== this.context() ||
          controller.signal.aborted
        )
          throw new ClientError("CONTEXT_CHANGED");
      },
      finish: () => this.#controllers.delete(controller),
    };
  }
  async load(refresh = false): Promise<void> {
    if (refresh) {
      const previous = new Map(this.#versions);
      this.reset();
      this.#versions = previous;
    }
    if (this.#loading) return this.#loading;
    if (this.#state.status === "ready") return;
    const task = this.task();
    this.update({
      status: "loading",
      error: undefined,
      emptyLibrary: undefined,
    });
    const loading = (async () => {
      try {
        const root = this.drive.root;
        if (!root) throw new ClientError("ROOT_REQUIRED");
        const children = await this.drive.listChildren(root.id, task.signal);
        task.check();
        const files = children.filter(
          (f) => f.name === "box-storage-index.json",
        );
        this.update({ emptyLibrary: children.length === 0 });
        if (!files.length) throw new ClientError("INDEX_MISSING");
        if (files.length !== 1) throw new ClientError("DUPLICATE_FILE");
        const snapshot = await this.drive.readJson(files[0]!.id, task.signal);
        task.check();
        if (schemaMode(snapshot.document) === "read-only")
          throw new ClientError("UNSUPPORTED_SCHEMA");
        if (!validator.validate("index", snapshot.document).valid)
          throw new ClientError("INVALID_INDEX");
        this.update({ status: "ready", index: snapshot.document as BoxIndex });
      } catch (error) {
        if (task.epoch === this.#epoch)
          this.update({
            status: "error",
            error: codeOf(error),
            index: undefined,
          });
      } finally {
        task.finish();
        if (task.epoch === this.#epoch) this.#loading = undefined;
      }
    })();
    this.#loading = this.#state.status === "loading" ? loading : undefined;
    return loading;
  }
  lookup(number: string): BoxIndexEntry | undefined {
    let canonical: string;
    try {
      canonical = normalizeBoxNumber(number);
    } catch {
      throw new ClientError("INVALID_BOX_NUMBER");
    }
    return this.#state.index?.boxes.find((box) => box.boxNumber === canonical);
  }
  async box(boxId: string, refresh = false): Promise<BoxView> {
    if (!validUuid(boxId)) throw new ClientError("INVALID_BOX_ID");
    const loading = this.load(refresh);
    const epoch = this.#epoch;
    await loading;
    if (epoch !== this.#epoch) throw new ClientError("CONTEXT_CHANGED");
    if (!this.#state.index)
      throw new ClientError(this.#state.error ?? "INVALID_INDEX");
    const entry = this.#state.index.boxes.find((box) => box.boxId === boxId);
    if (!entry) throw new ClientError("BOX_NOT_FOUND");
    if (!refresh && this.#boxes.has(boxId)) return this.#boxes.get(boxId)!;
    if (refresh) this.#boxes.delete(boxId);
    const task = this.task();
    try {
      const folder = await this.drive.withinRoot(
        entry.driveFolderId,
        task.signal,
      );
      const files = await this.drive.listChildren(folder.id, task.signal);
      const inventories = files.filter((f) => f.name === "inventory.json");
      if (!inventories.length) throw new ClientError("INVENTORY_MISSING");
      if (inventories.length !== 1) throw new ClientError("DUPLICATE_FILE");
      const snapshot = await this.drive.readJson(
        inventories[0]!.id,
        task.signal,
      );
      task.check();
      if (schemaMode(snapshot.document) === "read-only")
        throw new ClientError("UNSUPPORTED_SCHEMA");
      if (!validator.validate("inventory", snapshot.document).valid)
        throw new ClientError("INVALID_INVENTORY");
      const inventory = snapshot.document as Inventory;
      if (
        inventory.box.id !== entry.boxId ||
        inventory.box.number !== entry.boxNumber
      )
        throw new ClientError("IDENTITY_MISMATCH");
      const warnings: string[] = [];
      const previousVersion = this.#versions.get(snapshot.file.id);
      if (previousVersion && previousVersion !== snapshot.file.version)
        warnings.push("INVENTORY_CHANGED");
      if (snapshot.file.version)
        this.#versions.set(snapshot.file.id, snapshot.file.version);
      if (
        entry.name !== inventory.box.name ||
        (entry.location ?? "") !== (inventory.box.location ?? "") ||
        JSON.stringify([...entry.nfcIds].sort()) !==
          JSON.stringify([...inventory.box.nfcIds].sort())
      )
        warnings.push("INDEX_STALE");
      const view = { inventory, snapshot, folder, files, warnings };
      this.#boxes.set(boxId, view);
      return view;
    } finally {
      task.finish();
    }
  }
  async photo(
    boxId: string,
    itemId: string,
    filename: string,
  ): Promise<string> {
    const epoch = this.#epoch;
    const view = await this.box(boxId);
    if (epoch !== this.#epoch) throw new ClientError("CONTEXT_CHANGED");
    const item = view.inventory.items.find((item) => item.id === itemId);
    if (!item?.images?.includes(filename))
      throw new ClientError("IMAGE_NOT_FOUND");
    const task = this.task();
    try {
      // Re-list rather than trusting stale photo references or duplicate Drive filenames.
      const files = await this.drive.listChildren(view.folder.id, task.signal);
      const matches = files.filter((file) => file.name === filename);
      if (!matches.length) throw new ClientError("IMAGE_NOT_FOUND");
      if (matches.length !== 1) throw new ClientError("DUPLICATE_FILE");
      const photo = await this.drive.image(matches[0]!.id, task.signal);
      try {
        task.check();
      } catch (error) {
        this.drive.releaseImage(photo.url);
        throw error;
      }
      this.#photos.add(photo.url);
      return photo.url;
    } finally {
      task.finish();
    }
  }
  releasePhoto(url: string) {
    this.#photos.delete(url);
    this.drive.releaseImage(url);
  }
  async folders(id: string): Promise<DriveFile[]> {
    const task = this.task();
    try {
      const files = await this.drive.listChildren(id, task.signal);
      task.check();
      return files.filter((f) => f.mimeType === FOLDER_TYPE);
    } finally {
      task.finish();
    }
  }
  async recover(): Promise<RecoveryReport> {
    const task = this.task();
    const root = this.drive.root;
    if (!root) {
      task.finish();
      throw new ClientError("ROOT_REQUIRED");
    }
    this.update({ recovering: true, recovery: undefined });
    try {
      const issues: RecoveryIssue[] = [];
      const scans: FolderScan[] = [];
      const inventories: JsonSnapshot[] = [];
      const entries: BoxIndexEntry[] = [];
      let baselineFiles: DriveFile[] = [];
      let source: JsonSnapshot | undefined;
      let original: BoxIndex | undefined;
      const pending = [root];
      const visited = new Set<string>();
      while (pending.length) {
        task.check();
        if (visited.size >= 2000) {
          issues.push({ code: "SCAN_LIMIT" });
          break;
        }
        const folder = pending.shift()!;
        if (visited.has(folder.id)) continue;
        visited.add(folder.id);
        let files: DriveFile[];
        try {
          files = await this.drive.listChildren(folder.id, task.signal);
          task.check();
        } catch (error) {
          task.check();
          issues.push({ code: codeOf(error), folderId: folder.id });
          continue;
        }
        scans.push({ folder, files });
        if (
          folder.name.startsWith(".box-storage-pending-") ||
          files.some(
            (f) =>
              f.name === "box-storage-pending.json" ||
              f.name === "box-storage-edit-pending.json" ||
              f.name === "inventory.pending.json",
          )
        )
          issues.push({ code: "PENDING_CREATION", folderId: folder.id });
        if (folder.id === root.id) {
          baselineFiles = files.filter(
            (f) => f.name === "box-storage-index.json",
          );
          if (baselineFiles.length > 1)
            issues.push({ code: "DUPLICATE_INDEX", folderId: folder.id });
          if (baselineFiles.length === 1) {
            try {
              source = await this.drive.readJson(
                baselineFiles[0]!.id,
                task.signal,
              );
              task.check();
              if (schemaMode(source.document) === "read-only")
                issues.push({
                  code: "UNSUPPORTED_SCHEMA",
                  folderId: folder.id,
                });
              else if (validator.validate("index", source.document).valid)
                original = source.document as BoxIndex;
              else issues.push({ code: "INVALID_INDEX", folderId: folder.id });
            } catch (error) {
              task.check();
              issues.push({ code: codeOf(error), folderId: folder.id });
            }
          }
        }
        pending.push(...files.filter((f) => f.mimeType === FOLDER_TYPE));
        const found = files.filter((f) => f.name === "inventory.json");
        if (found.length > 1) {
          issues.push({ code: "DUPLICATE_INVENTORY", folderId: folder.id });
          continue;
        }
        if (!found.length) continue;
        try {
          const snapshot = await this.drive.readJson(found[0]!.id, task.signal);
          task.check();
          if (schemaMode(snapshot.document) === "read-only") {
            issues.push({ code: "UNSUPPORTED_SCHEMA", folderId: folder.id });
            continue;
          }
          const validation = validator.validate("inventory", snapshot.document);
          if (!validation.valid) {
            issues.push({ code: "INVALID_INVENTORY", folderId: folder.id });
            continue;
          }
          const { box } = snapshot.document as Inventory;
          inventories.push(snapshot);
          entries.push({
            boxId: box.id,
            boxNumber: box.number,
            name: box.name,
            driveFolderId: folder.id,
            ...(box.location === undefined ? {} : { location: box.location }),
            nfcIds: [...box.nfcIds],
          });
        } catch (error) {
          task.check();
          issues.push({ code: codeOf(error), folderId: folder.id });
        }
      }
      let retained = 0;
      for (const old of original?.boxes ?? []) {
        if (!entries.some((entry) => entry.boxId === old.boxId)) {
          entries.push(structuredClone(old));
          retained++;
          issues.push({
            code: "UNAVAILABLE_RECORD_RETAINED",
            folderId: old.driveFolderId,
            boxNumber: old.boxNumber,
          });
        }
      }
      // Preserve index extension fields while refreshing only known derived metadata.
      const boxes = entries.map((entry) => {
        const old = original?.boxes.find((box) => box.boxId === entry.boxId);
        const merged = {
          ...structuredClone(old ?? {}),
          ...entry,
        } as BoxIndexEntry;
        if (entry.location === undefined) delete merged.location;
        return merged;
      });
      const candidate = {
        ...structuredClone(original ?? {}),
        schemaVersion: 1,
        updated: new Date().toISOString(),
        boxes,
      } as BoxIndex;
      for (const error of validator.validate("index", candidate).errors)
        issues.push({ code: error.code, path: error.path });
      task.check();
      const report: RecoveryReport = {
        candidate,
        issues,
        discovered: inventories.length,
        retained,
        complete: issues.length === 0,
        baselineFiles,
        scans,
        inventories,
        source,
        epoch: task.epoch,
      };
      this.update({ recovery: report });
      return report;
    } finally {
      task.finish();
      if (task.epoch === this.#epoch) this.update({ recovering: false });
    }
  }
  async installRecovery(
    report: RecoveryReport,
    confirmed: boolean,
  ): Promise<void> {
    if (!confirmed) throw new ClientError("CONFIRMATION_REQUIRED");
    if (report !== this.#state.recovery || report.epoch !== this.#epoch)
      throw new ClientError("CONTEXT_CHANGED");
    if (
      !report.complete ||
      !validator.validate("index", report.candidate).valid
    )
      throw new ClientError("RECOVERY_INCOMPLETE");
    const task = this.task();
    try {
      for (const scan of report.scans) {
        const current = await this.drive.listChildren(
          scan.folder.id,
          task.signal,
        );
        task.check();
        if (fingerprint(current) !== fingerprint(scan.files))
          throw new ClientError("READ_CONFLICT");
      }
      for (const snapshot of report.inventories) {
        const current = await this.drive.withinRoot(
          snapshot.file.id,
          task.signal,
        );
        if (current.version !== snapshot.file.version)
          throw new ClientError("READ_CONFLICT");
      }
      task.check();
      const root = this.drive.root!;
      const indexes = (
        await this.drive.listChildren(root.id, task.signal)
      ).filter((f) => f.name === "box-storage-index.json");
      if (fingerprint(indexes) !== fingerprint(report.baselineFiles))
        throw new ClientError("READ_CONFLICT");
      task.check();
      // These calls always fail closed until the existing atomic-write/bootstrap gate is verified.
      if (report.source)
        await this.drive.writeJson(report.source, report.candidate);
      else
        await this.drive.createJson(
          root.id,
          "box-storage-index.json",
          report.candidate,
        );
    } finally {
      task.finish();
    }
  }
}
