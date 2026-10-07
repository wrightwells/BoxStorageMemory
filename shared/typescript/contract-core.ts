import type { ValidateFunction } from "ajv";

export type JsonObject = { [key: string]: any };
export type Issue = { path: string; code: string };
export type ValidationResult = { valid: boolean; errors: Issue[] };
export type Kind = "inventory" | "index";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function normalizeNfc(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_NFC_ID");
  const raw = value.replace(/^[ \t\r\n\v\f]+|[ \t\r\n\v\f]+$/g, "");
  if (/^(?:[0-9a-fA-F]{2}){1,32}$/.test(raw)) return raw.toUpperCase();
  for (const separator of [":", "-", " "]) {
    if (new RegExp(`^[0-9a-fA-F]{2}(?:${separator}[0-9a-fA-F]{2}){1,31}$`).test(raw)) {
      return raw.split(separator).join("").toUpperCase();
    }
  }
  throw new Error("INVALID_NFC_ID");
}

export function normalizeBoxNumber(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_BOX_NUMBER");
  const raw = value.replace(/^[ \t\r\n\v\f]+|[ \t\r\n\v\f]+$/g, "").toUpperCase();
  if (!/^BOX-[0-9]{1,9}$/.test(raw) || Number(raw.slice(4)) < 1) throw new Error("INVALID_BOX_NUMBER");
  return `BOX-${String(Number(raw.slice(4))).padStart(4, "0")}`;
}

export function publicOrigin(value: unknown): string {
  if (typeof value !== "string" || /[\s\\?#]/.test(value)) throw new Error("INVALID_PUBLIC_URL");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("INVALID_PUBLIC_URL"); }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || !/^[a-zA-Z0-9.-]+$|^\[::1\]$/.test(parsed.hostname)) {
    throw new Error("INVALID_PUBLIC_URL");
  }
  if (parsed.port === "0" || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)))) {
    throw new Error("INVALID_PUBLIC_URL");
  }
  // Reject empty userinfo and non-canonical numeric-IP spellings URL would rewrite.
  const authority = value.match(/^[a-zA-Z]+:\/\/([^/]+)\/?$/)?.[1];
  if (!authority || authority.includes("@") || authority.toLowerCase() !== new URL(parsed.origin).host.toLowerCase() &&
      authority.toLowerCase() !== `${parsed.hostname}:${parsed.protocol === "https:" ? "443" : "80"}`) {
    throw new Error("INVALID_PUBLIC_URL");
  }
  return parsed.origin;
}

export function qrUrl(publicUrl: string, boxId: string): string {
  if (!uuid.test(boxId)) throw new Error("INVALID_BOX_ID");
  return `${publicOrigin(publicUrl)}/box/${boxId}`;
}

export function parseQr(value: unknown, publicUrl: string): string {
  const prefix = `${publicOrigin(publicUrl)}/box/`;
  if (typeof value !== "string" || !value.startsWith(prefix)) throw new Error("INVALID_QR_URL");
  const boxId = value.slice(prefix.length);
  if (!uuid.test(boxId) || value !== qrUrl(publicUrl, boxId)) throw new Error("INVALID_QR_URL");
  return boxId;
}

export function schemaMode(document: unknown): "supported" | "read-only" | "invalid" {
  const version = (document as JsonObject | null)?.schemaVersion;
  if (Number.isInteger(version) && version === 1) return "supported";
  if (Number.isInteger(version) && version > 1) return "read-only";
  return "invalid";
}

