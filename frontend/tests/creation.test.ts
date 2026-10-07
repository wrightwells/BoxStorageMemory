import { describe, expect, it, vi } from "vitest";
import {
  CoordinatedCreation,
  CREATION_PROTOCOL,
  DRIVE_FOLDER_QR_FILENAME,
} from "../src/services/creation";
import { ClientError } from "../src/services/errors";
import type { DriveFile } from "../src/services/drive";
import type { GoogleAuthService } from "../src/services/google";
import type { Inventory } from "../../shared/typescript/models";

const FOLDER = "application/vnd.google-apps.folder";
const timestamp = "2026-10-04T12:00:00Z";
const draft = (number = "BOX-0001"): Inventory => ({
  schemaVersion: 1,
  box: {
    id: crypto.randomUUID(),
    number,
    name: "Garage tools",
    location: "Garage Boxes",
    description: "Synthetic test",
    nfcIds: [],
    created: timestamp,
    modified: timestamp,
    extension: { keep: true },
  },
  items: [
    {
      id: crypto.randomUUID(),
      name: "Socket",
      quantity: 2,
      notes: "10 mm",
      extension: { keep: true },
    },
  ],
});
const blobText = (body: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(body);
  });
const blobBytes = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
function fixture() {
  const qrImage = new Blob(
    [
      Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        ),
        (c) => c.charCodeAt(0),
      ),
    ],
    { type: "image/png" },
  );
  const generateQr = vi.fn(async () => qrImage);
  const files = new Map<string, DriveFile>([
    [
      "root",
      {
        id: "root",
        name: "Garage Boxes",
        mimeType: FOLDER,
        version: "1",
        parents: [],
        capabilities: { canEdit: true, canAddChildren: true },
      },
    ],
  ]);
  const documents = new Map<string, unknown>();
  const binaries = new Map<string, Blob>();
  const properties = new Map<
    string,
    { key: string; value: string; visibility: string }[]
  >([
    [
      "root",
      [
        { key: "external", value: "keep", visibility: "PUBLIC" },
        { key: "external", value: "private", visibility: "PRIVATE" },
      ],
    ],
  ]);
  let serial = 0;
  const events: {
    path: string;
    method: string;
    condition: string | null;
    id?: string;
    body?: Record<string, unknown>;
  }[] = [];
  let hook:
    ((event: (typeof events)[number]) => void | Promise<void>) | undefined;
  const version = (id: string) => files.get(id)!.version!;
  const bump = (id: string) => {
    const file = files.get(id)!;
    file.version = String(Number(file.version) + 1);
  };
  const raw = (id: string) => {
    const file = files.get(id)!;
    return {
      id,
      title: file.name,
      mimeType: file.mimeType,
      description: file.description,
      version: file.version,
      etag: `"${id}-${file.version}"`,
      parents: file.parents?.map((id) => ({ id })),
      labels: { trashed: !!file.trashed },
      properties: properties.get(id) ?? [],
      capabilities: file.capabilities,
    };
  };
  const storage = {
    root: files.get("root"),
    async withinRoot(id: string) {
      const file = files.get(id);
      if (!file || file.trashed) throw new ClientError("DRIVE_NOT_FOUND");
      let current = file;
      while (current.id !== "root") {
        if (!current.parents?.length || !files.has(current.parents[0]!))
          throw new ClientError("OUTSIDE_ROOT");
        current = files.get(current.parents[0]!)!;
      }
      return structuredClone(file);
    },
    async listChildren(id: string) {
      await this.withinRoot(id);
      return [...files.values()]
        .filter((f) => !f.trashed && f.parents?.includes(id))
        .map((f) => structuredClone(f));
    },
    async readJson(id: string) {
      const file = await this.withinRoot(id);
      return { file, document: structuredClone(documents.get(id)), etag: null };
    },
  };
  const client = () => {
    const auth = {
      generation: 1,
      assertCurrent(generation: number) {
        if (generation !== this.generation)
          throw new ClientError("CONTEXT_CHANGED");
      },
      async request<T>(
        url: string,
        options: Parameters<GoogleAuthService["request"]>[1] = {},
      ) {
        const target = new URL(url),
          method = options.method ?? "GET",
          id = target.pathname.split("/").pop()!;
        let body: Record<string, unknown> | undefined;
        if (typeof options.body === "string") body = JSON.parse(options.body);
        const event = {
          path: target.pathname,
          method,
          condition: new Headers(options.headers).get("If-Match"),
          id,
          body,
        };
        events.push(event);
        await hook?.(event);
        const result = (data: unknown) => ({
          data: structuredClone(data) as T,
          etag: null,
        });
        if (id === "generateIds")
          return result({
            ids: Array.from(
              { length: Number(target.searchParams.get("count")) },
              () => `generated_${++serial}`,
            ),
          });
        if (method === "GET") {
          if (!files.has(id) || files.get(id)!.trashed)
            throw new ClientError("DRIVE_NOT_FOUND");
          if (target.searchParams.get("alt") === "media" && binaries.has(id))
            return { data: binaries.get(id)! as T, etag: null };
          return result(raw(id));
        }
        if (method === "POST") {
          if (options.body instanceof Blob) {
            const parts = (await blobText(options.body)).split("\r\n\r\n");
            body = JSON.parse(parts[1]!.split("\r\n--")[0]!);
            if (files.has(body!.id as string))
              throw new ClientError("DRIVE_ALREADY_EXISTS");
            if (
              ["image/jpeg", "image/png"].includes(body!.mimeType as string)
            ) {
              const buffer = await blobBytes(options.body);
              const start = new TextEncoder().encode(
                parts.slice(0, 2).join("\r\n\r\n") + "\r\n\r\n",
              ).length;
              const boundary = new Headers(options.headers)
                .get("Content-Type")!
                .split("boundary=")[1]!;
              const end =
                buffer.byteLength -
                new TextEncoder().encode("\r\n--" + boundary + "--\r\n").length;
              binaries.set(
                body!.id as string,
                new Blob([buffer.slice(start, end)], {
                  type: body!.mimeType as string,
                }),
              );
            } else
              documents.set(
                body!.id as string,
                JSON.parse(parts[2]!.split("\r\n--")[0]!),
              );
          }
          if (!body || typeof body.id !== "string")
            throw Error("Missing reserved ID");
          if (files.has(body.id)) throw new ClientError("DRIVE_ALREADY_EXISTS");
          const file = { ...body, version: "1" } as unknown as DriveFile;
          files.set(body.id, file);
          properties.set(body.id, []);
          return result(file);
        }
        // Independent fake server enforces conditions, not the service under test.
        if (
          !target.pathname.includes("/v2/") ||
          event.condition !== `"${id}-${version(id)}"`
        )
          throw new ClientError("DRIVE_CONFLICT");
        if (method === "PUT") documents.set(id, body);
        else if (method === "PATCH") {
          const file = files.get(id)!;
          if (body?.properties) {
            const updated = [...(properties.get(id) ?? [])];
            for (const entry of body.properties as {
              key: string;
              value: string | null;
              visibility: string;
            }[]) {
              const position = updated.findIndex(
                (p) => p.key === entry.key && p.visibility === entry.visibility,
              );
              if (position >= 0) updated.splice(position, 1);
              if (entry.value !== null)
                updated.push({ ...entry, value: entry.value });
            }
            properties.set(id, updated);
          }
          if (typeof body?.title === "string") file.name = body.title;
          if (typeof body?.description === "string")
            file.description = body.description;
          if ((body?.labels as { trashed?: boolean } | undefined)?.trashed)
            file.trashed = true;
        } else throw Error("Unexpected mutation");
        bump(id);
        return result(raw(id));
      },
    };
    return {
      service: new CoordinatedCreation(auth, storage, generateQr),
      auth,
    };
  };
  return {
    files,
    documents,
    binaries,
    generateQr,
    qrImage,
    properties,
    events,
    storage,
    client,
    bump,
    setHook(value: typeof hook) {
      hook = value;
    },
  };
}

