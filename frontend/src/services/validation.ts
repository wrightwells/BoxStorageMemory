import { ContractValidator } from "../../../shared/typescript/contracts";
import { inventory, index } from "../generated/validators.mjs";
export const validator = new ContractValidator({}, {}, { inventory, index });
