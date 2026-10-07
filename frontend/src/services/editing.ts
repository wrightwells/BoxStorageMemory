import { validator } from "./validation";
import { boxDescription } from "./discoverability";
import {
  normalizeNfc,
  schemaMode,
} from "../../../shared/typescript/contract-core";
import type {
  BoxIndex,
  Inventory,
  InventoryItem,
} from "../../../shared/typescript/models";
import type { ApiClient } from "./api";
import type { DriveFile, DriveStorageService, JsonSnapshot } from "./drive";
import { ClientError } from "./errors";
import type { LibraryService } from "./library";

export type EditingDrive = Pick<
  DriveStorageService,
  | "root"
  | "withinRoot"
  | "listChildren"
  | "readJson"
  | "assertWritesAvailable"
  | "writeJson"
  | "createJson"
  | "createPendingFolder"
  | "renameFile"
  | "trash"
> &
  Partial<
    Pick<
      DriveStorageService,
      | "assertCreationAvailable"
      | "createBox"
      | "assertEditingAvailable"
      | "editBox"
    >
  >;
export interface Draft {
  kind: "edit" | "create";
  document: Inventory;
  original: Inventory;
  index: JsonSnapshot;
  inventory?: JsonSnapshot;
  folder?: DriveFile;
  rootId: string;
  readOnly: boolean;
  operationId: string;
}
export interface EditIssue {
  path: string;
  code: string;
}
export interface OperationStep {
  phase: string;
  status: "confirmed" | "uncertain";
  fileId?: string;
}
export interface OperationResult {
  outcome: "complete" | "blocked" | "conflict" | "partial" | "ambiguous";
  code?: string;
  phase: string;
  steps: OperationStep[];
  folderId?: string;
  boxId: string;
  boxNumber: string;
}
export interface EditingState {
  revision: number;
  status: "idle" | "loading" | "ready" | "error";
  draft?: Draft;
  dirty: boolean;
  busy: boolean;
  locked: boolean;
  issues: EditIssue[];
  error?: string;
  result?: OperationResult;
  reconciliation?: Draft;
  inspection?: { files: DriveFile[]; index: unknown; inventory?: unknown };
}

const codeOf = (error: unknown) =>
  error instanceof ClientError ? error.code : "UNAVAILABLE";
const identical = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((k) => Object.hasOwn(y, k) && identical(x[k], y[k]))
  );
};
const folderName = (inventory: Inventory) =>
  `${inventory.box.number} ${inventory.box.name}`
    .split("")
    .map((character) =>
      character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127 ||
      character === "/" ||
      character === "\\"
        ? " "
        : character,
    )
    .join("")
    .slice(0, 200);
const fields = new Set(["name", "description", "location", "tags"]);
const itemFields = new Set([
  "name",
  "description",
  "quantity",
  "tags",
  "notes",
]);

