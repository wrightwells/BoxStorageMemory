import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import cases from "../../fixtures/contracts/cases.json";
import { validator } from "../src/services/validation";
import type { Kind } from "../../shared/typescript/contracts";

describe("precompiled browser contract parity", () => {
  for (const test of cases) {
    if (test.action !== "validate") continue;
    it(test.name, () => {
      const document = JSON.parse(
        readFileSync(resolve("../fixtures/contracts", test.file!), "utf8"),
      );
      expect(validator.validate(test.kind as Kind, document)).toEqual(
        test.expected,
      );
    });
  }
});