describe("verified Drive v2 creation protocol", () => {
  it("registers a generated index ID conditionally and initializes exactly one empty index, preserving other properties", async () => {
    const f = fixture(),
      c = f.client();
    const source = await c.service.initialize();
    expect(source.document).toMatchObject({ schemaVersion: 1, boxes: [] });
    expect(f.properties.get("root")).toEqual(
      expect.arrayContaining([
        { key: "external", value: "keep", visibility: "PUBLIC" },
        { key: "external", value: "private", visibility: "PRIVATE" },
        { key: "bsmIndexId", value: source.file.id, visibility: "PUBLIC" },
        {
          key: "bsmCreateProtocol",
          value: CREATION_PROTOCOL,
          visibility: "PUBLIC",
        },
      ]),
    );
    expect(f.events.find((e) => e.method === "PATCH")!.condition).toBe(
      '"root-1"',
    );
    expect((await c.service.initialize()).file.id).toBe(source.file.id);
    expect(
      [...f.files.values()].filter((f) => f.name === "box-storage-index.json"),
    ).toHaveLength(1);
  });
  it("coordinates racing initializers with root CAS and create-once IDs", async () => {
    const f = fixture();
    const [a, b] = await Promise.all([
      f.client().service.initialize(),
      f.client().service.initialize(),
    ]);
    expect(a.file.id).toBe(b.file.id);
    expect(
      [...f.files.values()].filter((f) => f.name === "box-storage-index.json"),
    ).toHaveLength(1);
  });
  it("refuses to initialize over existing files", async () => {
    const f = fixture();
    f.files.set("foreign", {
      id: "foreign",
      name: "notes.txt",
      mimeType: "text/plain",
      parents: ["root"],
      version: "1",
    });
    await expect(f.client().service.initialize()).rejects.toMatchObject({
      code: "LIBRARY_NOT_EMPTY",
    });
    expect(f.events.every((e) => e.method === "GET")).toBe(true);
  });
  it("refuses an invalid legacy index before registering any pointer", async () => {
    const f = fixture();
    f.files.set("bad", {
      id: "bad",
      name: "box-storage-index.json",
      mimeType: "application/json",
      parents: ["root"],
      version: "1",
    });
    f.documents.set("bad", {});
    await expect(f.client().service.initialize()).rejects.toMatchObject({
      code: "INVALID_INDEX",
    });
    expect(f.events.every((e) => e.method === "GET")).toBe(true);
  });
  it("fails before mutation if strong v2 metadata is unavailable", async () => {
    const f = fixture(),
      c = f.client();
    const request = c.auth.request.bind(c.auth);
    c.auth.request = async <T>(
      url: string,
      options?: Parameters<GoogleAuthService["request"]>[1],
    ) => {
      const result = await request<T>(url, options);
      if (url.includes("/v2/"))
        (result.data as { etag: string }).etag = 'W/"weak"';
      return result;
    };
    await expect(c.service.initialize()).rejects.toMatchObject({
      code: "ATOMIC_WRITE_UNVERIFIED",
    });
    expect(f.events.every((e) => e.method === "GET")).toBe(true);
  });
  it("creates and verifies a real-shaped inventory/index/folder sequence with extension fields intact", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize(),
      document = draft();
    const original = source.document as Record<string, unknown>;
    original.extension = { keep: true };
    f.documents.set(source.file.id, original);
    const result = await c.service.create(
      document,
      source,
      crypto.randomUUID(),
    );
    expect(result.outcome).toBe("complete");
    const folder = f.files.get(result.folderId!)!;
    expect(folder.name).toBe("BOX-0001 Garage tools");
    expect(f.generateQr).toHaveBeenCalledWith(folder.id, undefined);
    const qr = [...f.files.values()].find(
      (v) => v.name === DRIVE_FOLDER_QR_FILENAME,
    )!;
    expect(qr).toMatchObject({ mimeType: "image/png", parents: [folder.id] });
    expect(new Uint8Array(await blobBytes(f.binaries.get(qr.id)!))).toEqual(
      new Uint8Array(await blobBytes(f.qrImage)),
    );
    expect(
      result.steps.find((step) => step.phase === "drive-folder-qr")?.status,
    ).toBe("confirmed");
    const inventory = [...f.files.values()].find(
      (v) => v.name === "inventory.json",
    )!;
    expect(f.documents.get(inventory.id)).toMatchObject({
      box: {
        id: document.box.id,
        number: "BOX-0001",
        location: "Garage Boxes",
        extension: { keep: true },
      },
      items: [{ name: "Socket", quantity: 2, extension: { keep: true } }],
    });
    expect(f.documents.get(source.file.id)).toMatchObject({
      extension: { keep: true },
      boxes: [
        {
          boxId: document.box.id,
          boxNumber: "BOX-0001",
          driveFolderId: folder.id,
        },
      ],
    });
    expect(
      f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
    ).toBe(false);
    expect(
      [...f.files.values()].find((v) => v.name === "box-storage-pending.json")!
        .trashed,
    ).toBe(true);
    expect(
      f.events
        .filter((e) => ["PUT", "PATCH"].includes(e.method))
        .every((e) => e.path.includes("/v2/") && !!e.condition),
    ).toBe(true);
  });
  it("releases an unused claim when QR generation fails before creating a folder", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    f.generateQr.mockRejectedValueOnce(new ClientError("UNAVAILABLE"));
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result.outcome).not.toBe("complete");
    expect(result.phase).toBe("generate-folder-qr");
    expect(
      (await f.storage.listChildren("root")).filter(
        (file) => file.mimeType === FOLDER,
      ),
    ).toHaveLength(0);
    expect(
      f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
    ).toBe(false);
  });
  it("rejects a mislabeled non-PNG before creating a folder", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    f.generateQr.mockResolvedValueOnce(
      new Blob(["not a PNG image"], { type: "image/png" }),
    );
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result.code).toBe("INVALID_IMAGE");
    expect(
      (await f.storage.listChildren("root")).filter(
        (file) => file.mimeType === FOLDER,
      ),
    ).toHaveLength(0);
  });
  it("retains the marker and owner without claiming a number if QR read-back differs", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    f.setHook((event) => {
      const file = f.files.get(event.id!);
      if (event.method === "GET" && file?.mimeType === "image/png")
        f.binaries.set(file.id, new Blob(["corrupt"], { type: "image/png" }));
    });
    const operationId = crypto.randomUUID();
    const result = await c.service.create(draft(), source, operationId);
    expect(result.outcome).not.toBe("complete");
    expect(result.phase).toBe("drive-folder-qr");
    expect(result.code).toBe("READ_CONFLICT");
    expect(f.documents.get(source.file.id)).toMatchObject({ boxes: [] });
    const marker = [...f.files.values()].find(
      (file) => file.name === "box-storage-pending.json",
    )!;
    expect(marker.trashed).not.toBe(true);
    expect(f.documents.get(marker.id)).toMatchObject({
      operationId,
      qrFilename: DRIVE_FOLDER_QR_FILENAME,
      qrUrl: `https://drive.google.com/drive/folders/${result.folderId}`,
    });
    expect(f.properties.get("root")).toContainEqual({
      key: "bsmCreateOwner",
      value: operationId,
      visibility: "PUBLIC",
    });
  });
  it("accepts Drive post-processing version changes when fresh PNG bytes remain identical", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    f.setHook((event) => {
      if (
        event.method === "PATCH" &&
        event.body?.title === "BOX-0001 Garage tools"
      ) {
        const qr = [...f.files.values()].find(
          (file) => file.name === DRIVE_FOLDER_QR_FILENAME,
        )!;
        f.bump(qr.id);
      }
    });
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result.outcome).toBe("complete");
    expect(
      result.steps.some(
        (step) =>
          step.phase === "verify-folder-qr" && step.status === "confirmed",
      ),
    ).toBe(true);
  });
  it("retains its marker when published QR contents change before final verification", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    f.setHook((event) => {
      if (
        event.method === "PATCH" &&
        event.body?.title === "BOX-0001 Garage tools"
      ) {
        const qr = [...f.files.values()].find(
          (file) => file.name === DRIVE_FOLDER_QR_FILENAME,
        )!;
        f.binaries.set(qr.id, new Blob(["changed PNG"], { type: "image/png" }));
        f.bump(qr.id);
      }
    });
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result).toMatchObject({
      outcome: "partial",
      phase: "verify-folder-qr",
      code: "READ_CONFLICT",
    });
    const marker = [...f.files.values()].find(
      (file) => file.name === "box-storage-pending.json",
    )!;
    expect(marker.trashed).not.toBe(true);
  });
  it("rejects a PNG version change during the verification download", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    let downloads = 0;
    f.setHook((event) => {
      const file = f.files.get(event.id!);
      if (
        event.method === "GET" &&
        file?.mimeType === "image/png" &&
        ++downloads === 2
      )
        f.bump(file.id);
    });
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result).toMatchObject({
      outcome: "partial",
      phase: "verify-folder-qr",
      code: "READ_CONFLICT",
    });
  });
  it("refreshes unchanged pending inventory after Drive post-processing during QR upload", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    let advanced = false;
    f.setHook((event) => {
      if (
        !advanced &&
        event.method === "GET" &&
        f.files.get(event.id!)?.mimeType === "image/png"
      ) {
        const inventory = [...f.files.values()].find(
          (file) => file.name === "inventory.pending.json",
        )!;
        f.bump(inventory.id);
        advanced = true;
      }
    });
    expect(
      (await c.service.create(draft(), source, crypto.randomUUID())).outcome,
    ).toBe("complete");
  });
  it("rejects changed pending inventory before publishing even if its metadata is fresh", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    let changed = false;
    f.setHook((event) => {
      if (
        !changed &&
        event.method === "GET" &&
        f.files.get(event.id!)?.mimeType === "image/png"
      ) {
        const inventory = [...f.files.values()].find(
          (file) => file.name === "inventory.pending.json",
        )!;
        const stored = f.documents.get(inventory.id) as Inventory;
        stored.items[0]!.quantity = 999;
        f.bump(inventory.id);
        changed = true;
      }
    });
    expect(
      await c.service.create(draft(), source, crypto.randomUUID()),
    ).toMatchObject({
      outcome: "partial",
      phase: "publish-inventory",
      code: "READ_CONFLICT",
    });
    expect(
      [...f.files.values()].some((file) => file.name === "inventory.json"),
    ).toBe(false);
  });
  it("allows one of two competing box claims and creates no duplicate committed number", async () => {
    const f = fixture(),
      source = await f.client().service.initialize();
    const results = await Promise.all([
      f.client().service.create(draft(), source, crypto.randomUUID()),
      f.client().service.create(draft(), source, crypto.randomUUID()),
    ]);
    expect(results.filter((r) => r.outcome === "complete")).toHaveLength(1);
    expect(
      (f.documents.get(source.file.id) as { boxes: unknown[] }).boxes,
    ).toHaveLength(1);
    expect(
      [...f.files.values()].filter((v) => v.mimeType === FOLDER),
    ).toHaveLength(2);
  });
  it("rejects stale drafts before making a folder", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    f.bump(source.file.id);
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result).toMatchObject({
      outcome: "conflict",
      code: "DRIVE_CONFLICT",
    });
    expect(
      [...f.files.values()].filter((v) => v.mimeType === FOLDER),
    ).toHaveLength(1);
  });
  it("retains lock, marker and draft when the number claim loses a race", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    f.setHook((e) => {
      if (e.method === "PUT") f.bump(source.file.id);
    });
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result).toMatchObject({
      outcome: "partial",
      phase: "number-claim",
      code: "DRIVE_CONFLICT",
    });
    expect([...f.files.values()].some((v) => v.name === "inventory.json")).toBe(
      false,
    );
    expect(
      [...f.files.values()].some((v) => v.name === "inventory.pending.json"),
    ).toBe(true);
    expect(
      f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
    ).toBe(true);
  });
  it("never retries an ambiguous folder create or expires its lock", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    f.setHook((e) => {
      if (e.method === "POST" && e.body?.mimeType === FOLDER)
        throw new ClientError("AMBIGUOUS_WRITE");
    });
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result).toMatchObject({
      outcome: "ambiguous",
      phase: "pending-folder",
    });
    expect(
      f.events.filter(
        (e) => e.method === "POST" && e.body?.mimeType === FOLDER,
      ),
    ).toHaveLength(1);
    await expect(c.service.initialize()).rejects.toMatchObject({
      code: "PENDING_CREATION",
    });
  });
  it("fences a late lock response after an account/context change", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    f.setHook((e) => {
      if (e.method === "PATCH") c.auth.generation++;
    });
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result).toMatchObject({
      outcome: "ambiguous",
      code: "CONTEXT_CHANGED",
    });
    expect(
      [...f.files.values()].filter((v) => v.mimeType === FOLDER),
    ).toHaveLength(1);
  });
  it("releases an unused claim after refusing an incorrect number proposal", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    const result = await c.service.create(
      draft("BOX-0002"),
      source,
      crypto.randomUUID(),
    );
    expect(result.outcome).toBe("conflict");
    expect(
      f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
    ).toBe(false);
    expect(
      [...f.files.values()].filter((v) => v.mimeType === FOLDER),
    ).toHaveLength(1);
  });
  it("does not release another writer's lock", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize();
    let moved = false;
    f.setHook((e) => {
      if (!moved && e.method === "POST" && e.body?.mimeType === FOLDER) {
        moved = true;
        const p = f.properties
          .get("root")!
          .find((p) => p.key === "bsmCreateOwner")!;
        p.value = "external-operation";
        f.bump("root");
      }
    });
    const result = await c.service.create(draft(), source, crypto.randomUUID());
    expect(result).toMatchObject({
      outcome: "partial",
      code: "DRIVE_CONFLICT",
    });
    expect(
      f.properties.get("root")!.find((p) => p.key === "bsmCreateOwner")!.value,
    ).toBe("external-operation");
  });
  it("rejects references to photographs that cannot exist in a new box", async () => {
    const f = fixture(),
      c = f.client(),
      source = await c.service.initialize(),
      document = draft();
    document.items[0]!.images = ["missing.jpg"];
    expect(
      await c.service.create(document, source, crypto.randomUUID()),
    ).toMatchObject({ outcome: "blocked", code: "INVALID_IMAGE" });
  });
});

