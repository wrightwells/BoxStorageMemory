import type { BoxView } from "./library";
import type { Draft } from "./editing";
import { ClientError } from "./errors";
import { GoogleAuthService } from "./google";
import { CoordinatedCreation, type PhotoWork } from "./creation";
import type { Inventory } from "../../../shared/typescript/models";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_TYPE = "application/vnd.google-apps.folder";
const FIELDS =
  "id,name,description,mimeType,version,parents,trashed,appProperties,capabilities(canEdit,canAddChildren,canTrash)";
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  description?: string;
  version?: string;
  parents?: string[];
  trashed?: boolean;
  appProperties?: Record<string, string>;
  capabilities?: {
    canEdit?: boolean;
    canAddChildren?: boolean;
    canTrash?: boolean;
  };
}
export interface DriveAccount {
  id: string;
  name: string;
  email: string;
}
export interface JsonSnapshot {
  file: DriveFile;
  document: unknown;
  etag: string | null;
}

export function checkedId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(id))
    throw new ClientError("INVALID_DRIVE_ID");
  return id;
}
function checkedFile(file: DriveFile): DriveFile {
  if (
    !file ||
    typeof file.id !== "string" ||
    typeof file.name !== "string" ||
    typeof file.mimeType !== "string" ||
    (file.parents !== undefined &&
      (!Array.isArray(file.parents) ||
        !file.parents.every((p) => typeof p === "string")))
  ) {
    throw new ClientError("INVALID_DRIVE_DATA");
  }
  checkedId(file.id);
  return file;
}
function queryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export class DriveStorageService {
  #root: DriveFile | undefined;
  #urls = new Set<string>();
  constructor(private readonly auth: GoogleAuthService) {}
  assertCreationAvailable(): void {
    if (!this.#root) throw new ClientError("ROOT_REQUIRED");
    if (this.#root.capabilities?.canAddChildren === false)
      throw new ClientError("DRIVE_FORBIDDEN");
  }
  initializeLibrary(signal?: AbortSignal): Promise<JsonSnapshot> {
    this.assertCreationAvailable();
    return new CoordinatedCreation(this.auth, this).initialize(signal);
  }
  createBox(
    document: Inventory,
    source: JsonSnapshot,
    operationId: string,
    signal?: AbortSignal,
  ) {
    this.assertCreationAvailable();
    return new CoordinatedCreation(this.auth, this).create(
      document,
      source,
      operationId,
      signal,
    );
  }
  assertEditingAvailable(): void {
    if (!this.#root) throw new ClientError("ROOT_REQUIRED");
    if (this.#root.capabilities?.canEdit === false)
      throw new ClientError("DRIVE_FORBIDDEN");
  }
  editBox(draft: Draft, signal?: AbortSignal) {
    this.assertEditingAvailable();
    return new CoordinatedCreation(this.auth, this).edit(draft, signal);
  }
  assertPhotoWritesAvailable(): void {
    this.assertEditingAvailable();
  }
  async managePhotos(
    view: BoxView,
    work: PhotoWork,
    operationId: string,
    signal?: AbortSignal,
  ) {
    this.assertPhotoWritesAvailable();
    const root = this.root!;
    const indexes = (await this.listChildren(root.id, signal)).filter(
      (f) => f.name === "box-storage-index.json",
    );
    if (indexes.length !== 1)
      throw new ClientError(
        indexes.length ? "DUPLICATE_INDEX" : "INDEX_MISSING",
      );
    const index = await this.readJson(indexes[0]!.id, signal);
    const draft: Draft = {
      kind: "edit",
      document: structuredClone(view.inventory),
      original: structuredClone(view.inventory),
      inventory: view.snapshot,
      folder: view.folder,
      index,
      rootId: root.id,
      readOnly: false,
      operationId,
    };
    return new CoordinatedCreation(this.auth, this).edit(draft, signal, work);
  }
  get root(): DriveFile | undefined {
    return this.#root;
  }
  clear() {
    this.#root = undefined;
    for (const url of this.#urls) URL.revokeObjectURL(url);
    this.#urls.clear();
  }
  releaseImage(url: string) {
    if (this.#urls.delete(url)) URL.revokeObjectURL(url);
  }
  private current(): number {
    const generation = this.auth.generation;
    this.auth.assertCurrent(generation);
    return generation;
  }
  async account(): Promise<DriveAccount> {
    const { data } = await this.auth.request<{
      user: {
        permissionId: string;
        displayName?: string;
        emailAddress?: string;
      };
    }>(`${API}/about?fields=user(permissionId,displayName,emailAddress)`);
    if (
      !data.user ||
      typeof data.user.permissionId !== "string" ||
      !data.user.permissionId
    )
      throw new ClientError("INVALID_DRIVE_DATA");
    return {
      id: data.user.permissionId,
      name: data.user.displayName ?? "Google account",
      email: data.user.emailAddress ?? "",
    };
  }
  async metadata(id: string, signal?: AbortSignal): Promise<DriveFile> {
    const { data } = await this.auth.request<DriveFile>(
      `${API}/files/${checkedId(id)}?${new URLSearchParams({ fields: FIELDS, supportsAllDrives: "true" })}`,
      { signal },
    );
    return checkedFile(data);
  }
  async selectRoot(id: string): Promise<DriveFile> {
    this.clear();
    const generation = this.current();
    const file = await this.metadata(id);
    this.auth.assertCurrent(generation);
    if (file.mimeType !== FOLDER_TYPE || file.trashed)
      throw new ClientError("ROOT_NOT_FOLDER");
    this.#root = file;
    return file;
  }

  // Browsing to choose a root is intentionally account-wide; inventory operations below are root-bound.
  async browseFolders(
    parent = "root",
    signal?: AbortSignal,
  ): Promise<DriveFile[]> {
    return this.list(
      `'${checkedId(parent)}' in parents and mimeType = '${FOLDER_TYPE}' and trashed = false`,
      signal,
    );
  }
  private async list(q: string, signal?: AbortSignal): Promise<DriveFile[]> {
    const generation = this.current();
    const files: DriveFile[] = [];
    const tokens = new Set<string>();
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q,
        fields: `nextPageToken,incompleteSearch,files(${FIELDS})`,
        pageSize: "100",
        spaces: "drive",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const { data } = await this.auth.request<{
        files: DriveFile[];
        nextPageToken?: string;
        incompleteSearch?: boolean;
      }>(`${API}/files?${params}`, { signal });
      this.auth.assertCurrent(generation);
      if (!Array.isArray(data.files) || data.incompleteSearch)
        throw new ClientError("INVALID_DRIVE_DATA");
      files.push(...data.files.map(checkedFile));
      pageToken = data.nextPageToken;
      if (pageToken && (typeof pageToken !== "string" || tokens.has(pageToken)))
        throw new ClientError("INVALID_DRIVE_DATA");
      if (pageToken) tokens.add(pageToken);
    } while (pageToken);
    return files;
  }
  // Always re-check ancestry. Drive moves/shortcuts must not broaden the selected library.
  async withinRoot(id: string, signal?: AbortSignal): Promise<DriveFile> {
    checkedId(id);
    const generation = this.current();
    const root = this.#root;
    if (!root) throw new ClientError("ROOT_REQUIRED");
    const original = await this.metadata(id, signal);
    const pending = [original];
    const seen = new Set<string>();
    while (pending.length && seen.size < 100) {
      const file = pending.shift()!;
      this.auth.assertCurrent(generation);
      if (file.trashed) throw new ClientError("DRIVE_NOT_FOUND");
      if (file.id === root.id) return original;
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      for (const parent of file.parents ?? []) {
        if (!seen.has(parent))
          pending.push(await this.metadata(parent, signal));
      }
    }
    throw new ClientError("OUTSIDE_ROOT");
  }
  async listChildren(id: string, signal?: AbortSignal): Promise<DriveFile[]> {
    const folder = await this.withinRoot(id, signal);
    if (folder.mimeType !== FOLDER_TYPE)
      throw new ClientError("ROOT_NOT_FOLDER");
    return this.list(
      `'${checkedId(id)}' in parents and trashed = false`,
      signal,
    );
  }
  async findFile(
    parent: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<DriveFile | undefined> {
    const folder = await this.withinRoot(parent, signal);
    if (folder.mimeType !== FOLDER_TYPE)
      throw new ClientError("ROOT_NOT_FOLDER");
    const files = await this.list(
      `'${checkedId(parent)}' in parents and name = '${queryValue(name)}' and trashed = false`,
      signal,
    );
    if (files.length > 1) throw new ClientError("DUPLICATE_FILE");
    return files[0];
  }
  async readJson(id: string, signal?: AbortSignal): Promise<JsonSnapshot> {
    const generation = this.current();
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await this.withinRoot(id, signal);
      if (
        before.mimeType === FOLDER_TYPE ||
        before.mimeType === "application/vnd.google-apps.shortcut"
      )
        throw new ClientError("INVALID_JSON");
      const { data, etag } = await this.auth
        .request<unknown>(
          `${API}/files/${checkedId(id)}?alt=media&supportsAllDrives=true`,
          { signal },
        )
        .catch((error) => {
          if (
            error instanceof ClientError &&
            error.code === "INVALID_DRIVE_DATA"
          )
            throw new ClientError("INVALID_JSON");
          throw error;
        });
      const after = await this.withinRoot(id, signal);
      this.auth.assertCurrent(generation);
      if (!before.version || !after.version)
        throw new ClientError("INVALID_DRIVE_DATA");
      if (before.version === after.version)
        return { file: after, document: data, etag };
    }
    throw new ClientError("READ_CONFLICT");
  }
  async image(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; file: DriveFile }> {
    const generation = this.current();
    const file = await this.withinRoot(id, signal);
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
    ]);
    if (!allowed.has(file.mimeType)) throw new ClientError("INVALID_IMAGE");
    const { data } = await this.auth.request<Blob>(
      `${API}/files/${checkedId(id)}?alt=media&supportsAllDrives=true`,
      { format: "blob", signal },
    );
    this.auth.assertCurrent(generation);
    if (!allowed.has(data.type)) throw new ClientError("INVALID_IMAGE");
    const url = URL.createObjectURL(data);
    this.#urls.add(url);
    return { url, file };
  }
  // Empty root creation has no inventory/index allocation. A failed result is never blindly retried.
  async createRoot(name: string): Promise<DriveFile> {
    if (!name.trim() || name.length > 200)
      throw new ClientError("INVALID_FOLDER_NAME");
    const { data } = await this.auth.request<DriveFile>(
      `${API}/files?${new URLSearchParams({ fields: FIELDS })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), mimeType: FOLDER_TYPE }),
      },
    );
    try {
      const root = checkedFile(data);
      if (root.mimeType !== FOLDER_TYPE)
        throw new ClientError("INVALID_DRIVE_DATA");
      return root;
    } catch {
      throw new ClientError("AMBIGUOUS_WRITE");
    }
  }

  // Existing-box edits, photo/NFC mutations and recovery publication remain gated.
  // no environment flag or caller-supplied boolean that can bypass this gate.
  private requireVerifiedWrites(): void {
    throw new ClientError("WRITE_GATE_CLOSED");
  }
  assertWritesAvailable(): void {
    this.requireVerifiedWrites();
  }
  async createPendingFolder(
    parent: string,
    operationId: string,
  ): Promise<DriveFile> {
    this.requireVerifiedWrites();
    await this.withinRoot(parent);
    const { data } = await this.auth.request<DriveFile>(
      `${API}/files?${new URLSearchParams({ fields: FIELDS })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `.box-storage-pending-${operationId}`,
          mimeType: FOLDER_TYPE,
          parents: [checkedId(parent)],
          appProperties: { bsmOperationId: operationId },
        }),
      },
    );
    return checkedFile(data);
  }
  // Metadata publication/rename needs its own verified conditional primitive.
  // Do not substitute a version precheck followed by an unconditional PATCH.
  async renameFile(
    file: DriveFile,
    name: string,
    description?: string,
  ): Promise<DriveFile> {
    this.requireVerifiedWrites();
    void file;
    void name;
    void description;
    throw new ClientError("ATOMIC_WRITE_UNVERIFIED");
  }
  async writeJson(
    snapshot: JsonSnapshot,
    document: unknown,
  ): Promise<DriveFile> {
    this.requireVerifiedWrites();
    // Live v3 probes accepted stale If-Match. Never revive that transport.
    void snapshot;
    void document;
    throw new ClientError("ATOMIC_WRITE_UNVERIFIED");
  }

  async createJson(
    parent: string,
    name: string,
    document: unknown,
  ): Promise<DriveFile> {
    this.requireVerifiedWrites();
    return this.upload(
      parent,
      name,
      new Blob([JSON.stringify(document, null, 2)], {
        type: "application/json",
      }),
    );
  }
  async uploadImage(
    parent: string,
    name: string,
    image: Blob,
    appProperties?: Record<string, string>,
    description?: string,
  ): Promise<DriveFile> {
    this.requireVerifiedWrites();
    if (image.type !== "image/jpeg") throw new ClientError("INVALID_IMAGE");
    return this.upload(parent, name, image, appProperties, description);
  }
  private async upload(
    parent: string,
    name: string,
    content: Blob,
    appProperties?: Record<string, string>,
    description?: string,
  ): Promise<DriveFile> {
    await this.withinRoot(parent);
    const boundary = `box_storage_${crypto.randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify({
        name,
        parents: [checkedId(parent)],
        mimeType: content.type,
        ...(appProperties ? { appProperties } : {}),
        ...(description ? { description } : {}),
      }),
      `\r\n--${boundary}\r\nContent-Type: ${content.type}\r\n\r\n`,
      content,
      `\r\n--${boundary}--\r\n`,
    ]);
    const { data } = await this.auth.request<DriveFile>(
      `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    return checkedFile(data);
  }
  async trash(id: string): Promise<DriveFile> {
    this.requireVerifiedWrites();
    await this.withinRoot(id);
    const { data } = await this.auth.request<DriveFile>(
      `${API}/files/${checkedId(id)}?fields=${FIELDS}&supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
    );
    return checkedFile(data);
  }
}
