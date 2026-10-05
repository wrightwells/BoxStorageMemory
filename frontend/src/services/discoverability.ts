import type { Inventory } from "../../../shared/typescript/models";

// Plain, derived context for ordinary Drive metadata; never an authoritative
// second inventory. Existing photos are not silently renamed or rewritten.
export function boxDescription(inventory: Inventory) {
  const box = inventory.box;
  return [
    box.number,
    box.name,
    box.location,
    box.description,
    box.tags?.length ? `Tags: ${box.tags.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);
}
export function photoDescription(inventory: Inventory, itemId: string) {
  const item = inventory.items.find((item) => item.id === itemId);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  return [
    inventory.box.number,
    `Item ID: ${item.id}`,
    inventory.box.name,
    inventory.box.location,
    item.name,
    item.description,
    item.tags?.length ? `Tags: ${item.tags.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);
}