async function existingBox() {
  const f = fixture(),
    c = f.client();
  const source = await c.service.initialize();
  const created = await c.service.create(draft(), source, crypto.randomUUID());
  expect(created.outcome).toBe("complete");
  const folder = await f.storage.withinRoot(created.folderId!);
  const file = (await f.storage.listChildren(folder.id)).find(
    (f) => f.name === "inventory.json",
  )!;
  const inventory = await f.storage.readJson(file.id);
  const document = structuredClone(inventory.document) as Inventory;
  const proposal: import("../src/services/editing").Draft = {
    kind: "edit",
    document,
    original: structuredClone(document),
    inventory,
    folder,
    index: await f.storage.readJson(source.file.id),
    rootId: "root",
    readOnly: false,
    operationId: crypto.randomUUID(),
  };
  return { f, c, proposal };
}
describe("coordinated existing-box saves", () => {
  it("persists new item details and preserves original identities, extensions and unrelated index entries", async () => {
    const { f, c, proposal } = await existingBox();
    proposal.document.items.push({
      id: crypto.randomUUID(),
      name: "New screwdriver",
      quantity: 3,
      notes: "Phillips",
    });
    proposal.document.box.name = "Updated tools";
    proposal.document.box.location = "Shelf 2";
    const result = await c.service.edit(proposal);
    expect(result.outcome).toBe("complete");
    expect(f.documents.get(proposal.inventory!.file.id)).toMatchObject({
      box: {
        id: proposal.original.box.id,
        number: proposal.original.box.number,
        extension: { keep: true },
      },
      items: [
        { extension: { keep: true } },
        { name: "New screwdriver", quantity: 3, notes: "Phillips" },
      ],
    });
    expect(f.documents.get(proposal.index.file.id)).toMatchObject({
      boxes: [{ name: "Updated tools", location: "Shelf 2" }],
    });
    expect(f.files.get(proposal.folder!.id)!.name).toBe(
      "BOX-0001 Updated tools",
    );
    expect(
      f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
    ).toBe(false);
    expect(
      [...f.files.values()].find(
        (f) => f.name === "box-storage-edit-pending.json",
      )!.trashed,
    ).toBe(true);
  });
  it("rejects one of two concurrent editors without losing the accepted item", async () => {
    const { f, proposal } = await existingBox();
    const other = structuredClone(proposal);
    other.operationId = crypto.randomUUID();
    proposal.document.items.push({
      id: crypto.randomUUID(),
      name: "First addition",
      quantity: 1,
    });
    other.document.items.push({
      id: crypto.randomUUID(),
      name: "Second addition",
      quantity: 1,
    });
    const results = await Promise.all([
      f.client().service.edit(proposal),
      f.client().service.edit(other),
    ]);
    expect(results.filter((r) => r.outcome === "complete")).toHaveLength(1);
    const saved = f.documents.get(proposal.inventory!.file.id) as Inventory;
    expect(saved.items).toHaveLength(2);
    expect(saved.items[1]!.name).toBe(
      results[0]!.outcome === "complete" ? "First addition" : "Second addition",
    );
  });
  it("accepts metadata-only version changes using a fresh ETag while preserving the exact source JSON", async () => {
    const { f, c, proposal } = await existingBox();
    f.bump(proposal.inventory!.file.id);
    f.bump(proposal.folder!.id);
    proposal.document.items.push({
      id: crypto.randomUUID(),
      name: "Metadata drift addition",
      quantity: 1,
    });
    expect((await c.service.edit(proposal)).outcome).toBe("complete");
  });
  it("rejects a stale inventory before creating a marker or overwriting content and releases the unused claim", async () => {
    const { f, c, proposal } = await existingBox();
    const changed = structuredClone(proposal.original);
    changed.items[0]!.notes = "External edit";
    f.documents.set(proposal.inventory!.file.id, changed);
    f.bump(proposal.inventory!.file.id);
    const result = await c.service.edit(proposal);
    expect(result).toMatchObject({
      outcome: "conflict",
      code: "DRIVE_CONFLICT",
    });
    expect(
      [...f.files.values()].some(
        (f) => f.name === "box-storage-edit-pending.json",
      ),
    ).toBe(false);
    expect(
      f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
    ).toBe(false);
  });
  it("retains marker and owner after an index conflict following successful inventory publication", async () => {
    const { f, c, proposal } = await existingBox();
    proposal.document.items.push({
      id: crypto.randomUUID(),
      name: "Retained addition",
      quantity: 1,
    });
    f.setHook((e) => {
      if (e.method === "PUT" && e.id === proposal.index.file.id) f.bump(e.id);
    });
    const result = await c.service.edit(proposal);
    expect(result).toMatchObject({
      outcome: "partial",
      phase: "index",
      code: "DRIVE_CONFLICT",
    });
    expect(
      (f.documents.get(proposal.inventory!.file.id) as Inventory).items,
    ).toHaveLength(2);
    expect(
      [...f.files.values()].find(
        (f) => f.name === "box-storage-edit-pending.json",
      )!.trashed,
    ).not.toBe(true);
    expect(
      f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
    ).toBe(true);
    const fresh = structuredClone(proposal);
    fresh.operationId = crypto.randomUUID();
    expect((await f.client().service.edit(fresh)).outcome).toBe("blocked");
  });
  it("does not retry an ambiguous media response or discard the review record", async () => {
    const { f, c, proposal } = await existingBox();
    f.setHook((e) => {
      if (e.method === "PUT" && e.id === proposal.inventory!.file.id)
        throw new ClientError("AMBIGUOUS_WRITE");
    });
    const before = f.events.length,
      result = await c.service.edit(proposal);
    expect(result).toMatchObject({ outcome: "ambiguous", phase: "inventory" });
    expect(
      f.events.slice(before).filter((e) => e.method === "PUT"),
    ).toHaveLength(1);
    expect(
      f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
    ).toBe(true);
  });
  it("refuses NFC reassignment and new image references before acquiring a claim", async () => {
    const { f, c, proposal } = await existingBox();
    proposal.document.box.nfcIds = ["04AABBCC"];
    expect((await c.service.edit(proposal)).code).toBe("IMMUTABLE_IDENTITY");
    proposal.document.box.nfcIds = [];
    proposal.document.items[0]!.images = ["new.jpg"];
    expect((await c.service.edit(proposal)).code).toBe("INVALID_IMAGE");
    expect(
      f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
    ).toBe(false);
  });
});

