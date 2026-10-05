// Persisted v1 records. Extension fields must survive supported-version edits.
export interface Box {
  id: string;
  number: string;
  name: string;
  created: string;
  modified: string;
  nfcIds: string[];
  description?: string;
  location?: string;
  tags?: string[];
  [extension: string]: unknown;
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  description?: string;
  tags?: string[];
  images?: string[];
  notes?: string;
  [extension: string]: unknown;
}

export interface Inventory {
  schemaVersion: 1;
  box: Box;
  items: InventoryItem[];
  [extension: string]: unknown;
}

export interface BoxIndexEntry {
  boxId: string;
  boxNumber: string;
  name: string;
  driveFolderId: string;
  nfcIds: string[];
  location?: string;
  [extension: string]: unknown;
}

export interface BoxIndex {
  schemaVersion: 1;
  updated: string;
  boxes: BoxIndexEntry[];
  [extension: string]: unknown;
}
