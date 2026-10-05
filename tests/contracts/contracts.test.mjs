import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  ContractValidator, normalizeBoxNumber, normalizeNfc, parseQr, publicOrigin, schemaMode,
} from "../../.build/contracts/contracts.js";

const load = name => JSON.parse(readFileSync(new URL(`../../fixtures/contracts/${name}`, import.meta.url), "utf8"));
const schema = name => JSON.parse(readFileSync(new URL(`../../schemas/v1/${name}.schema.json`, import.meta.url), "utf8"));
const validator = new ContractValidator(schema("inventory"), schema("box-index"));
const results = {};

for (const c of load("cases.json")) {
  test(c.name, () => {
    let actual;
    try {
      let result;
      switch (c.action) {
        case "validate": result = validator.validate(c.kind, load(c.file)); break;
        case "nfc": result = normalizeNfc(c.input); break;
        case "number": result = normalizeBoxNumber(c.input); break;
        case "qr": result = parseQr(c.input, c.publicUrl); break;
        case "origin": result = publicOrigin(c.input); break;
        case "mode": result = schemaMode(c.input); break;
        default: throw new Error("Unknown fixture action");
      }
      actual = { result };
    } catch (error) { actual = { error: error.message }; }
    results[c.name] = actual;
    assert.deepEqual(actual, c.error ? { error: c.error } : { result: c.expected });
  });
}
for (const c of load("library-cases.json")) {
  test(c.name, () => {
    const data = load(c.file);
    const result = validator.validateLibrary(data.index, data.inventories);
    results[c.name] = { result };
    assert.deepEqual(result, c.expected);
  });
}

test("edits preserve unknown fields and leave the source intact", () => {
  const document = load("unknown-fields.json");
  const original = structuredClone(document);
  const edited = validator.editItem(document, document.items[0].id, { name: "Updated extension lead", quantity: 2 });
  results["edit-preserves-extensions"] = { result: edited };
  assert.deepEqual(document, original);
  assert.deepEqual(edited.futureRoot, original.futureRoot);
  assert.deepEqual(edited.box.futureBox, original.box.futureBox);
  assert.deepEqual(edited.items[0].futureItem, original.items[0].futureItem);
  assert.equal(edited.items[0].quantity, 2);
  assert.throws(() => validator.editItem(document, document.items[0].id, { id: "changed" }), /INVALID_ITEM_EDIT/);
  assert.throws(() => validator.editItem({ ...document, schemaVersion: 2 }, document.items[0].id, { name: "changed" }), /UNEDITABLE_INVENTORY/);
});

test("independent Python and TypeScript implementations return identical results", () => {
  const python = spawnSync(process.env.PYTHON ?? "python3", ["tools/contract_results.py"], { encoding: "utf8" });
  assert.equal(python.status, 0, python.stderr);
  assert.deepEqual(results, JSON.parse(python.stdout));
});