const selection = (proposal: import("../src/services/editing").Draft) => {
  const id = crypto.randomUUID(),
    item = proposal.document.items[0]!;
  return {
    id,
    name: `${proposal.document.box.number}-socket-${item.id}-${id}.jpg`,
    blob: new Blob([new Uint8Array([255, 216, 1, 2, 3, 255, 217])], {
      type: "image/jpeg",
    }),
  };
};
async function refreshed(
  f: ReturnType<typeof fixture>,
  proposal: import("../src/services/editing").Draft,
) {
  const inventory = await f.storage.readJson(proposal.inventory!.file.id),
    document = inventory.document as Inventory;
  return {
    ...proposal,
    operationId: crypto.randomUUID(),
    document: structuredClone(document),
    original: structuredClone(document),
    inventory,
    index: await f.storage.readJson(proposal.index.file.id),
    folder: await f.storage.withinRoot(proposal.folder!.id),
  };
}
describe("coordinated photo workflow", () => {
  it("verifies uploaded JPEG bytes before publishing two ordinary photo references", async () => {
    const { f, c, proposal } = await existingBox(),
      photos = [selection(proposal), selection(proposal)];
    const result = await c.service.edit(proposal, undefined, {
      itemId: proposal.document.items[0]!.id,
      action: { kind: "add" },
      selections: photos,
    });
    expect(result.outcome).toBe("complete");
    expect(result.uploaded).toHaveLength(2);
    const saved = f.documents.get(proposal.inventory!.file.id) as Inventory;
    expect(saved.items[0]!.images).toEqual(photos.map((p) => p.name));
    for (const file of result.uploaded!) {
      expect(file.appProperties?.bsmItemId).toBe(saved.items[0]!.id);
      expect(file.description).toContain("Socket");
      expect(new Uint8Array(await blobBytes(f.binaries.get(file.id)!))).toEqual(
        new Uint8Array(
          await blobBytes(photos.find((p) => p.name === file.name)!.blob),
        ),
      );
    }
  });
  it("replaces a reference then conditionally trashes only the reviewed unreferenced owned original", async () => {
    const { f, c, proposal } = await existingBox(),
      initial = selection(proposal),
      itemId = proposal.document.items[0]!.id;
    await c.service.edit(proposal, undefined, {
      itemId,
      action: { kind: "add" },
      selections: [initial],
    });
    const source = await refreshed(f, proposal),
      replacement = selection(source);
    const changed = await c.service.edit(source, undefined, {
      itemId,
      action: { kind: "replace", filename: initial.name },
      selections: [replacement],
    });
    expect(changed.outcome).toBe("complete");
    expect(changed.obsolete).toHaveLength(1);
    expect(f.files.get(changed.obsolete![0]!.id)!.trashed).not.toBe(true);
    const clean = await c.service.edit(
      await refreshed(f, proposal),
      undefined,
      { itemId, action: { kind: "cleanup" }, candidates: changed.obsolete },
    );
    expect(clean.outcome).toBe("complete");
    expect(f.files.get(changed.obsolete![0]!.id)!.trashed).toBe(true);
    expect(
      (f.documents.get(proposal.inventory!.file.id) as Inventory).items[0]!
        .images,
    ).toEqual([replacement.name]);
  });
  it("retains a shared photo when removing it from one item", async () => {
    const { f, c, proposal } = await existingBox(),
      image = selection(proposal),
      itemId = proposal.document.items[0]!.id;
    await c.service.edit(proposal, undefined, {
      itemId,
      action: { kind: "add" },
      selections: [image],
    });
    const document = f.documents.get(proposal.inventory!.file.id) as Inventory;
    document.items.push({
      id: crypto.randomUUID(),
      name: "Shared image item",
      quantity: 1,
      images: [image.name],
    });
    f.bump(proposal.inventory!.file.id);
    const removed = await c.service.edit(
      await refreshed(f, proposal),
      undefined,
      { itemId, action: { kind: "remove", filename: image.name } },
    );
    expect(removed).toMatchObject({
      outcome: "blocked",
      code: "INVALID_INVENTORY",
    });
    expect(
      [...f.files.values()].find((f) => f.name === image.name)!.trashed,
    ).not.toBe(true);
  });
  it("retains a currently referenced owned file during reviewed cleanup", async () => {
    const { f, c, proposal } = await existingBox(),
      image = selection(proposal),
      itemId = proposal.document.items[0]!.id;
    const added = await c.service.edit(proposal, undefined, {
      itemId,
      action: { kind: "add" },
      selections: [image],
    });
    const clean = await c.service.edit(
      await refreshed(f, proposal),
      undefined,
      { itemId, action: { kind: "cleanup" }, candidates: added.uploaded },
    );
    expect(clean.outcome).toBe("complete");
    expect(clean.retained).toEqual([image.name]);
    expect(f.files.get(added.uploaded![0]!.id)!.trashed).not.toBe(true);
  });
  it("does not retry an ambiguous upload and retains its predetermined ID in the durable marker", async () => {
    const { f, c, proposal } = await existingBox();
    f.setHook((e) => {
      if (
        e.method === "POST" &&
        e.path.includes("/upload/") &&
        [...f.files.values()].some(
          (f) => f.name === "box-storage-edit-pending.json",
        )
      )
        throw new ClientError("AMBIGUOUS_WRITE");
    });
    const result = await c.service.edit(proposal, undefined, {
      itemId: proposal.document.items[0]!.id,
      action: { kind: "add" },
      selections: [selection(proposal)],
    });
    expect(result).toMatchObject({
      outcome: "ambiguous",
      phase: "photo-upload",
    });
    const marker = [...f.files.values()].find(
      (f) => f.name === "box-storage-edit-pending.json",
    )!;
    expect(f.documents.get(marker.id)).toMatchObject({
      uploads: [{ id: expect.any(String) }],
    });
    expect(
      (f.documents.get(proposal.inventory!.file.id) as Inventory).items[0]!
        .images,
    ).toBeUndefined();
  });
  it("coordinates cleanup against a competing re-association client", async () => {
    const { f, c, proposal } = await existingBox(),
      photo = selection(proposal),
      itemId = proposal.document.items[0]!.id;
    await c.service.edit(proposal, undefined, {
      itemId,
      action: { kind: "add" },
      selections: [photo],
    });
    const removed = await c.service.edit(
      await refreshed(f, proposal),
      undefined,
      { itemId, action: { kind: "remove", filename: photo.name } },
    );
    const source = await refreshed(f, proposal),
      other = structuredClone(source);
    other.operationId = crypto.randomUUID();
    const [cleanup, associate] = await Promise.all([
      f.client().service.edit(source, undefined, {
        itemId,
        action: { kind: "cleanup" },
        candidates: removed.obsolete,
      }),
      f.client().service.edit(other, undefined, {
        itemId,
        action: { kind: "associate" },
        candidates: removed.obsolete,
      }),
    ]);
    expect(
      [cleanup, associate].filter((r) => r.outcome === "complete"),
    ).toHaveLength(1);
    const referenced = (
      f.documents.get(proposal.inventory!.file.id) as Inventory
    ).items[0]!.images?.includes(photo.name);
    const trashed = f.files.get(removed.obsolete![0]!.id)!.trashed;
    expect(Boolean(referenced) && Boolean(trashed)).toBe(false);
  });
  it("deletes an item, retains its files for review, and permits owned cleanup after the item is gone", async () => {
    const { f, c, proposal } = await existingBox(),
      itemId = proposal.document.items[0]!.id;
    await c.service.edit(proposal, undefined, {
      itemId,
      action: { kind: "add" },
      selections: [selection(proposal)],
    });
    const removed = await c.service.edit(
      await refreshed(f, proposal),
      undefined,
      { itemId, action: { kind: "item" } },
    );
    expect(removed.outcome).toBe("complete");
    expect(
      (f.documents.get(proposal.inventory!.file.id) as Inventory).items,
    ).toHaveLength(0);
    const cleanup = await c.service.edit(
      await refreshed(f, proposal),
      undefined,
      { itemId, action: { kind: "cleanup" }, candidates: removed.obsolete },
    );
    expect(cleanup.outcome).toBe("complete");
    expect(f.files.get(removed.obsolete![0]!.id)!.trashed).toBe(true);
  });
});

