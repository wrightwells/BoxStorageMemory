// Model of a candidate atomic primitive, NOT evidence of Drive behaviour.
export class ConditionalStore {
  constructor(document) { this.document = structuredClone(document); this.version = 1; }
  read() { return { document: structuredClone(this.document), version: this.version }; }
  write(version, document) {
    if (version !== this.version) throw new Error("CONFLICT");
    this.document = structuredClone(document);
    this.version++;
  }
}

export function claimNumber(snapshot, boxId) {
  const used = new Set(snapshot.document.boxes.map(b => b.boxNumber));
  let next = 1;
  while (used.has(`BOX-${String(next).padStart(4, "0")}`)) next++;
  if (next > 999999999) throw new Error("BOX_NUMBERS_EXHAUSTED");
  const document = structuredClone(snapshot.document);
  const boxNumber = `BOX-${String(next).padStart(4, "0")}`;
  document.boxes.push({ boxId, boxNumber });
  return { document, boxNumber };
}
