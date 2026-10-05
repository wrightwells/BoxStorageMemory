import { validator } from "./validation";
import type { Inventory } from "../../../shared/typescript/models";
import type { ApiClient } from "./api";
import type { DriveFile, DriveStorageService } from "./drive";
import { ClientError } from "./errors";
import { validUuid, type BoxView, type LibraryService } from "./library";
import { PhotoCamera, preparePhoto } from "./image-processing";
import { photoDescription } from "./discoverability";

export type PhotoDrive = Pick<
  DriveStorageService,
  | "root"
  | "withinRoot"
  | "listChildren"
  | "readJson"
  | "assertWritesAvailable"
  | "uploadImage"
  | "writeJson"
  | "trash"
> &
  Partial<
    Pick<DriveStorageService, "assertPhotoWritesAvailable" | "managePhotos">
  >;
export interface PhotoSelection {
  id: string;
  blob: Blob;
  url: string;
}
export interface RecoveredPhoto {
  file: DriveFile;
  eligible: boolean;
  reason: string;
}
export type PhotoAction =
  | { kind: "add" }
  | { kind: "replace" | "remove"; filename: string }
  | { kind: "item" };
interface Operation {
  id: string;
  action: PhotoAction;
  base: BoxView;
  uploaded: DriveFile[];
  obsolete: DriveFile[];
  proposed?: Inventory;
  attempted: boolean;
  refsConfirmed: boolean;
  uploadUncertain: boolean;
}
export interface PhotoState {
  view?: BoxView;
  itemId?: string;
  selected: PhotoSelection[];
  busy: boolean;
  preparing: boolean;
  locked: boolean;
  error?: string;
  messages: string[];
  operation?: Operation;
  recovered: RecoveredPhoto[];
}
export function photoFilename(
  inventory: Inventory,
  itemId: string,
  photoId: string,
): string {
  const item = inventory.items.find((entry) => entry.id === itemId);
  if (!item) throw new ClientError("ITEM_NOT_FOUND");
  const slug =
    item.name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "item";
  return `${inventory.box.number}-${slug}-${itemId}-${photoId}.jpg`;
}
export class PhotoService {
  readonly camera = new PhotoCamera();
  #state: PhotoState = {
    selected: [],
    busy: false,
    preparing: false,
    locked: false,
    messages: [],
    recovered: [],
  };
  #listeners = new Set<() => void>();
  #epoch = 0;
  #controller = new AbortController();
  readonly validator = validator;
  constructor(
    private readonly drive: PhotoDrive,
    private readonly library: LibraryService,
    private readonly api: Pick<ApiClient, "validate">,
    private readonly generation: () => number,
    private readonly editorDirty: () => boolean = () => false,
    private readonly process = preparePhoto,
  ) {}
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  private update(patch: Partial<PhotoState>) {
    this.#state = { ...this.#state, ...patch };
    this.#listeners.forEach((listener) => listener());
  }
  get dirty() {
    return (
      this.#state.selected.length > 0 ||
      this.#state.busy ||
      this.#state.preparing ||
      !!this.#state.operation
    );
  }
  get writesAvailable() {
    try {
      if (this.drive.assertPhotoWritesAvailable)
        this.drive.assertPhotoWritesAvailable();
      else this.drive.assertWritesAvailable();
      return true;
    } catch {
      return false;
    }
  }
  get retryAvailable() {
    try {
      this.drive.assertWritesAvailable();
      return true;
    } catch {
      return false;
    }
  }
  reset() {
    this.#epoch++;
    this.#controller.abort();
    this.#controller = new AbortController();
    this.camera.stop();
    this.#state.selected.forEach((photo) => URL.revokeObjectURL(photo.url));
    this.update({
      view: undefined,
      itemId: undefined,
      selected: [],
      busy: false,
      preparing: false,
      locked: false,
      error: undefined,
      operation: undefined,
      messages: [],
      recovered: [],
    });
  }
  private fence() {
    const epoch = this.#epoch,
      generation = this.generation(),
      root = this.drive.root?.id;
    return () => {
      if (
        epoch !== this.#epoch ||
        generation !== this.generation() ||
        root !== this.drive.root?.id
      )
        throw new ClientError("CONTEXT_CHANGED");
    };
  }
  async open(boxId: string, itemId: string) {
    this.reset();
    const current = this.fence();
    const view = await this.library.box(boxId, true);
    current();
    if (!validUuid(itemId)) throw new ClientError("ITEM_NOT_FOUND");
    if (
      !view.inventory.items.some((item) => item.id === itemId) &&
      !view.files.some(
        (file) =>
          file.appProperties?.bsmBoxId === boxId &&
          file.appProperties?.bsmItemId === itemId,
      )
    )
      throw new ClientError("ITEM_NOT_FOUND");
    this.update({ view, itemId });
  }
  // Read-only discovery also works after a page restart or item removal. It never
  // reconstructs a replacement/deletion intent from upload ownership metadata.
  async discover() {
    if (this.#state.busy || this.#state.preparing)
      throw new ClientError("EDIT_BUSY");
    const base = this.#state.view,
      itemId = this.#state.itemId;
    if (!base || !itemId) throw new ClientError("ITEM_NOT_FOUND");
    const current = this.fence();
    this.update({ busy: true, error: undefined });
    try {
      const view = await this.fresh(base, current);
      const files = await this.drive.listChildren(view.folder.id);
      current();
      const recovered = files
        .filter(
          (file) =>
            file.appProperties?.bsmBoxId === view.inventory.box.id &&
            file.appProperties?.bsmItemId === itemId,
        )
        .map((file) => {
          let reason =
            "Unreferenced owned upload; review before association or cleanup.";
          const photoId = file.name.slice(-40, -4);
          if (
            view.inventory.items.some((item) =>
              item.images?.includes(file.name),
            )
          )
            reason = "Referenced by the current inventory; retained.";
          else if (
            files.filter((other) => other.name === file.name).length !== 1
          )
            reason = "Duplicate filename; retained.";
          else if (
            file.mimeType !== "image/jpeg" ||
            !file.version ||
            !validUuid(file.appProperties!.bsmPhotoOperationId ?? "") ||
            !validUuid(photoId) ||
            !file.name.startsWith(`${view.inventory.box.number}-`) ||
            !file.name.endsWith(`-${itemId}-${photoId}.jpg`)
          )
            reason =
              "Ownership format or version cannot be verified; retained.";
          return { file, eligible: reason.startsWith("Unreferenced"), reason };
        });
      this.update({ view, recovered });
      return recovered;
    } finally {
      try {
        current();
        this.update({ busy: false });
      } catch {
        /* Context changed. */
      }
    }
  }
  async recoverFiles(
    ids: string[],
    action: "associate" | "cleanup",
    confirmed: boolean,
  ) {
    if (!confirmed) throw new ClientError("CONFIRMATION_REQUIRED");
    if (this.#state.busy || this.#state.preparing)
      throw new ClientError("EDIT_BUSY");
    if (this.#state.operation) throw new ClientError("EDIT_LOCKED");
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new ClientError("PHOTO_SELECTION_REQUIRED");
    if (this.drive.managePhotos) {
      if (this.editorDirty()) throw new ClientError("PHOTO_EDITOR_DIRTY");
      const current = this.fence();
      const reviewed = this.#state.recovered;
      const latest = await this.discover();
      current();
      const candidates = ids.map((id) => {
        const before = reviewed.find((p) => p.file.id === id),
          after = latest.find((p) => p.file.id === id);
        if (
          !before?.eligible ||
          !after?.eligible ||
          before.file.version !== after.file.version ||
          before.file.name !== after.file.name
        )
          throw new ClientError("DRIVE_CONFLICT");
        return after.file;
      });
      this.update({ busy: true, error: undefined });
      try {
        const view = this.#state.view!;
        const result = await this.drive.managePhotos(
          view,
          {
            itemId: this.#state.itemId!,
            action: { kind: action === "associate" ? "associate" : "cleanup" },
            candidates,
          },
          crypto.randomUUID(),
          this.#controller.signal,
        );
        current();
        if (result.outcome !== "complete") {
          this.update({
            error: result.code ?? "DRIVE_CONFLICT",
            locked: ["partial", "ambiguous"].includes(result.outcome),
            messages: [
              `Recovered photo operation ${result.outcome} at ${result.phase}; review pending records.`,
            ],
          });
          return;
        }
        this.update({
          view: await this.fresh(view, current),
          messages:
            action === "associate"
              ? ["Recovered photo association verified."]
              : [
                  "Reviewed owned uploads cleaned up; referenced or unverified files retained.",
                ],
        });
      } finally {
        current();
        this.library.reset();
        this.update({ busy: false });
      }
      await this.discover();
      return;
    }
    this.drive.assertWritesAvailable();
    if (this.editorDirty()) throw new ClientError("PHOTO_EDITOR_DIRTY");
    const current = this.fence();
    const reviewed = this.#state.recovered;
    const latest = await this.discover();
    current();
    const files = ids.map((id) => {
      const before = reviewed.find((photo) => photo.file.id === id);
      const after = latest.find((photo) => photo.file.id === id);
      if (
        !before?.eligible ||
        !after?.eligible ||
        before.file.version !== after.file.version ||
        before.file.name !== after.file.name
      )
        throw new ClientError("DRIVE_CONFLICT");
      return after.file;
    });
    const base = this.#state.view!,
      itemId = this.#state.itemId!;
    if (
      action === "associate" &&
      !base.inventory.items.some((item) => item.id === itemId)
    )
      throw new ClientError("ITEM_NOT_FOUND");
    const operation: Operation = {
      id: crypto.randomUUID(),
      action: { kind: "add" },
      base,
      uploaded: files,
      obsolete: [],
      attempted: true,
      refsConfirmed: false,
      uploadUncertain: false,
    };
    if (action === "associate")
      operation.proposed = this.proposal(operation, base.inventory, itemId);
    this.update({ operation, locked: true });
    if (action === "associate") await this.review(true, true);
    else await this.cleanup(true);
    current();
    await this.discover();
  }
  async forgetOperation(confirmed: boolean) {
    if (!confirmed) throw new ClientError("CONFIRMATION_REQUIRED");
    await this.discover();
    this.#state.selected.forEach((photo) => URL.revokeObjectURL(photo.url));
    this.update({
      operation: undefined,
      locked: false,
      selected: [],
      messages: [
        "In-memory operation review and previews discarded. Drive changes were not undone; inspect recovered uploads before choosing another action.",
      ],
    });
  }
  async select(files: Blob[], resize = true) {
    if (this.#state.busy || this.#state.locked || this.#state.preparing)
      throw new ClientError("EDIT_BUSY");
    if (files.length + this.#state.selected.length > 20)
      throw new ClientError("TOO_MANY_PHOTOS");
    const current = this.fence();
    this.update({ preparing: true, error: undefined });
    try {
      for (const source of files) {
        const blob = await this.process(
          source,
          resize,
          this.#controller.signal,
        );
        current();
        const photo = {
          id: crypto.randomUUID(),
          blob,
          url: URL.createObjectURL(blob),
        };
        this.update({ selected: [...this.#state.selected, photo] });
      }
    } finally {
      try {
        current();
        this.update({ preparing: false });
      } catch {
        /* A new context owns its own state. */
      }
    }
  }
  drop(id: string) {
    if (this.#state.busy || this.#state.preparing)
      throw new ClientError("EDIT_BUSY");
    const photo = this.#state.selected.find((entry) => entry.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    this.update({
      selected: this.#state.selected.filter((entry) => entry.id !== id),
    });
  }
  private async fresh(base: BoxView, current: () => void) {
    const view = await this.library.box(base.inventory.box.id, true);
    current();
    if (
      view.folder.id !== base.folder.id ||
      view.snapshot.file.id !== base.snapshot.file.id
    )
      throw new ClientError("DRIVE_CONFLICT");
    return view;
  }
  private editable(view: BoxView) {
    if (
      view.folder.capabilities?.canAddChildren === false ||
      view.snapshot.file.capabilities?.canEdit === false
    )
      throw new ClientError("DRIVE_FORBIDDEN");
  }
  private unique(files: DriveFile[], filename: string) {
    const candidates = files.filter((file) => file.name === filename);
    if (candidates.length !== 1)
      throw new ClientError(
        candidates.length ? "DUPLICATE_FILE" : "IMAGE_NOT_FOUND",
      );
    if (
      candidates[0]!.mimeType !== "image/jpeg" &&
      !/^image\/(png|webp)$/.test(candidates[0]!.mimeType)
    )
      throw new ClientError("INVALID_IMAGE");
    return candidates[0]!;
  }
  private proposal(
    operation: Operation,
    base: Inventory,
    itemId: string,
  ): Inventory {
    const document = structuredClone(base);
    const item = document.items.find((entry) => entry.id === itemId);
    if (!item) throw new ClientError("ITEM_NOT_FOUND");
    const action = operation.action;
    if (action.kind === "item")
      document.items = document.items.filter((entry) => entry.id !== itemId);
    else if (action.kind === "add")
      item.images = [
        ...(item.images ?? []),
        ...operation.uploaded.map((file) => file.name),
      ];
    else {
      if (!item.images?.includes(action.filename))
        throw new ClientError("DRIVE_CONFLICT");
      item.images = item.images.flatMap((name) =>
        name === action.filename
          ? operation.uploaded.map((file) => file.name)
          : [name],
      );
    }
    document.box.modified = new Date().toISOString();
    return document;
  }
  private async validate(document: Inventory, current: () => void) {
    if (!this.validator.validate("inventory", document).valid)
      throw new ClientError("INVALID_INVENTORY");
    const result = await this.api.validate(
      "inventory",
      document,
      this.#controller.signal,
    );
    current();
    if (!result.valid) throw new ClientError("INVALID_INVENTORY");
  }
  async save(action: PhotoAction, confirmed = false) {
    if (this.#state.busy || this.#state.preparing)
      throw new ClientError("EDIT_BUSY");
    if (this.#state.locked) throw new ClientError("EDIT_LOCKED");
    if (action.kind !== "add" && !confirmed)
      throw new ClientError("DELETE_CONFIRMATION_REQUIRED");
    if (this.editorDirty()) throw new ClientError("PHOTO_EDITOR_DIRTY");
    const base = this.#state.view,
      itemId = this.#state.itemId;
    if (!base || !itemId) throw new ClientError("ITEM_NOT_FOUND");
    if (
      (action.kind === "add" && !this.#state.selected.length) ||
      (action.kind === "replace" && this.#state.selected.length !== 1)
    )
      throw new ClientError("PHOTO_SELECTION_REQUIRED");
    if (this.drive.managePhotos) {
      const current = this.fence();
      const operation: Operation = {
        id: crypto.randomUUID(),
        action,
        base,
        uploaded: [],
        obsolete: [],
        attempted: false,
        refsConfirmed: false,
        uploadUncertain: false,
      };
      this.update({ busy: true, error: undefined, messages: [] });
      try {
        const planned: Operation = {
          ...operation,
          uploaded: this.#state.selected.map((photo) => ({
            id: photo.id,
            name: photoFilename(base.inventory, itemId, photo.id),
            mimeType: "image/jpeg",
          })),
        };
        await this.validate(
          this.proposal(planned, base.inventory, itemId),
          current,
        );
        const result = await this.drive.managePhotos(
          base,
          {
            itemId,
            action,
            selections: this.#state.selected.map((photo) => ({
              id: photo.id,
              name: photoFilename(base.inventory, itemId, photo.id),
              blob: photo.blob,
            })),
          },
          operation.id,
          this.#controller.signal,
        );
        current();
        operation.uploaded = result.uploaded ?? [];
        operation.obsolete = result.obsolete ?? [];
        operation.attempted =
          result.steps.length > 0 ||
          ["partial", "ambiguous"].includes(result.outcome);
        operation.refsConfirmed = result.steps.some(
          (step) => step.phase === "inventory" && step.status === "confirmed",
        );
        operation.uploadUncertain =
          result.outcome === "ambiguous" && result.phase === "photo-upload";
        if (result.outcome !== "complete") {
          this.update({
            operation: operation.attempted ? operation : undefined,
            locked: operation.attempted,
            error: result.code ?? "DRIVE_CONFLICT",
            messages: [
              `Photo operation ${result.outcome} at ${result.phase}. Pending records remain for review; no request will be repeated automatically.`,
            ],
          });
          return;
        }
        const view = await this.fresh(base, current);
        this.#state.selected.forEach((photo) => URL.revokeObjectURL(photo.url));
        this.update({
          view,
          selected: [],
          operation: operation.obsolete.length ? operation : undefined,
          locked: operation.obsolete.length > 0,
          messages: operation.obsolete.length
            ? [
                "Inventory references confirmed. Old files remain until you review cleanup.",
              ]
            : ["Photo association complete."],
        });
      } finally {
        current();
        this.library.reset();
        this.update({ busy: false });
      }
      return;
    }
    this.drive.assertWritesAvailable(); // Always before any live side effect.
    const current = this.fence();
    const operation: Operation = {
      id: crypto.randomUUID(),
      action,
      base,
      uploaded: [],
      obsolete: [],
      attempted: false,
      refsConfirmed: false,
      uploadUncertain: false,
    };
    this.update({ busy: true, messages: [], error: undefined });
    try {
      const view = await this.fresh(base, current);
      this.editable(view);
      if (
        !base.snapshot.file.version ||
        view.snapshot.file.version !== base.snapshot.file.version
      )
        throw new ClientError("DRIVE_CONFLICT");
      const files = await this.drive.listChildren(view.folder.id);
      current();
      const item = view.inventory.items.find((entry) => entry.id === itemId)!;
      const obsolete =
        action.kind === "item"
          ? (item.images ?? [])
          : action.kind === "add"
            ? []
            : [action.filename];
      operation.obsolete = [...new Set(obsolete)].flatMap((name) => {
        if (!files.some((file) => file.name === name)) {
          this.update({
            messages: [
              ...this.#state.messages,
              `Photo ${name} is already missing; only its reference will be removed.`,
            ],
          });
          return [];
        }
        return [this.unique(files, name)];
      });
      if (action.kind === "replace" || action.kind === "remove") {
        if (!item.images?.includes(action.filename))
          throw new ClientError("IMAGE_NOT_FOUND");
      }
      if (action.kind === "add" || action.kind === "replace") {
        for (const photo of this.#state.selected) {
          const name = photoFilename(view.inventory, itemId, photo.id);
          if (files.some((file) => file.name === name))
            throw new ClientError("DUPLICATE_FILE");
          operation.attempted = operation.uploadUncertain = true;
          const file = await this.drive.uploadImage(
            view.folder.id,
            name,
            photo.blob,
            {
              bsmPhotoOperationId: operation.id,
              bsmBoxId: view.inventory.box.id,
              bsmItemId: itemId,
            },
            photoDescription(view.inventory, itemId),
          );
          current();
          operation.uploaded.push(file);
          operation.uploadUncertain = false;
          this.update({
            operation,
            messages: [
              ...this.#state.messages,
              `Uploaded ${file.name}; inventory reference not yet confirmed.`,
            ],
          });
        }
      }
      operation.proposed = this.proposal(operation, view.inventory, itemId);
      await this.validate(operation.proposed, current);
      // Re-read after uploads; upload does not change the inventory version.
      const latest = await this.fresh(view, current);
      if (latest.snapshot.file.version !== view.snapshot.file.version)
        throw new ClientError("DRIVE_CONFLICT");
      await this.publish(operation, latest, current);
    } catch (error) {
      current();
      this.update({
        error: error instanceof ClientError ? error.code : "AMBIGUOUS_WRITE",
        locked: operation.attempted,
        operation: operation.attempted ? operation : undefined,
        messages: [
          ...this.#state.messages,
          operation.attempted
            ? "Operation interrupted. Review current Drive records before retrying. Uploaded files are retained."
            : "No photo mutation was attempted.",
        ],
      });
      throw error;
    } finally {
      try {
        current();
        if (operation.attempted) this.library.reset();
        this.update({ busy: false });
      } catch {
        /* Ignore old-context completion. */
      }
    }
  }
  private async publish(
    operation: Operation,
    view: BoxView,
    current: () => void,
  ) {
    operation.attempted = true;
    const result = await this.drive.writeJson(
      view.snapshot,
      operation.proposed!,
    );
    current();
    const verified = await this.fresh(view, current);
    if (
      verified.snapshot.file.version !== result.version ||
      JSON.stringify(verified.inventory) !== JSON.stringify(operation.proposed)
    )
      throw new ClientError("AMBIGUOUS_WRITE");
    operation.refsConfirmed = true;
    this.#state.selected.forEach((photo) => URL.revokeObjectURL(photo.url));
    this.update({
      view: verified,
      selected: [],
      operation,
      locked: true,
      messages: [
        ...this.#state.messages,
        "Inventory references confirmed. Old files remain until you review cleanup.",
      ],
    });
    if (!operation.obsolete.length)
      this.update({
        operation: undefined,
        locked: false,
        messages: [...this.#state.messages, "Photo association complete."],
      });
  }
  // Explicit retry of a known proposal, never automatic re-upload. A changed baseline
  // requires human resolution in Drive; a lost response can be recognised by re-read.
  async review(retry = false, confirmed = false) {
    if (this.#state.busy) throw new ClientError("EDIT_BUSY");
    const operation = this.#state.operation;
    if (!operation) return;
    if (retry && !confirmed) throw new ClientError("CONFIRMATION_REQUIRED");
    const current = this.fence();
    this.update({ busy: true, error: undefined });
    try {
      const view = await this.fresh(operation.base, current);
      if (
        operation.proposed &&
        JSON.stringify(view.inventory) === JSON.stringify(operation.proposed)
      ) {
        operation.refsConfirmed = true;
        this.#state.selected.forEach((photo) => URL.revokeObjectURL(photo.url));
        this.update({
          view,
          selected: [],
          messages: [
            "Current inventory matches this operation; references confirmed.",
          ],
        });
        if (!operation.obsolete.length)
          this.update({ operation: undefined, locked: false });
      } else {
        this.update({
          view,
          messages: [
            "Inventory differs from the proposed operation. Files were retained; no upload was repeated.",
          ],
        });
        if (retry) {
          this.drive.assertWritesAvailable();
          if (this.editorDirty()) throw new ClientError("PHOTO_EDITOR_DIRTY");
          if (
            operation.uploadUncertain ||
            !operation.proposed ||
            view.snapshot.file.version !== operation.base.snapshot.file.version
          )
            throw new ClientError("DRIVE_CONFLICT");
          this.editable(view);
          const files = await this.drive.listChildren(view.folder.id);
          current();
          for (const file of operation.uploaded)
            if (this.unique(files, file.name).id !== file.id)
              throw new ClientError("DRIVE_CONFLICT");
          await this.validate(operation.proposed, current);
          await this.publish(operation, view, current);
        }
      }
    } catch (error) {
      current();
      this.update({
        error: error instanceof ClientError ? error.code : "AMBIGUOUS_WRITE",
      });
      throw error;
    } finally {
      try {
        current();
        this.library.reset();
        this.update({ busy: false });
      } catch {
        /* Context changed. */
      }
    }
  }
  async cleanup(confirmed: boolean) {
    if (!confirmed) throw new ClientError("CONFIRMATION_REQUIRED");
    if (this.#state.busy) throw new ClientError("EDIT_BUSY");
    const operation = this.#state.operation;
    if (!operation) return;
    if (this.drive.managePhotos) {
      if (this.editorDirty()) throw new ClientError("PHOTO_EDITOR_DIRTY");
      const current = this.fence();
      this.update({ busy: true, error: undefined });
      try {
        const view = await this.fresh(operation.base, current);
        const candidates = operation.refsConfirmed
          ? operation.obsolete
          : operation.uploaded;
        const result = await this.drive.managePhotos(
          view,
          {
            itemId: this.#state.itemId!,
            action: { kind: "cleanup" },
            candidates,
          },
          crypto.randomUUID(),
          this.#controller.signal,
        );
        current();
        if (result.outcome !== "complete") {
          this.update({
            error: result.code ?? "DRIVE_CONFLICT",
            messages: [
              `Cleanup ${result.outcome} at ${result.phase}; pending records retained.`,
            ],
          });
          return;
        }
        this.update({
          view: await this.fresh(view, current),
          operation: undefined,
          locked: false,
          messages: [
            ...result.steps
              .filter((s) => s.phase === "photo-cleanup")
              .map((s) => `Moved owned photo ${s.fileId} to Drive trash.`),
            ...(result.retained ?? []).map(
              (name) =>
                `Retained ${name}: still referenced, changed or ownership/permission unverified.`,
            ),
          ],
        });
      } finally {
        current();
        this.library.reset();
        this.update({ busy: false });
      }
      return;
    }
    this.drive.assertWritesAvailable();
    if (this.editorDirty()) throw new ClientError("PHOTO_EDITOR_DIRTY");
    const current = this.fence();
    this.update({ busy: true, error: undefined });
    try {
      const candidates = operation.refsConfirmed
        ? operation.obsolete
        : operation.uploaded;
      for (const candidate of candidates) {
        const view = await this.fresh(operation.base, current);
        if (!view.snapshot.file.version)
          throw new ClientError("DRIVE_CONFLICT");
        if (
          view.inventory.items.some((item) =>
            item.images?.includes(candidate.name),
          )
        ) {
          this.update({
            messages: [
              ...this.#state.messages,
              `Retained referenced file ${candidate.name}.`,
            ],
          });
          continue;
        }
        const files = await this.drive.listChildren(view.folder.id);
        current();
        const matches = files.filter((file) => file.name === candidate.name);
        if (!matches.length) continue; // A previous cleanup may have succeeded.
        const file = this.unique(files, candidate.name);
        const properties = file.appProperties;
        if (
          file.id !== candidate.id ||
          file.version !== candidate.version ||
          file.capabilities?.canTrash === false ||
          properties?.bsmBoxId !== view.inventory.box.id ||
          !properties.bsmPhotoOperationId ||
          properties.bsmItemId !== this.#state.itemId
        ) {
          this.update({
            messages: [
              ...this.#state.messages,
              `Retained ${candidate.name}: ownership, identity or permission could not be verified.`,
            ],
          });
          continue;
        }
        // The production gate also requires exclusion of concurrent re-reference;
        // a pre-read alone is NOT sufficient to authorise a live trash operation.
        await this.drive.trash(file.id);
        current();
        this.update({
          messages: [
            ...this.#state.messages,
            `Moved ${file.name} to Drive trash.`,
          ],
        });
      }
      if (operation.uploadUncertain)
        this.update({
          messages: [
            ...this.#state.messages,
            `Upload response was lost. Inspect folder ${operation.base.folder.id} for operation ${operation.id}; no unknown file was removed.`,
          ],
        });
      else this.update({ operation: undefined, locked: false });
    } catch (error) {
      current();
      this.update({
        error: error instanceof ClientError ? error.code : "AMBIGUOUS_WRITE",
      });
      throw error;
    } finally {
      try {
        current();
        this.library.reset();
        this.update({ busy: false });
      } catch {
        /* Context changed. */
      }
    }
  }
}