it("refuses association when a duplicate filename appears after upload discovery", async () => {
  const { f, c, proposal } = await existingBox(),
    itemId = proposal.document.items[0]!.id,
    image = selection(proposal);
  await c.service.edit(proposal, undefined, {
    itemId,
    action: { kind: "add" },
    selections: [image],
  });
  const removed = await c.service.edit(
    await refreshed(f, proposal),
    undefined,
    { itemId, action: { kind: "remove", filename: image.name } },
  );
  const candidate = removed.obsolete![0]!;
  f.files.set("duplicate-image", {
    ...candidate,
    id: "duplicate-image",
    appProperties: undefined,
  });
  const result = await c.service.edit(await refreshed(f, proposal), undefined, {
    itemId,
    action: { kind: "associate" },
    candidates: [candidate],
  });
  expect(result).toMatchObject({ outcome: "conflict", code: "DRIVE_CONFLICT" });
  expect(
    (f.documents.get(proposal.inventory!.file.id) as Inventory).items[0]!
      .images,
  ).toEqual([]);
  expect(
    f.properties.get("root")!.some((p) => p.key === "bsmCreateOwner"),
  ).toBe(false);
});

it.skipIf(!process.env.BSM_WRITE_PERF_OUTPUT)(
  "profiles coordinated writes without live Drive mutations",
  async () => {
    const { writeFileSync } = await import("node:fs");
    const results: unknown[] = [];
    for (let sample = 0; sample < 3; sample++) {
      const f = fixture(),
        c = f.client();
      f.setHook(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const source = await c.service.initialize();
      const measure = async (
        operation: string,
        task: () => Promise<unknown>,
      ) => {
        const started = performance.now(),
          calls = f.events.length;
        const result = await task();
        expect(result).toMatchObject({ outcome: "complete" });
        results.push({
          sample,
          operation,
          elapsedMs: performance.now() - started,
          coordinatorHttpCalls: f.events.length - calls,
        });
        return result as { folderId: string };
      };
      const created = await measure("createBox", () =>
        c.service.create(draft(), source, crypto.randomUUID()),
      );
      const folder = await f.storage.withinRoot(created.folderId);
      const inventory = await f.storage.readJson(
        (await f.storage.listChildren(folder.id)).find(
          (file) => file.name === "inventory.json",
        )!.id,
      );
      const original = structuredClone(inventory.document) as Inventory;
      const proposal: import("../src/services/editing").Draft = {
        kind: "edit",
        document: structuredClone(original),
        original,
        inventory,
        folder,
        index: await f.storage.readJson(source.file.id),
        rootId: "root",
        readOnly: false,
        operationId: crypto.randomUUID(),
      };
      proposal.document.box.description = "Measured ordinary edit";
      await measure("saveEdit", () => c.service.edit(proposal));
      const fresh = await refreshed(f, proposal);
      await measure("uploadPhoto", () =>
        c.service.edit(fresh, undefined, {
          itemId: fresh.document.items[0]!.id,
          action: { kind: "add" },
          selections: [
            {
              ...selection(fresh),
              blob: new Blob([new Uint8Array(1024 * 1024)], {
                type: "image/jpeg",
              }),
            },
          ],
        }),
      );
    }
    writeFileSync(
      process.env.BSM_WRITE_PERF_OUTPUT!,
      JSON.stringify(
        {
          model:
            "coordinator simulator; 20ms per v2 transport call; storage helpers in memory; synthetic 1MiB JPEG upload",
          results,
        },
        null,
        2,
      ),
    );
  },
  30000,
);
