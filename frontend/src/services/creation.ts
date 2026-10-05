import type { BoxIndex, Inventory } from "../../../shared/typescript/models";
import type { DriveFile, JsonSnapshot } from "./drive";
import type { GoogleAuthService } from "./google";
import type { Draft, OperationResult } from "./editing";
import { ClientError } from "./errors";
import { ApiClient } from "./api";
import { validator } from "./validation";
import { photoDescription, boxDescription } from "./discoverability";

// v3 ignores If-Match in the live probes. All conditional mutations use v2.
export const CREATION_PROTOCOL = "drive-v2-cas-1";
const V2 = "https://www.googleapis.com/drive/v2/files";
const V3 = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive";
const FOLDER = "application/vnd.google-apps.folder";
export const DRIVE_FOLDER_QR_FILENAME = "box-folder-qr.png";
const FIELDS =
  "id,title,description,mimeType,version,etag,parents(id),labels(trashed),properties,capabilities(canEdit,canAddChildren,canTrash)";
type Property = { key: string; value: string; visibility: string };
interface ConditionalFile extends DriveFile {
  etag: string;
  driveProperties: Property[];
}
interface Storage {
  readonly root: DriveFile | undefined;
  withinRoot(id: string, signal?: AbortSignal): Promise<DriveFile>;
  listChildren(id: string, signal?: AbortSignal): Promise<DriveFile[]>;
  readJson(id: string, signal?: AbortSignal): Promise<JsonSnapshot>;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const code = (error: unknown) =>
  error instanceof ClientError ? error.code : "UNAVAILABLE";
const folderName = (document: Inventory) =>
  `${document.box.number} ${document.box.name}`
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

export interface PhotoWork {
  itemId: string;
  action:
    | { kind: "add" | "item" | "cleanup" | "associate" }
    | { kind: "replace" | "remove"; filename: string };
  selections?: { id: string; name: string; blob: Blob }[];
  candidates?: DriveFile[];
}
export interface PhotoWriteResult extends OperationResult {
  uploaded?: DriveFile[];
  obsolete?: DriveFile[];
  retained?: string[];
}
export class CoordinatedCreation {
  constructor(
    private auth: Pick<
      GoogleAuthService,
      "request" | "generation" | "assertCurrent"
    >,
    private storage: Storage,
    private generateFolderQr = (folderId: string, signal?: AbortSignal) =>
      new ApiClient().driveFolderQr(folderId, signal),
  ) {}
  private task(signal?: AbortSignal) {
    const generation = this.auth.generation;
    const root = this.storage.root;
    if (!root) throw new ClientError("ROOT_REQUIRED");
    return {
      root,
      check: () => {
        this.auth.assertCurrent(generation);
        if (signal?.aborted || this.storage.root?.id !== root.id)
          throw new ClientError("CONTEXT_CHANGED");
      },
    };
  }
  private normalize(raw: Record<string, unknown>): ConditionalFile {
    if (
      typeof raw.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(raw.id) ||
      typeof raw.title !== "string" ||
      typeof raw.mimeType !== "string" ||
      typeof raw.version !== "string" ||
      typeof raw.etag !== "string" ||
      !/^"[^"\r\n]+"$/.test(raw.etag)
    )
      throw new ClientError("ATOMIC_WRITE_UNVERIFIED");
    const properties = (raw.properties ?? []) as Property[];
    if (
      !Array.isArray(properties) ||
      properties.some(
        (p) =>
          typeof p.key !== "string" ||
          typeof p.value !== "string" ||
          !["PUBLIC", "PRIVATE"].includes(p.visibility),
      )
    )
      throw new ClientError("INVALID_DRIVE_DATA");
    return {
      id: raw.id,
      name: raw.title,
      mimeType: raw.mimeType,
      version: raw.version,
      etag: raw.etag,
      description: raw.description as string | undefined,
      parents: (raw.parents as { id: string }[] | undefined)?.map((p) => p.id),
      trashed: (raw.labels as { trashed?: boolean } | undefined)?.trashed,
      capabilities: raw.capabilities as DriveFile["capabilities"],
      driveProperties: properties,
    };
  }
  private async metadata(id: string, signal?: AbortSignal) {
    await this.storage.withinRoot(id, signal);
    const { data } = await this.auth.request<Record<string, unknown>>(
      `${V2}/${id}?${new URLSearchParams({ fields: FIELDS, supportsAllDrives: "true" })}`,
      { signal },
    );
    const file = this.normalize(data);
    if (file.id !== id || file.trashed)
      throw new ClientError("DRIVE_NOT_FOUND");
    return file;
  }
  private property(file: ConditionalFile, key: string) {
    return file.driveProperties.find(
      (p) => p.key === key && p.visibility === "PUBLIC",
    )?.value;
  }
  private properties(
    file: ConditionalFile,
    values: Record<string, string | null>,
  ) {
    return [
      ...file.driveProperties.filter(
        (p) => p.visibility !== "PUBLIC" || !Object.hasOwn(values, p.key),
      ),
      // v2 merges property entries; omission does not delete a lock. Explicit null does.
      ...Object.entries(values).map(([key, value]) => ({
        key,
        value,
        visibility: "PUBLIC",
      })),
    ];
  }
  private async patch(
    file: ConditionalFile,
    body: unknown,
    signal?: AbortSignal,
  ) {
    if (file.capabilities?.canEdit === false)
      throw new ClientError("DRIVE_FORBIDDEN");
    const { data } = await this.auth.request<Record<string, unknown>>(
      `${V2}/${file.id}?${new URLSearchParams({ fields: FIELDS, supportsAllDrives: "true" })}`,
      {
        method: "PATCH",
        signal,
        headers: { "Content-Type": "application/json", "If-Match": file.etag },
        body: JSON.stringify(body),
      },
    );
    return this.normalize(data);
  }
  private async ids(count: number, signal?: AbortSignal) {
    const { data } = await this.auth.request<{ ids: string[] }>(
      `${V3}/generateIds?count=${count}&space=drive`,
      { signal },
    );
    if (
      !Array.isArray(data.ids) ||
      data.ids.length !== count ||
      new Set(data.ids).size !== count ||
      data.ids.some((id) => !/^[A-Za-z0-9_-]{1,256}$/.test(id))
    )
      throw new ClientError("INVALID_DRIVE_DATA");
    return data.ids;
  }
  private async createFile(
    id: string,
    parent: string,
    name: string,
    document?: unknown,
    signal?: AbortSignal,
  ) {
    if (document === undefined) {
      const { data } = await this.auth.request<DriveFile>(
        `${V3}?fields=id,name,mimeType,version,parents`,
        {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            name,
            parents: [parent],
            mimeType: FOLDER,
          }),
        },
      );
      if (data.id !== id) throw new ClientError("AMBIGUOUS_WRITE");
      return data;
    }
    const boundary = `bsm_${crypto.randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      JSON.stringify({
        id,
        name,
        parents: [parent],
        mimeType: "application/json",
      }),
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      JSON.stringify(document, null, 2),
      `\r\n--${boundary}--\r\n`,
    ]);
    const { data } = await this.auth.request<DriveFile>(
      `${UPLOAD}/v3/files?uploadType=multipart&fields=id,name,mimeType,version,parents`,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (data.id !== id) throw new ClientError("AMBIGUOUS_WRITE");
    return data;
  }
  private async index(id: string, signal?: AbortSignal) {
    const snapshot = await this.storage.readJson(id, signal);
    if (
      snapshot.file.name !== "box-storage-index.json" ||
      snapshot.file.mimeType !== "application/json" ||
      !validator.validate("index", snapshot.document).valid
    )
      throw new ClientError("INVALID_INDEX");
    return snapshot;
  }
  async initialize(signal?: AbortSignal): Promise<JsonSnapshot> {
    const task = this.task(signal);
    for (let attempt = 0; attempt < 4; attempt++) {
      task.check();
      const root = await this.metadata(task.root.id, signal);
      task.check();
      if (this.property(root, "bsmCreateOwner"))
        throw new ClientError("PENDING_CREATION");
      const protocol = this.property(root, "bsmCreateProtocol");
      if (protocol && protocol !== CREATION_PROTOCOL)
        throw new ClientError("UNSUPPORTED_WRITE_PROTOCOL");
      const files = await this.storage.listChildren(root.id, signal);
      task.check();
      const indexes = files.filter((f) => f.name === "box-storage-index.json");
      if (indexes.length > 1) throw new ClientError("DUPLICATE_INDEX");
      if (indexes.length) await this.index(indexes[0]!.id, signal);
      let id = this.property(root, "bsmIndexId");
      if (id && !/^[A-Za-z0-9_-]{1,256}$/.test(id))
        throw new ClientError("INVALID_DRIVE_ID");
      if (indexes.length && id && indexes[0]!.id !== id)
        throw new ClientError("DUPLICATE_INDEX");
      if (!indexes.length && files.length)
        throw new ClientError("LIBRARY_NOT_EMPTY");
      if (!id) {
        id = indexes[0]?.id ?? (await this.ids(1, signal))[0]!;
        task.check();
        try {
          await this.patch(
            root,
            {
              properties: this.properties(root, {
                bsmIndexId: id,
                bsmCreateProtocol: CREATION_PROTOCOL,
              }),
            },
            signal,
          );
        } catch (error) {
          if (code(error) === "DRIVE_CONFLICT") continue;
          throw error;
        }
      }
      task.check();
      if (!indexes.length) {
        try {
          await this.createFile(
            id,
            root.id,
            "box-storage-index.json",
            { schemaVersion: 1, updated: new Date().toISOString(), boxes: [] },
            signal,
          );
        } catch (error) {
          if (code(error) !== "DRIVE_ALREADY_EXISTS") throw error;
        }
      }
      task.check();
      const current = await this.index(id, signal);
      task.check();
      if (!current.file.parents?.includes(root.id))
        throw new ClientError("OUTSIDE_ROOT");
      const finalFiles = await this.storage.listChildren(root.id, signal);
      task.check();
      if (
        finalFiles.filter((f) => f.name === "box-storage-index.json").length !==
        1
      )
        throw new ClientError("DUPLICATE_INDEX");
      return current;
    }
    throw new ClientError("DRIVE_CONFLICT");
  }
  private async inspect(
    rootId: string,
    source: BoxIndex,
    signal?: AbortSignal,
  ) {
    const pending = [rootId];
    const seen = new Set<string>();
    const inventories = new Map<
      string,
      { inventory: Inventory; folderId: string }
    >();
    const numbers = new Set<string>(),
      tags = new Set<string>();
    while (pending.length) {
      const folderId = pending.shift()!;
      if (seen.has(folderId) || seen.size >= 1000)
        throw new ClientError("RECOVERY_INCOMPLETE");
      seen.add(folderId);
      const children = await this.storage.listChildren(folderId, signal);
      if (
        children.some(
          (f) =>
            f.name.startsWith(".box-storage-pending-") ||
            [
              "box-storage-pending.json",
              "inventory.pending.json",
              "box-storage-edit-pending.json",
            ].includes(f.name),
        )
      )
        throw new ClientError("PENDING_CREATION");
      const records = children.filter((f) => f.name === "inventory.json");
      if (records.length > 1) throw new ClientError("DUPLICATE_INVENTORY");
      for (const file of records) {
        const snapshot = await this.storage.readJson(file.id, signal);
        if (!validator.validate("inventory", snapshot.document).valid)
          throw new ClientError("INVALID_INVENTORY");
        const inventory = snapshot.document as Inventory;
        if (
          inventories.has(inventory.box.id) ||
          numbers.has(inventory.box.number) ||
          inventory.box.nfcIds.some((id) => tags.has(id))
        )
          throw new ClientError("RECOVERY_INCOMPLETE");
        inventories.set(inventory.box.id, { inventory, folderId });
        numbers.add(inventory.box.number);
        inventory.box.nfcIds.forEach((id) => tags.add(id));
      }
      pending.push(
        ...children.filter((f) => f.mimeType === FOLDER).map((f) => f.id),
      );
    }
    if (
      inventories.size !== source.boxes.length ||
      source.boxes.some((entry) => {
        const record = inventories.get(entry.boxId),
          box = record?.inventory.box;
        return (
          !box ||
          record?.folderId !== entry.driveFolderId ||
          box.number !== entry.boxNumber ||
          box.name !== entry.name ||
          (box.location ?? "") !== (entry.location ?? "") ||
          !same([...box.nfcIds].sort(), [...entry.nfcIds].sort())
        );
      })
    )
      throw new ClientError("INDEX_STALE");
  }
  private ownedPhoto(file: DriveFile, document: Inventory, itemId: string) {
    const p = file.appProperties;
    return (
      file.mimeType === "image/jpeg" &&
      !!file.version &&
      p?.bsmBoxId === document.box.id &&
      p.bsmItemId === itemId &&
      /^[0-9a-f-]{36}$/.test(p.bsmPhotoOperationId ?? "") &&
      file.name.startsWith(document.box.number + "-") &&
      new RegExp("-" + itemId + "-[0-9a-f-]{36}\\.jpg$").test(file.name)
    );
  }
  private async uploadImage(
    id: string,
    parent: string,
    name: string,
    blob: Blob,
    properties: Record<string, string>,
    description: string,
    signal?: AbortSignal,
    mimeType = "image/jpeg",
  ) {
    const boundary = "bsm_" + crypto.randomUUID();
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      JSON.stringify({
        id,
        name,
        parents: [parent],
        mimeType,
        appProperties: properties,
        description,
      }),
      `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--\r\n`,
    ]);
    const { data } = await this.auth.request<DriveFile>(
      `${UPLOAD}/v3/files?uploadType=multipart&fields=id,name,mimeType,version,parents,appProperties,description`,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (
      data.id !== id ||
      data.name !== name ||
      data.mimeType !== mimeType ||
      !data.parents?.includes(parent)
    )
      throw new ClientError("AMBIGUOUS_WRITE");
    const { data: download } = await this.auth.request<Blob>(
      `${V3}/${id}?alt=media`,
      { format: "blob", signal },
    );
    await this.verifyImageBytes(blob, download);
    return data;
  }
  private async verifyImageBytes(blob: Blob, download: Blob) {
    const bytes = (value: Blob) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(value);
      });
    const [source, stored] = await Promise.all([bytes(blob), bytes(download)]);
    const a = new Uint8Array(source),
      b = new Uint8Array(stored);
    if (a.length !== b.length || a.some((byte, index) => byte !== b[index]))
      throw new ClientError("READ_CONFLICT");
  }
  private async verifyStoredQr(
    id: string,
    parent: string,
    image: Blob,
    signal?: AbortSignal,
  ) {
    const before = await this.storage.withinRoot(id, signal);
    if (
      before.name !== DRIVE_FOLDER_QR_FILENAME ||
      before.mimeType !== "image/png" ||
      !before.parents?.includes(parent)
    )
      throw new ClientError("READ_CONFLICT");
    const { data: download } = await this.auth.request<Blob>(
      `${V3}/${id}?alt=media`,
      { format: "blob", signal },
    );
    const after = await this.storage.withinRoot(id, signal);
    if (
      !before.version ||
      before.version !== after.version ||
      before.name !== after.name ||
      before.mimeType !== after.mimeType ||
      !after.parents?.includes(parent)
    )
      throw new ClientError("READ_CONFLICT");
    await this.verifyImageBytes(image, download);
  }
  async edit(
    draft: Draft,
    signal?: AbortSignal,
    photo?: PhotoWork,
  ): Promise<PhotoWriteResult> {
    const document = structuredClone(draft.document);
    const result: PhotoWriteResult = {
      outcome: "blocked",
      phase: "preflight",
      steps: [],
      boxId: document.box.id,
      boxNumber: document.box.number,
      folderId: draft.folder?.id,
    };
    const task = this.task(signal);
    let locked = false,
      started = false;
    const confirmed = (phase: string, fileId: string) =>
      result.steps.push({ phase, status: "confirmed", fileId });
    const verify = async (id: string, expected: unknown) => {
      const actual = await this.storage.readJson(id, signal);
      task.check();
      if (!same(actual.document, expected))
        throw new ClientError("READ_CONFLICT");
      return actual;
    };
    const ownedRoot = async () => {
      task.check();
      const root = await this.metadata(task.root.id, signal);
      task.check();
      if (
        this.property(root, "bsmCreateOwner") !== draft.operationId ||
        this.property(root, "bsmIndexId") !== draft.index.file.id
      )
        throw new ClientError("DRIVE_CONFLICT");
      return root;
    };
    const unlock = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const root = await ownedRoot();
        try {
          await this.patch(
            root,
            { properties: this.properties(root, { bsmCreateOwner: null }) },
            signal,
          );
          task.check();
          const current = await this.metadata(root.id, signal);
          task.check();
          if (this.property(current, "bsmCreateOwner") === draft.operationId)
            throw new ClientError("READ_CONFLICT");
          locked = false;
          return;
        } catch (error) {
          if (code(error) !== "DRIVE_CONFLICT") throw error;
        }
      }
      throw new ClientError("DRIVE_CONFLICT");
    };
    try {
      if (
        draft.kind !== "edit" ||
        !draft.inventory ||
        !draft.folder ||
        draft.rootId !== task.root.id ||
        !validator.validate("inventory", document).valid ||
        !validator.validate("index", draft.index.document).valid
      )
        throw new ClientError("INVALID_INVENTORY");
      const original = draft.inventory.document as Inventory;
      if (
        document.box.id !== original.box.id ||
        document.box.number !== original.box.number ||
        document.box.created !== original.box.created ||
        !same(document.box.nfcIds, original.box.nfcIds)
      )
        throw new ClientError("IMMUTABLE_IDENTITY");
      for (const item of document.items) {
        const old = original.items.find((i) => i.id === item.id);
        if (!same(item.images ?? [], old?.images ?? []))
          throw new ClientError("INVALID_IMAGE");
      }
      const registered = await this.initialize(signal);
      task.check();
      if (
        registered.file.id !== draft.index.file.id ||
        registered.file.version !== draft.index.file.version
      )
        throw new ClientError("DRIVE_CONFLICT");
      const root = await this.metadata(task.root.id, signal);
      task.check();
      if (this.property(root, "bsmCreateOwner"))
        throw new ClientError("PENDING_CREATION");
      result.phase = "edit-lock";
      await this.patch(
        root,
        {
          properties: this.properties(root, {
            bsmCreateOwner: draft.operationId,
          }),
        },
        signal,
      );
      locked = true;
      task.check();
      result.phase = "preflight";
      const current = await this.index(draft.index.file.id, signal);
      task.check();
      if (current.file.version !== draft.index.file.version)
        throw new ClientError("DRIVE_CONFLICT");
      await this.inspect(root.id, current.document as BoxIndex, signal);
      task.check();
      // Drive can advance versions without changing JSON. Accept only an exact
      // source document, paired with a fresh coherent ETag; never rebase edits.
      const baseline = await this.storage.readJson(
        draft.inventory.file.id,
        signal,
      );
      task.check();
      if (!same(baseline.document, original))
        throw new ClientError("DRIVE_CONFLICT");
      const inventory = await this.metadata(draft.inventory.file.id, signal);
      const folder = await this.metadata(draft.folder.id, signal);
      task.check();
      if (
        inventory.name !== "inventory.json" ||
        !inventory.parents?.includes(folder.id) ||
        baseline.file.version !== inventory.version ||
        folder.name !== draft.folder.name ||
        folder.description !== draft.folder.description
      )
        throw new ClientError("DRIVE_CONFLICT");
      if (
        inventory.capabilities?.canEdit === false ||
        folder.capabilities?.canEdit === false ||
        current.file.capabilities?.canEdit === false
      )
        throw new ClientError("DRIVE_FORBIDDEN");
      const photoPlan: { id: string; name: string; blob: Blob }[] = [];
      const obsolete: DriveFile[] = [];
      if (photo) {
        const item = document.items.find((i) => i.id === photo.itemId);
        if (!item && photo.action.kind !== "cleanup")
          throw new ClientError("ITEM_NOT_FOUND");
        const files = await this.storage.listChildren(folder.id, signal);
        task.check();
        const references =
          photo.action.kind === "item"
            ? (item?.images ?? [])
            : ["replace", "remove"].includes(photo.action.kind)
              ? [(photo.action as { filename: string }).filename]
              : [];
        for (const name of references) {
          if (!item?.images?.includes(name))
            throw new ClientError("IMAGE_NOT_FOUND");
          const matches = files.filter((f) => f.name === name);
          if (matches.length > 1) throw new ClientError("DUPLICATE_FILE");
          if (matches[0]) obsolete.push(matches[0]);
        }
        if (photo.action.kind === "cleanup")
          obsolete.push(...(photo.candidates ?? []));
        if (photo.action.kind === "associate") {
          for (const candidate of photo.candidates ?? []) {
            const file = files.find((f) => f.id === candidate.id);
            if (
              !file ||
              files.filter((other) => other.name === file.name).length !== 1 ||
              file.version !== candidate.version ||
              file.name !== candidate.name ||
              !this.ownedPhoto(file, document, photo.itemId) ||
              document.items.some((i) => i.images?.includes(file.name))
            )
              throw new ClientError("DRIVE_CONFLICT");
            item!.images = [...(item!.images ?? []), file.name];
          }
        }
        const selections = photo.selections ?? [];
        if (
          selections.length > 20 ||
          (photo.action.kind === "add" && !selections.length) ||
          (photo.action.kind === "replace" && selections.length !== 1) ||
          (!["add", "replace"].includes(photo.action.kind) && selections.length)
        )
          throw new ClientError("PHOTO_SELECTION_REQUIRED");
        if (selections.length) {
          const generated = await this.ids(selections.length, signal);
          for (let i = 0; i < selections.length; i++) {
            const selection = selections[i]!;
            if (
              selection.blob.type !== "image/jpeg" ||
              selection.blob.size > 25 * 1024 * 1024 ||
              !selection.blob.size ||
              !selection.name.startsWith(document.box.number + "-") ||
              !selection.name.endsWith(
                "-" + photo.itemId + "-" + selection.id + ".jpg",
              ) ||
              !/^[0-9a-f-]{36}$/.test(selection.id) ||
              files.some((f) => f.name === selection.name)
            )
              throw new ClientError("INVALID_IMAGE");
            photoPlan.push({
              id: generated[i]!,
              name: selection.name,
              blob: selection.blob,
            });
          }
        }
        if (photo.action.kind === "add")
          item!.images = [
            ...(item!.images ?? []),
            ...photoPlan.map((f) => f.name),
          ];
        if (photo.action.kind === "replace" || photo.action.kind === "remove") {
          const name = photo.action.filename;
          item!.images = item!.images!.flatMap((n) =>
            n === name ? photoPlan.map((f) => f.name) : [n],
          );
        }
        if (photo.action.kind === "item")
          document.items = document.items.filter((i) => i.id !== photo.itemId);
        if (!validator.validate("inventory", document).valid)
          throw new ClientError("INVALID_INVENTORY");
        result.obsolete = obsolete;
      }
      const index = structuredClone(current.document) as BoxIndex;
      const entry = index.boxes.find((b) => b.boxId === document.box.id);
      if (
        !entry ||
        entry.driveFolderId !== folder.id ||
        entry.boxNumber !== document.box.number
      )
        throw new ClientError("IDENTITY_MISMATCH");
      entry.name = document.box.name;
      if (document.box.location === undefined) delete entry.location;
      else entry.location = document.box.location;
      document.box.modified = new Date().toISOString();
      index.updated = document.box.modified;
      if (!validator.validate("index", index).valid)
        throw new ClientError("INVALID_INDEX");
      const indexMetadata = await this.metadata(current.file.id, signal);
      task.check();
      if (indexMetadata.version !== current.file.version)
        throw new ClientError("DRIVE_CONFLICT");
      const markerId = (await this.ids(1, signal))[0]!;
      await ownedRoot();
      const marker = {
        formatVersion: 1,
        protocol: CREATION_PROTOCOL,
        operationId: draft.operationId,
        boxId: document.box.id,
        boxNumber: document.box.number,
        folderId: folder.id,
        indexId: current.file.id,
        inventoryId: inventory.id,
        inventoryVersion: inventory.version,
        indexVersion: current.file.version,
        intendedInventory: document,
        intendedIndex: index,
        ...(photo
          ? {
              photoAction: photo.action,
              itemId: photo.itemId,
              uploads: photoPlan.map(({ id, name }) => ({ id, name })),
              obsolete,
            }
          : {}),
      };
      result.phase = "edit-marker";
      started = true;
      await this.createFile(
        markerId,
        folder.id,
        "box-storage-edit-pending.json",
        marker,
        signal,
      );
      task.check();
      confirmed(result.phase, markerId);
      for (const upload of photoPlan) {
        result.phase = "photo-upload";
        await ownedRoot();
        const file = await this.uploadImage(
          upload.id,
          folder.id,
          upload.name,
          upload.blob,
          {
            bsmPhotoOperationId: draft.operationId,
            bsmBoxId: document.box.id,
            bsmItemId: photo!.itemId,
          },
          photoDescription(original, photo!.itemId),
          signal,
        );
        task.check();
        result.uploaded = [...(result.uploaded ?? []), file];
        confirmed(result.phase, file.id);
      }
      for (const [phase, file, expected] of [
        ["inventory", inventory, document],
        ["index", indexMetadata, index],
      ] as const) {
        result.phase = phase;
        await ownedRoot();
        await this.auth.request(
          `${UPLOAD}/v2/files/${file.id}?uploadType=media&fields=id`,
          {
            method: "PUT",
            signal,
            headers: {
              "Content-Type": "application/json",
              "If-Match": file.etag,
            },
            body: JSON.stringify(expected, null, 2),
          },
        );
        task.check();
        await verify(file.id, expected);
        confirmed(phase, file.id);
      }
      result.phase = "folder";
      await ownedRoot();
      const currentFolder = await this.metadata(folder.id, signal);
      task.check();
      if (
        currentFolder.name !== folder.name ||
        currentFolder.description !== folder.description
      )
        throw new ClientError("DRIVE_CONFLICT");
      await this.patch(
        currentFolder,
        { title: folderName(document), description: boxDescription(document) },
        signal,
      );
      task.check();
      confirmed(result.phase, folder.id);
      result.phase = "final-verification";
      const finalFolder = await this.metadata(folder.id, signal);
      const children = await this.storage.listChildren(folder.id, signal);
      task.check();
      if (
        finalFolder.name !== folderName(document) ||
        finalFolder.description !== boxDescription(document) ||
        children.filter((f) => f.name === "inventory.json").length !== 1 ||
        !children.some(
          (f) => f.id === inventory.id && f.name === "inventory.json",
        )
      )
        throw new ClientError("READ_CONFLICT");
      await verify(inventory.id, document);
      await verify(current.file.id, index);
      if (photo?.action.kind === "cleanup") {
        result.phase = "photo-cleanup";
        for (const candidate of obsolete) {
          await ownedRoot();
          const actual = await this.storage.readJson(inventory.id, signal);
          task.check();
          if (!same(actual.document, document))
            throw new ClientError("DRIVE_CONFLICT");
          const files = await this.storage.listChildren(folder.id, signal);
          task.check();
          const matches = files.filter((f) => f.name === candidate.name);
          if (!matches.length) continue;
          const file = matches[0]!;
          if (
            matches.length !== 1 ||
            file.id !== candidate.id ||
            file.version !== candidate.version ||
            file.capabilities?.canTrash === false ||
            file.capabilities?.canEdit === false ||
            !this.ownedPhoto(file, document, photo.itemId) ||
            document.items.some((i) => i.images?.includes(file.name))
          ) {
            result.retained = [...(result.retained ?? []), candidate.name];
            continue;
          }
          const metadata = await this.metadata(file.id, signal);
          task.check();
          if (
            metadata.version !== file.version ||
            metadata.name !== file.name ||
            !metadata.parents?.includes(folder.id)
          )
            throw new ClientError("DRIVE_CONFLICT");
          await this.patch(metadata, { labels: { trashed: true } }, signal);
          task.check();
          if (
            (await this.storage.listChildren(folder.id, signal)).some(
              (f) => f.id === file.id,
            )
          )
            throw new ClientError("READ_CONFLICT");
          confirmed(result.phase, file.id);
        }
      }
      result.phase = "marker-cleanup";
      await ownedRoot();
      const markerSnapshot = await verify(markerId, marker);
      const markerMetadata = await this.metadata(markerId, signal);
      task.check();
      if (
        markerMetadata.version !== markerSnapshot.file.version ||
        markerMetadata.name !== "box-storage-edit-pending.json"
      )
        throw new ClientError("DRIVE_CONFLICT");
      await this.patch(markerMetadata, { labels: { trashed: true } }, signal);
      task.check();
      if (
        (await this.storage.listChildren(folder.id, signal)).some(
          (f) => f.id === markerId,
        )
      )
        throw new ClientError("READ_CONFLICT");
      confirmed(result.phase, markerId);
      result.phase = "lock-release";
      await unlock();
      confirmed(result.phase, root.id);
      result.outcome = "complete";
      result.phase = "verified";
    } catch (error) {
      result.code = code(error);
      const uncertain =
        [
          "AMBIGUOUS_WRITE",
          "CONTEXT_CHANGED",
          "NETWORK_FAILED",
          "AUTH_REQUIRED",
          "UNAVAILABLE",
        ].includes(result.code) && result.phase !== "preflight";
      if (uncertain)
        result.steps.push({ phase: result.phase, status: "uncertain" });
      result.outcome = uncertain
        ? "ambiguous"
        : started
          ? "partial"
          : result.code === "DRIVE_CONFLICT"
            ? "conflict"
            : "blocked";
      if (locked && !started) {
        try {
          await unlock();
        } catch {
          result.outcome = "ambiguous";
          result.steps.push({
            phase: "lock-release",
            status: "uncertain",
            fileId: task.root.id,
          });
        }
      }
    }
    return result;
  }
  async create(
    document: Inventory,
    source: JsonSnapshot,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<OperationResult> {
    const result: OperationResult = {
      outcome: "blocked",
      phase: "preflight",
      steps: [],
      boxId: document.box.id,
      boxNumber: document.box.number,
    };
    const task = this.task(signal);
    let locked = false,
      started = false;
    const confirmed = (phase: string, fileId?: string) =>
      result.steps.push({ phase, status: "confirmed", fileId });
    const verify = async (id: string, expected: unknown) => {
      const actual = await this.storage.readJson(id, signal);
      task.check();
      if (!same(actual.document, expected))
        throw new ClientError("READ_CONFLICT");
      return actual;
    };
    const ownedRoot = async () => {
      task.check();
      const root = await this.metadata(task.root.id, signal);
      task.check();
      if (
        this.property(root, "bsmCreateOwner") !== operationId ||
        this.property(root, "bsmIndexId") !== source.file.id
      )
        throw new ClientError("DRIVE_CONFLICT");
      return root;
    };
    const unlock = async () => {
      for (let i = 0; i < 3; i++) {
        const root = await ownedRoot();
        try {
          const released = await this.patch(
            root,
            { properties: this.properties(root, { bsmCreateOwner: null }) },
            signal,
          );
          task.check();
          if (this.property(released, "bsmCreateOwner") === operationId)
            throw new ClientError("READ_CONFLICT");
          const current = await this.metadata(task.root.id, signal);
          task.check();
          if (this.property(current, "bsmCreateOwner") === operationId)
            throw new ClientError("READ_CONFLICT");
          locked = false;
          return;
        } catch (error) {
          if (code(error) !== "DRIVE_CONFLICT") throw error;
        }
      }
      throw new ClientError("DRIVE_CONFLICT");
    };
    try {
      if (document.items.some((item) => item.images?.length))
        throw new ClientError("INVALID_IMAGE");
      if (
        !validator.validate("inventory", document).valid ||
        !validator.validate("index", source.document).valid ||
        !/^[0-9a-f-]{36}$/.test(operationId)
      )
        throw new ClientError("INVALID_INVENTORY");
      const registered = await this.initialize(signal);
      task.check();
      if (registered.file.capabilities?.canEdit === false)
        throw new ClientError("DRIVE_FORBIDDEN");
      if (
        registered.file.id !== source.file.id ||
        registered.file.version !== source.file.version
      )
        throw new ClientError("DRIVE_CONFLICT");
      const root = await this.metadata(task.root.id, signal);
      task.check();
      if (this.property(root, "bsmCreateOwner"))
        throw new ClientError("PENDING_CREATION");
      if (root.capabilities?.canAddChildren === false)
        throw new ClientError("DRIVE_FORBIDDEN");
      result.phase = "creation-lock";
      await this.patch(
        root,
        { properties: this.properties(root, { bsmCreateOwner: operationId }) },
        signal,
      );
      task.check();
      locked = true;
      const current = await this.index(source.file.id, signal);
      task.check();
      if (current.file.version !== source.file.version)
        throw new ClientError("DRIVE_CONFLICT");
      const index = structuredClone(current.document) as BoxIndex;
      await this.inspect(root.id, index, signal);
      task.check();
      const next =
        Math.max(0, ...index.boxes.map((b) => Number(b.boxNumber.slice(4)))) +
        1;
      if (next > 999999999) throw new ClientError("NUMBER_EXHAUSTED");
      if (
        document.box.number !== `BOX-${String(next).padStart(4, "0")}` ||
        index.boxes.some((b) => b.boxId === document.box.id)
      )
        throw new ClientError("DRIVE_CONFLICT");
      const generatedIds = await this.ids(4, signal);
      const folderId = generatedIds[0]!,
        markerId = generatedIds[1]!,
        inventoryId = generatedIds[2]!,
        qrFileId = generatedIds[3]!;
      task.check();
      result.folderId = folderId;
      result.phase = "generate-folder-qr";
      const qrImage = await this.generateFolderQr(folderId, signal);
      task.check();
      if (
        qrImage.type !== "image/png" ||
        qrImage.size < 8 ||
        qrImage.size > 1024 * 1024
      )
        throw new ClientError("INVALID_IMAGE");
      const signature = await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = reject;
        reader.readAsArrayBuffer(qrImage.slice(0, 8));
      });
      task.check();
      if (
        [137, 80, 78, 71, 13, 10, 26, 10].some(
          (byte, i) => signature[i] !== byte,
        )
      )
        throw new ClientError("INVALID_IMAGE");
      document = structuredClone(document);
      document.box.modified = new Date().toISOString();
      await ownedRoot();
      result.phase = "pending-folder";
      started = true;
      await this.createFile(
        folderId,
        root.id,
        `.box-storage-pending-${operationId}`,
        undefined,
        signal,
      );
      task.check();
      confirmed(result.phase, folderId);
      result.phase = "pending-marker";
      await ownedRoot();
      const markerDocument = {
        formatVersion: 1,
        operationId,
        boxId: document.box.id,
        boxNumber: document.box.number,
        folderId,
        indexId: source.file.id,
        inventoryId,
        qrFileId,
        qrFilename: DRIVE_FOLDER_QR_FILENAME,
        qrUrl: `https://drive.google.com/drive/folders/${folderId}`,
        protocol: CREATION_PROTOCOL,
      };
      await this.createFile(
        markerId,
        folderId,
        "box-storage-pending.json",
        markerDocument,
        signal,
      );
      task.check();
      confirmed(result.phase, markerId);
      result.phase = "draft-inventory";
      await ownedRoot();
      await this.createFile(
        inventoryId,
        folderId,
        "inventory.pending.json",
        document,
        signal,
      );
      task.check();
      await verify(inventoryId, document);
      confirmed(result.phase, inventoryId);
      result.phase = "drive-folder-qr";
      await ownedRoot();
      await this.uploadImage(
        qrFileId,
        folderId,
        DRIVE_FOLDER_QR_FILENAME,
        qrImage,
        { bsmBoxId: document.box.id, bsmFolderQrOperationId: operationId },
        `QR code for https://drive.google.com/drive/folders/${folderId}`,
        signal,
        "image/png",
      );
      task.check();
      confirmed(result.phase, qrFileId);
      const entry: BoxIndex["boxes"][number] = {
        boxId: document.box.id,
        boxNumber: document.box.number,
        name: document.box.name,
        driveFolderId: folderId,
        nfcIds: [...document.box.nfcIds],
      };
      if (document.box.location !== undefined)
        entry.location = document.box.location;
      index.boxes.push(entry);
      index.updated = new Date().toISOString();
      if (!validator.validate("index", index).valid)
        throw new ClientError("INVALID_INDEX");
      result.phase = "number-claim";
      await ownedRoot();
      const baseline = await this.metadata(source.file.id, signal);
      task.check();
      if (baseline.version !== source.file.version)
        throw new ClientError("DRIVE_CONFLICT");
      await this.auth.request(
        `${UPLOAD}/v2/files/${source.file.id}?uploadType=media&fields=id`,
        {
          method: "PUT",
          signal,
          headers: {
            "Content-Type": "application/json",
            "If-Match": baseline.etag,
          },
          body: JSON.stringify(index, null, 2),
        },
      );
      task.check();
      await verify(source.file.id, index);
      confirmed(result.phase, source.file.id);
      result.phase = "publish-inventory";
      await ownedRoot();
      const files = await this.storage.listChildren(folderId, signal);
      task.check();
      if (files.some((f) => f.name === "inventory.json"))
        throw new ClientError("DUPLICATE_INVENTORY");
      // Drive can advance a newly uploaded file's metadata version while processing it.
      // Refresh the exact intended JSON, then fence publication with that coherent version.
      const pendingSnapshot = await verify(inventoryId, document);
      const pendingMetadata = await this.metadata(inventoryId, signal);
      task.check();
      if (
        pendingMetadata.version !== pendingSnapshot.file.version ||
        pendingMetadata.name !== "inventory.pending.json"
      )
        throw new ClientError("DRIVE_CONFLICT");
      await this.patch(pendingMetadata, { title: "inventory.json" }, signal);
      task.check();
      await verify(inventoryId, document);
      confirmed(result.phase, inventoryId);
      result.phase = "folder";
      await ownedRoot();
      const pendingFolder = await this.metadata(folderId, signal);
      task.check();
      if (
        pendingFolder.name !== `.box-storage-pending-${operationId}` ||
        pendingFolder.description
      )
        throw new ClientError("DRIVE_CONFLICT");
      await this.patch(
        pendingFolder,
        { title: folderName(document), description: boxDescription(document) },
        signal,
      );
      task.check();
      confirmed(result.phase, folderId);
      result.phase = "verify-folder-qr";
      await ownedRoot();
      await this.verifyStoredQr(qrFileId, folderId, qrImage, signal);
      task.check();
      confirmed(result.phase, qrFileId);
      result.phase = "marker-cleanup";
      await ownedRoot();
      const markerSnapshot = await verify(markerId, markerDocument);
      const currentMarker = await this.metadata(markerId, signal);
      task.check();
      if (
        currentMarker.version !== markerSnapshot.file.version ||
        currentMarker.name !== "box-storage-pending.json"
      )
        throw new ClientError("DRIVE_CONFLICT");
      await this.patch(currentMarker, { labels: { trashed: true } }, signal);
      task.check();
      confirmed(result.phase, markerId);
      result.phase = "final-verification";
      const finalFolder = await this.storage.withinRoot(folderId, signal);
      const finalFiles = await this.storage.listChildren(folderId, signal);
      task.check();
      if (
        finalFolder.name !== folderName(document) ||
        finalFolder.description !== boxDescription(document) ||
        finalFiles.filter((f) => f.name === "inventory.json").length !== 1 ||
        finalFiles.filter((f) => f.name === DRIVE_FOLDER_QR_FILENAME).length !==
          1 ||
        !finalFiles.some(
          (f) =>
            f.id === qrFileId &&
            f.name === DRIVE_FOLDER_QR_FILENAME &&
            f.mimeType === "image/png",
        ) ||
        finalFiles.some((f) =>
          ["inventory.pending.json", "box-storage-pending.json"].includes(
            f.name,
          ),
        )
      )
        throw new ClientError("READ_CONFLICT");
      await verify(source.file.id, index);
      await verify(inventoryId, document);
      await this.verifyStoredQr(qrFileId, folderId, qrImage, signal);
      task.check();
      result.phase = "lock-release";
      await unlock();
      confirmed(result.phase, root.id);
      result.outcome = "complete";
      result.phase = "verified";
    } catch (error) {
      result.code = code(error);
      const uncertain =
        [
          "AMBIGUOUS_WRITE",
          "CONTEXT_CHANGED",
          "NETWORK_FAILED",
          "AUTH_REQUIRED",
          "UNAVAILABLE",
        ].includes(result.code) && result.phase !== "preflight";
      if (uncertain)
        result.steps.push({ phase: result.phase, status: "uncertain" });
      result.outcome = uncertain
        ? "ambiguous"
        : started
          ? "partial"
          : result.code === "DRIVE_CONFLICT"
            ? "conflict"
            : "blocked";
      if (locked && !started) {
        try {
          await unlock();
        } catch {
          result.steps.push({
            phase: "lock-release",
            status: "uncertain",
            fileId: task.root.id,
          });
          result.outcome = "ambiguous";
        }
      }
      // Never steal/expire an interrupted creation lock. Review retained marker and draft.
    }
    return result;
  }
}