function sorted(errors: Issue[]): Issue[] {
  const unique = new Map(errors.map(e => [`${e.path}\u0000${e.code}`, e]));
  return [...unique.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
}

function duplicates(records: JsonObject[], field: string, prefix: string, code: string): Issue[] {
  const seen = new Set<string>();
  const errors: Issue[] = [];
  records.forEach((record, i) => {
    if (seen.has(record[field])) errors.push({ path: `${prefix}/${i}/${field}`, code });
    seen.add(record[field]);
  });
  return errors;
}

function domainErrors(kind: Kind, document: JsonObject): Issue[] {
  if (kind === "inventory") {
    const errors = duplicates(document.items, "id", "/items", "DUPLICATE_ITEM_ID");
    if (Date.parse(document.box.modified) < Date.parse(document.box.created)) {
      errors.push({ path: "/box/modified", code: "INVALID_TIMESTAMP_ORDER" });
    }
    const seen = new Set<string>();
    document.items.forEach((item: JsonObject, i: number) => {
      (item.images ?? []).forEach((image: string, j: number) => {
        if (seen.has(image)) errors.push({ path: `/items/${i}/images/${j}`, code: "IMAGE_HAS_MULTIPLE_OWNERS" });
        seen.add(image);
      });
    });
    return errors;
  }
  const errors: Issue[] = [];
  for (const [field, code] of [["boxId", "DUPLICATE_BOX_ID"], ["boxNumber", "DUPLICATE_BOX_NUMBER"], ["driveFolderId", "DUPLICATE_FOLDER_ID"]]) {
    errors.push(...duplicates(document.boxes, field!, "/boxes", code!));
  }
  const seen = new Set<string>();
  document.boxes.forEach((box: JsonObject, i: number) => {
    box.nfcIds.forEach((uid: string, j: number) => {
      if (seen.has(uid)) errors.push({ path: `/boxes/${i}/nfcIds/${j}`, code: "DUPLICATE_NFC_ID" });
      seen.add(uid);
    });
  });
  return errors;
}

export class CoreContractValidator {
  private validators;

  constructor(precompiled: Record<Kind, ValidateFunction>) {
    this.validators = precompiled;
  }

  validate(kind: Kind, document: unknown): ValidationResult {
    const validate = this.validators[kind];
    const structural = validate(document);
    const errors = sorted(structural ? domainErrors(kind, document as JsonObject) :
      (validate.errors ?? []).map(e => ({ path: e.instancePath, code: "SCHEMA_VIOLATION" })));
    return { valid: errors.length === 0, errors };
  }

  validateLibrary(index: JsonObject, inventories: Record<string, JsonObject>): ValidationResult {
    const errors = this.validate("index", index).errors;
    if (errors.length) return { valid: false, errors };
    index.boxes.forEach((entry: JsonObject, i: number) => {
      const inventory = Object.hasOwn(inventories, entry.driveFolderId) ? inventories[entry.driveFolderId] : undefined;
      const base = `/boxes/${i}`;
      if (!inventory) { errors.push({ path: base, code: "MISSING_INVENTORY" }); return; }
      if (!this.validate("inventory", inventory).valid) { errors.push({ path: base, code: "INVALID_INVENTORY" }); return; }
      for (const [key, inventoryKey] of [["boxId", "id"], ["boxNumber", "number"], ["name", "name"], ["location", "location"]]) {
        if ((entry[key!] ?? "") !== (inventory.box[inventoryKey!] ?? "")) errors.push({ path: `${base}/${key}`, code: "INDEX_MISMATCH" });
      }
      if (JSON.stringify([...entry.nfcIds].sort()) !== JSON.stringify([...inventory.box.nfcIds].sort())) {
        errors.push({ path: `${base}/nfcIds`, code: "INDEX_MISMATCH" });
      }
    });
    for (const folderId of Object.keys(inventories)) {
      if (!index.boxes.some((box: JsonObject) => box.driveFolderId === folderId)) errors.push({ path: "/boxes", code: "UNINDEXED_INVENTORY" });
    }
    const result = sorted(errors);
    return { valid: result.length === 0, errors: result };
  }

  editItem(document: JsonObject, itemId: string, changes: JsonObject): JsonObject {
    if (schemaMode(document) !== "supported" || !this.validate("inventory", document).valid) throw new Error("UNEDITABLE_INVENTORY");
    const allowed = new Set(["name", "quantity", "description", "tags", "images", "notes"]);
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).every(key => allowed.has(key))) throw new Error("INVALID_ITEM_EDIT");
    const result = structuredClone(document);
    const target = result.items.find((item: JsonObject) => item.id === itemId);
    if (!target) throw new Error("ITEM_NOT_FOUND");
    Object.assign(target, structuredClone(changes));
    if (!this.validate("inventory", result).valid) throw new Error("INVALID_ITEM_EDIT");
    return result;
  }
}
