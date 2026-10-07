import { CoreContractValidator } from "../../../shared/typescript/contract-core";
import { inventory, index } from "../generated/validators.mjs";
export const validator = new CoreContractValidator({ inventory, index });
