import { Ajv2020 } from "ajv/dist/2020.js";
import { fullFormats } from "ajv-formats/dist/formats.js";
import type { ValidateFunction } from "ajv";
import { CoreContractValidator, type Kind } from "./contract-core.js";
export * from "./contract-core.js";

// Public Node/client contract adapter retains the existing constructor.
export class ContractValidator extends CoreContractValidator {
  constructor(inventorySchema: object, indexSchema: object, precompiled?: Record<Kind, ValidateFunction>) {
    if (!precompiled) {
      const ajv = new Ajv2020({ allErrors: true, strict: true, formats: fullFormats });
      precompiled = { inventory: ajv.compile(inventorySchema), index: ajv.compile(indexSchema) };
    }
    super(precompiled);
  }
}
