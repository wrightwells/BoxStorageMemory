import { describe, expect, it } from "vitest";
import {
  boxDescription,
  photoDescription,
} from "../src/services/discoverability";
import { fixtureLibrary, ITEM } from "./library-fixtures";

describe("ordinary Drive context", () => {
  it("derives readable box and item metadata without exporting extension fields", () => {
    const { inventory } = fixtureLibrary();
    inventory.box.tags = ["Power"];
    inventory.items[0]!.tags = ["Cable"];
    inventory.privateExtension = "do not export";
    expect(boxDescription(inventory)).toContain(
      "BOX-0001\nElectrical Box\nGarage",
    );
    expect(boxDescription(inventory)).toContain("Tags: Power");
    const photo = photoDescription(inventory, ITEM);
    expect(photo).toContain("13A Extension Lead");
    expect(photo).toContain("Tags: Cable");
    expect(photo).toContain(`Item ID: ${ITEM}`);
    expect(photo).not.toContain("do not export");
  });
  it("bounds descriptions while retaining permanent box/item identity", () => {
    const { inventory } = fixtureLibrary();
    inventory.box.name = "x".repeat(2000);
    expect(boxDescription(inventory)).toHaveLength(1000);
    expect(photoDescription(inventory, ITEM)).toHaveLength(1000);
    expect(photoDescription(inventory, ITEM)).toContain(`Item ID: ${ITEM}`);
    expect(() => photoDescription(inventory, "unknown")).toThrow(
      "ITEM_NOT_FOUND",
    );
  });
});