// Production Drive methods remain fail-closed. Tests supply an independent atomic
// simulator; no configuration flag or runtime caller can unlock the Drive adapter.
export class EditingService {
  #state: EditingState = {
    revision: 0,
    status: "idle",
    dirty: false,
    busy: false,
    locked: false,
    issues: [],
  };
  #listeners = new Set<() => void>();
  #epoch = 0;
  #controllers = new Set<AbortController>();
  constructor(
    private readonly drive: EditingDrive,
    private readonly library: LibraryService,
    private readonly api: Pick<ApiClient, "validate">,
    private readonly context: () => number,
  ) {}
  get writesAvailable() {
    try {
      this.drive.assertWritesAvailable();
      return true;
    } catch {
      return false;
    }
  }
  get editingAvailable() {
    try {
      if (this.drive.assertEditingAvailable)
        this.drive.assertEditingAvailable();
      else this.drive.assertWritesAvailable();
      return true;
    } catch {
      return false;
    }
  }
  get creationAvailable() {
    try {
      if (this.drive.assertCreationAvailable)
        this.drive.assertCreationAvailable();
      else this.drive.assertWritesAvailable();
      return true;
    } catch {
      return false;
    }
  }
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  private update(patch: Partial<EditingState>) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
  reset() {
    this.#epoch++;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    this.#state = {
      revision: this.#state.revision + 1,
      status: "idle",
      dirty: false,
      busy: false,
      locked: false,
      issues: [],
    };
    for (const listener of this.#listeners) listener();
  }
  private task() {
    const epoch = this.#epoch,
      generation = this.context();
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
  private async readIndex(signal: AbortSignal): Promise<JsonSnapshot> {
    const root = this.drive.root;
    if (!root) throw new ClientError("ROOT_REQUIRED");
    const files = (await this.drive.listChildren(root.id, signal)).filter(
      (f) => f.name === "box-storage-index.json",
    );
    if (!files.length) throw new ClientError("INDEX_MISSING");
    if (files.length !== 1) throw new ClientError("DUPLICATE_INDEX");
    const source = await this.drive.readJson(files[0]!.id, signal);
    if (schemaMode(source.document) === "read-only")
      throw new ClientError("UNSUPPORTED_SCHEMA");
    if (!validator.validate("index", source.document).valid)
      throw new ClientError("INVALID_INDEX");
    return source;
  }
  async open(boxId?: string, reload = false): Promise<void> {
    const current = this.#state.draft;
    if (
      !reload &&
      current &&
      (boxId
        ? current.kind === "edit" && current.document.box.id === boxId
        : current.kind === "create")
    )
      return;
    if (this.#state.busy) throw new ClientError("EDIT_BUSY");
    this.reset();
    const task = this.task();
    this.update({ status: "loading" });
    try {
      let document: Inventory,
        inventory: JsonSnapshot | undefined,
        folder: DriveFile | undefined,
        creationIndex: JsonSnapshot | undefined;
      if (boxId) {
        const view = await this.library.box(boxId, true);
        task.check();
        document = structuredClone(view.inventory);
        inventory = view.snapshot;
        folder = view.folder;
      } else {
        const report = await this.library.recover();
        task.check();
        if (!report.complete)
          throw new ClientError(
            report.issues.some((i) => i.code === "PENDING_CREATION")
              ? "PENDING_CREATION"
              : "RECOVERY_INCOMPLETE",
          );
        if (!report.source) throw new ClientError("INDEX_MISSING");
        creationIndex = report.source;
        const source = report.source.document as BoxIndex;
        if (
          source.boxes.length !== report.candidate.boxes.length ||
          source.boxes.some(
            (e) => !report.candidate.boxes.some((c) => identical(c, e)),
          )
        )
          throw new ClientError("INDEX_STALE");
        const maximum = Math.max(
          0,
          ...source.boxes.map((box) => Number(box.boxNumber.slice(4))),
        );
        if (maximum >= 999999999) throw new ClientError("NUMBER_EXHAUSTED");
        const timestamp = new Date().toISOString();
        document = {
          schemaVersion: 1,
          box: {
            id: crypto.randomUUID(),
            number: `BOX-${String(maximum + 1).padStart(4, "0")}`,
            name: "",
            created: timestamp,
            modified: timestamp,
            nfcIds: [],
          },
          items: [],
        };
      }
      const index = await this.readIndex(task.signal);
      task.check();
      if (
        creationIndex &&
        (index.file.id !== creationIndex.file.id ||
          index.file.version !== creationIndex.file.version)
      )
        throw new ClientError("DRIVE_CONFLICT");
      if (boxId) {
        const entry = (index.document as BoxIndex).boxes.find(
          (e) => e.boxId === boxId,
        );
        if (
          !entry ||
          entry.driveFolderId !== folder!.id ||
          entry.boxNumber !== document.box.number
        )
          throw new ClientError("IDENTITY_MISMATCH");
      }
      const root = this.drive.root!;
      const readOnly =
        index.file.capabilities?.canEdit === false ||
        (boxId
          ? inventory!.file.capabilities?.canEdit === false ||
            folder!.capabilities?.canEdit === false
          : root.capabilities?.canAddChildren === false);
      this.update({
        status: "ready",
        draft: {
          kind: boxId ? "edit" : "create",
          document,
          original: structuredClone(document),
          index,
          inventory,
          folder,
          rootId: root.id,
          readOnly,
          operationId: crypto.randomUUID(),
        },
      });
    } catch (error) {
      if (task.epoch === this.#epoch)
        this.update({ status: "error", error: codeOf(error) });
    } finally {
      task.finish();
    }
  }
  private editable(): Draft {
    const draft = this.#state.draft;
    if (!draft) throw new ClientError("ROOT_REQUIRED");
    if (draft.readOnly) throw new ClientError("DRIVE_FORBIDDEN");
    if (this.#state.busy || this.#state.locked)
      throw new ClientError("EDIT_LOCKED");
    return draft;
  }
  private replace(document: Inventory) {
    const draft = this.editable();
    this.update({
      draft: { ...draft, document },
      dirty: !identical(document, draft.original),
      issues: [],
      error: undefined,
      result: undefined,
    });
  }
  box(changes: Record<string, unknown>) {
    if (!Object.keys(changes).every((k) => fields.has(k)))
      throw new ClientError("IMMUTABLE_IDENTITY");
    const document = structuredClone(this.editable().document);
    Object.assign(document.box, structuredClone(changes));
    this.replace(document);
  }
  // Dedicated tag workflow; ordinary box edits still reject identity/tag fields.
  nfcIds(values: string[]) {
    const draft = this.editable();
    if (draft.kind !== "edit") throw new ClientError("IMMUTABLE_IDENTITY");
    let ids: string[];
    try {
      ids = values.map(normalizeNfc);
    } catch {
      throw new ClientError("INVALID_NFC_ID");
    }
    if (new Set(ids).size !== ids.length)
      throw new ClientError("DUPLICATE_NFC_ID");
    const index = draft.index.document as BoxIndex;
    if (
      index.boxes.some(
        (entry) =>
          entry.boxId !== draft.document.box.id &&
          entry.nfcIds.some((id) => ids.includes(id)),
      )
    )
      throw new ClientError("DUPLICATE_NFC_ID");
    const document = structuredClone(draft.document);
    document.box.nfcIds = ids;
    this.replace(document);
  }
  item(id: string, changes: Record<string, unknown>) {
    if (!Object.keys(changes).every((k) => itemFields.has(k)))
      throw new ClientError("IMMUTABLE_IDENTITY");
    const document = structuredClone(this.editable().document);
    const item = document.items.find((i) => i.id === id);
    if (!item) throw new ClientError("ITEM_NOT_FOUND");
    Object.assign(item, structuredClone(changes));
    this.replace(document);
  }
  addItem() {
    const document = structuredClone(this.editable().document);
    const item: InventoryItem = {
      id: crypto.randomUUID(),
      name: "",
      quantity: 1,
    };
    document.items.push(item);
    this.replace(document);
    return item.id;
  }
  removeItem(id: string, confirmed: boolean) {
    if (!confirmed) throw new ClientError("DELETE_CONFIRMATION_REQUIRED");
    const document = structuredClone(this.editable().document);
    if (!document.items.some((i) => i.id === id))
      throw new ClientError("ITEM_NOT_FOUND");
    document.items = document.items.filter((i) => i.id !== id);
    // Stage 7 deliberately retains ordinary photo files. No blind cleanup or
    // deletion of shared/unrelated files; Stage 8 owns explicit photo cleanup.
    this.replace(document);
  }
  private indexFor(
    draft: Draft,
    inventory: Inventory,
    folderId: string,
  ): BoxIndex {
    const index = structuredClone(draft.index.document) as BoxIndex;
    const old = index.boxes.find((e) => e.boxId === inventory.box.id);
    const entry = {
      ...old,
      boxId: inventory.box.id,
      boxNumber: inventory.box.number,
      name: inventory.box.name,
      driveFolderId: folderId,
      nfcIds: [...inventory.box.nfcIds],
    };
    if (inventory.box.location !== undefined)
      Object.assign(entry, { location: inventory.box.location });
    else delete (entry as Record<string, unknown>).location;
    index.boxes = [
      ...index.boxes.filter((e) => e.boxId !== inventory.box.id),
      entry,
    ];
    index.updated = new Date().toISOString();
    return index;
  }
  async validate(): Promise<boolean> {
    const draft = this.editable();
    const document = structuredClone(draft.document);
    const task = this.task();
    this.update({ busy: true, issues: [], error: undefined });
    try {
      if (
        document.box.id !== draft.original.box.id ||
        document.box.number !== draft.original.box.number ||
        document.box.created !== draft.original.box.created
      )
        throw new ClientError("IMMUTABLE_IDENTITY");
      const local = validator.validate("inventory", document);
      if (!local.valid) {
        this.update({ issues: local.errors });
        return false;
      }
      const index = this.indexFor(
        draft,
        document,
        draft.folder?.id ?? "pending-folder",
      );
      const indexCheck = validator.validate("index", index);
      if (!indexCheck.valid) {
        this.update({ issues: indexCheck.errors });
        return false;
      }
      // Stateless API validation receives JSON but no Google token/headers.
      for (const [kind, value] of [
        ["inventory", document],
        ["index", index],
      ] as const) {
        const remote = await this.api.validate(kind, value, task.signal);
        task.check();
        if (
          !remote ||
          typeof remote.valid !== "boolean" ||
          !Array.isArray(remote.errors)
        )
          throw new ClientError("API_INCOMPATIBLE");
        if (!remote.valid) {
          this.update({ issues: remote.errors });
          return false;
        }
      }
      return true;
    } catch (error) {
      if (task.epoch === this.#epoch) this.update({ error: codeOf(error) });
      return false;
    } finally {
      task.finish();
      if (task.epoch === this.#epoch) this.update({ busy: false });
    }
  }
  async save(): Promise<OperationResult | undefined> {
    const initial = this.editable();
    if (!(await this.validate())) return;
    const draft = this.editable();
    if (draft !== initial) throw new ClientError("CONTEXT_CHANGED");
    if (draft.kind === "edit" && !this.#state.dirty) return;
    return this.commit(draft);
  }
  private async currentSnapshot(
    source: JsonSnapshot,
    signal: AbortSignal,
  ): Promise<JsonSnapshot> {
    const current = await this.drive.readJson(source.file.id, signal);
    if (
      !current.file.version ||
      current.file.version !== source.file.version ||
      !identical(current.document, source.document)
    )
      throw new ClientError("DRIVE_CONFLICT");
    return current;
  }
  async reviewOperation(): Promise<void> {
    const draft = this.#state.draft;
    if (!draft || this.#state.busy) throw new ClientError("EDIT_BUSY");
    const task = this.task();
    this.update({
      busy: true,
      error: undefined,
      reconciliation: undefined,
      inspection: undefined,
    });
    try {
      const folderId = this.#state.result?.folderId ?? draft.folder?.id;
      if (!folderId) throw new ClientError("AMBIGUOUS_WRITE");
      const folder = await this.drive.withinRoot(folderId, task.signal);
      const files = await this.drive.listChildren(folderId, task.signal);
      const index = await this.readIndex(task.signal);
      task.check();
      this.update({ inspection: { files, index: index.document } });
      const found = files.filter((f) => f.name === "inventory.json");
      if (found.length !== 1)
        throw new ClientError(
          found.length ? "DUPLICATE_INVENTORY" : "INVENTORY_MISSING",
        );
      const inventory = await this.drive.readJson(found[0]!.id, task.signal);
      task.check();
      if (schemaMode(inventory.document) === "read-only")
        throw new ClientError("UNSUPPORTED_SCHEMA");
      if (!validator.validate("inventory", inventory.document).valid)
        throw new ClientError("INVALID_INVENTORY");
      const document = inventory.document as Inventory;
      const entry = (index.document as BoxIndex).boxes.find(
        (e) => e.boxId === draft.document.box.id,
      );
      if (
        document.box.id !== draft.document.box.id ||
        document.box.number !== draft.document.box.number ||
        !entry ||
        entry.boxNumber !== document.box.number ||
        entry.driveFolderId !== folderId
      )
        throw new ClientError("IDENTITY_MISMATCH");
      // Pending publication is never auto-completed by metadata reconciliation.
      if (
        files.some(
          (f) =>
            f.name === "box-storage-pending.json" ||
            f.name === "inventory.pending.json",
        ) ||
        folder.name.startsWith(".box-storage-pending-")
      )
        throw new ClientError("PENDING_CREATION");
      this.update({
        inspection: { files, index: index.document, inventory: document },
        reconciliation: {
          ...draft,
          kind: "edit",
          document: structuredClone(document),
          original: structuredClone(document),
          folder,
          inventory,
          index,
          readOnly:
            inventory.file.capabilities?.canEdit === false ||
            index.file.capabilities?.canEdit === false ||
            folder.capabilities?.canEdit === false,
        },
      });
    } catch (error) {
      if (task.epoch === this.#epoch) this.update({ error: codeOf(error) });
    } finally {
      task.finish();
      if (task.epoch === this.#epoch) this.update({ busy: false });
    }
  }
  async reconcile(confirmed: boolean): Promise<OperationResult | undefined> {
    if (!confirmed) throw new ClientError("CONFIRMATION_REQUIRED");
    const draft = this.#state.reconciliation;
    if (!draft || this.#state.busy) throw new ClientError("EDIT_LOCKED");
    if (draft.readOnly) throw new ClientError("DRIVE_FORBIDDEN");
    const task = this.task();
    this.update({ busy: true, error: undefined });
    try {
      const index = this.indexFor(draft, draft.document, draft.folder!.id);
      if (!validator.validate("index", index).valid)
        throw new ClientError("INVALID_INDEX");
      const result = await this.api.validate("index", index, task.signal);
      task.check();
      if (!result?.valid || !Array.isArray(result.errors))
        throw new ClientError("INVALID_INDEX");
    } catch (error) {
      if (task.epoch === this.#epoch) this.update({ error: codeOf(error) });
      return;
    } finally {
      task.finish();
      if (task.epoch === this.#epoch) this.update({ busy: false });
    }
    if (draft !== this.#state.reconciliation)
      throw new ClientError("CONTEXT_CHANGED");
    return this.commit(draft, true);
  }
  private async commit(
    draft: Draft,
    reconcile = false,
  ): Promise<OperationResult> {
    if (
      !reconcile &&
      ((draft.kind === "create" && this.drive.createBox) ||
        (draft.kind === "edit" && this.drive.editBox))
    ) {
      const task = this.task();
      this.update({ busy: true, error: undefined, result: undefined });
      try {
        const result =
          draft.kind === "edit"
            ? await this.drive.editBox!(structuredClone(draft), task.signal)
            : await this.drive.createBox!(
                structuredClone(draft.document),
                draft.index,
                draft.operationId,
                task.signal,
              );
        task.check();
        this.library.reset();
        this.update({
          result,
          locked: result.outcome !== "blocked",
          dirty: result.outcome === "complete" ? false : this.#state.dirty,
        });
        return result;
      } finally {
        task.finish();
        if (task.epoch === this.#epoch) this.update({ busy: false });
      }
    }
    const task = this.task();
    const result: OperationResult = {
      outcome: "blocked",
      phase: "gate",
      steps: [],
      boxId: draft.document.box.id,
      boxNumber: draft.document.box.number,
      folderId: draft.folder?.id,
    };
    this.update({ busy: true, error: undefined, result: undefined });
    const confirmed = (phase: string, file?: DriveFile) =>
      result.steps.push({ phase, status: "confirmed", fileId: file?.id });
    const verify = async (file: DriveFile, expected: unknown) => {
      const snapshot = await this.drive.readJson(file.id, task.signal);
      task.check();
      if (!identical(snapshot.document, expected))
        throw new ClientError("READ_CONFLICT");
      return snapshot;
    };
    try {
      this.drive.assertWritesAvailable();
      task.check();
      result.phase = "preflight";
      if (this.drive.root?.id !== draft.rootId)
        throw new ClientError("CONTEXT_CHANGED");
      const currentIndex = await this.readIndex(task.signal);
      task.check();
      if (currentIndex.file.capabilities?.canEdit === false)
        throw new ClientError("DRIVE_FORBIDDEN");
      if (currentIndex.file.id !== draft.index.file.id)
        throw new ClientError("DRIVE_CONFLICT");
      await this.currentSnapshot(draft.index, task.signal);
      task.check();
      let folder = draft.folder;
      const document = structuredClone(draft.document);
      document.box.modified = new Date().toISOString();
      if (draft.kind === "edit") {
        const currentInventory = await this.currentSnapshot(
          draft.inventory!,
          task.signal,
        );
        task.check();
        if (currentInventory.file.capabilities?.canEdit === false)
          throw new ClientError("DRIVE_FORBIDDEN");
        const currentFolder = await this.drive.withinRoot(
          folder!.id,
          task.signal,
        );
        task.check();
        if (
          currentFolder.version !== folder!.version ||
          currentFolder.capabilities?.canEdit === false
        )
          throw new ClientError("DRIVE_CONFLICT");
        const files = await this.drive.listChildren(folder!.id, task.signal);
        task.check();
        if (
          files.filter((f) => f.name === "inventory.json").length !== 1 ||
          !files.some(
            (f) =>
              f.name === "inventory.json" && f.id === draft.inventory!.file.id,
          )
        )
          throw new ClientError("DUPLICATE_INVENTORY");
        if (!reconcile) {
          result.phase = "inventory";
          const written = await this.drive.writeJson(
            draft.inventory!,
            document,
          );
          confirmed(result.phase, written);
          task.check();
          await verify(written, document);
        }
        result.phase = "index";
        const latestIndex = await this.readIndex(task.signal);
        task.check();
        if (latestIndex.file.capabilities?.canEdit === false)
          throw new ClientError("DRIVE_FORBIDDEN");
        if (latestIndex.file.id !== draft.index.file.id)
          throw new ClientError("DRIVE_CONFLICT");
        await this.currentSnapshot(draft.index, task.signal);
        task.check();
        const index = this.indexFor(draft, document, folder!.id);
        const updated = await this.drive.writeJson(draft.index, index);
        confirmed(result.phase, updated);
        task.check();
        await verify(updated, index);
      } else {
        const report = await this.library.recover();
        task.check();
        if (!report.complete) throw new ClientError("RECOVERY_INCOMPLETE");
        const original = draft.index.document as BoxIndex;
        if (
          original.boxes.length !== report.candidate.boxes.length ||
          original.boxes.some(
            (entry) =>
              !report.candidate.boxes.some((candidate) =>
                identical(entry, candidate),
              ),
          )
        )
          throw new ClientError("INDEX_STALE");
        const root = await this.drive.withinRoot(draft.rootId, task.signal);
        task.check();
        if (root.capabilities?.canAddChildren === false)
          throw new ClientError("DRIVE_FORBIDDEN");
        if (
          report.candidate.boxes.some(
            (b) =>
              b.boxNumber === document.box.number ||
              b.boxId === document.box.id,
          )
        )
          throw new ClientError("DRIVE_CONFLICT");
        result.phase = "pending-folder";
        folder = await this.drive.createPendingFolder(
          draft.rootId,
          draft.operationId,
        );
        result.folderId = folder.id;
        confirmed(result.phase, folder);
        task.check();
        result.phase = "pending-marker";
        const marker = await this.drive.createJson(
          folder.id,
          "box-storage-pending.json",
          {
            formatVersion: 1,
            operationId: draft.operationId,
            boxId: document.box.id,
            boxNumber: document.box.number,
            folderId: folder.id,
            indexId: draft.index.file.id,
          },
        );
        confirmed(result.phase, marker);
        task.check();
        result.phase = "draft-inventory";
        const pending = await this.drive.createJson(
          folder.id,
          "inventory.pending.json",
          document,
        );
        confirmed(result.phase, pending);
        task.check();
        await verify(pending, document);
        result.phase = "number-claim";
        const claimIndex = await this.readIndex(task.signal);
        task.check();
        if (claimIndex.file.capabilities?.canEdit === false)
          throw new ClientError("DRIVE_FORBIDDEN");
        if (claimIndex.file.id !== draft.index.file.id)
          throw new ClientError("DRIVE_CONFLICT");
        const index = this.indexFor(draft, document, folder.id);
        const claimed = await this.drive.writeJson(draft.index, index);
        confirmed(result.phase, claimed);
        task.check();
        await verify(claimed, index);
        result.phase = "publish-inventory";
        const files = await this.drive.listChildren(folder.id, task.signal);
        task.check();
        if (
          files.some((f) => f.name === "inventory.json") ||
          files.filter((f) => f.name === "inventory.pending.json").length !== 1
        )
          throw new ClientError("DUPLICATE_INVENTORY");
        const currentPending = await this.drive.withinRoot(
          pending.id,
          task.signal,
        );
        task.check();
        const published = await this.drive.renameFile(
          currentPending,
          "inventory.json",
        );
        confirmed(result.phase, published);
        task.check();
        if (published.name !== "inventory.json")
          throw new ClientError("AMBIGUOUS_WRITE");
        await verify(published, document);
        result.phase = "folder";
        const currentFolder = await this.drive.withinRoot(
          folder.id,
          task.signal,
        );
        task.check();
        folder = await this.drive.renameFile(
          currentFolder,
          folderName(document),
          boxDescription(document),
        );
        confirmed(result.phase, folder);
        task.check();
        if (
          folder.name !== folderName(document) ||
          folder.description !== boxDescription(document)
        )
          throw new ClientError("AMBIGUOUS_WRITE");
        result.phase = "marker-cleanup";
        const trashed = await this.drive.trash(marker.id);
        confirmed(result.phase, trashed);
        task.check();
        if (!trashed.trashed) throw new ClientError("AMBIGUOUS_WRITE");
      }
      if (
        draft.kind === "edit" &&
        (folder!.name !== folderName(document) ||
          folder!.description !== boxDescription(document))
      ) {
        result.phase = "folder";
        const renamed = await this.drive.renameFile(
          folder!,
          folderName(document),
          boxDescription(document),
        );
        confirmed(result.phase, renamed);
        task.check();
        if (
          renamed.name !== folderName(document) ||
          renamed.description !== boxDescription(document)
        )
          throw new ClientError("AMBIGUOUS_WRITE");
      }
      task.check();
      result.outcome = "complete";
      result.phase = "verified";
      this.library.reset();
    } catch (error) {
      result.code = codeOf(error);
      const uncertain =
        [
          "AMBIGUOUS_WRITE",
          "NETWORK_FAILED",
          "CONTEXT_CHANGED",
          "AUTH_REQUIRED",
          "UNAVAILABLE",
        ].includes(result.code) &&
        !["gate", "preflight"].includes(result.phase);
      if (uncertain)
        result.steps.push({ phase: result.phase, status: "uncertain" });
      result.outcome = uncertain
        ? "ambiguous"
        : result.steps.length
          ? "partial"
          : result.code === "DRIVE_CONFLICT"
            ? "conflict"
            : "blocked";
    } finally {
      task.finish();
      if (
        task.epoch === this.#epoch &&
        (result.steps.length || result.outcome === "ambiguous") &&
        result.outcome !== "complete"
      )
        this.library.reset();
      if (task.epoch === this.#epoch)
        this.update({
          busy: false,
          result,
          locked: result.outcome !== "blocked",
          dirty: result.outcome === "complete" ? false : this.#state.dirty,
        });
    }
    return result;
  }
}
