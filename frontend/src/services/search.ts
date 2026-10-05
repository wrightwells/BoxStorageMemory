import type { Inventory } from "../../../shared/typescript/models";
import { ClientError } from "./errors";
import { LibraryService, type LibraryDrive } from "./library";

export interface SearchResult {
  key: string;
  kind: "box" | "item";
  boxId: string;
  boxNumber: string;
  boxName: string;
  location?: string;
  itemId?: string;
  name: string;
  description?: string;
  fields: string[];
}
export interface SearchIssue {
  boxId: string;
  boxNumber: string;
  code: string;
}
export interface SearchState {
  status: "idle" | "loading" | "ready" | "partial" | "error";
  records: SearchResult[];
  issues: SearchIssue[];
  warnings: SearchIssue[];
  loaded: number;
  processed: number;
  total: number;
  revision: number;
  error?: string;
}
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().trim();
export function searchRecords(inventory: Inventory): SearchResult[] {
  const box = inventory.box;
  const fields = [
    box.number,
    box.name,
    box.location ?? "",
    ...(box.tags ?? []),
  ];
  const context = {
    boxId: box.id,
    boxNumber: box.number,
    boxName: box.name,
    location: box.location,
  };
  return [
    {
      ...context,
      key: box.id,
      kind: "box",
      name: box.name,
      description: box.description,
      fields: [...fields, box.description ?? ""].map(normalize),
    },
    ...inventory.items.map((item) => ({
      ...context,
      key: `${box.id}:${item.id}`,
      kind: "item" as const,
      itemId: item.id,
      name: item.name,
      description: item.description,
      fields: [
        ...fields,
        item.name,
        item.description ?? "",
        item.notes ?? "",
        ...(item.tags ?? []),
      ].map(normalize),
    })),
  ];
}
export function matchSearch(records: SearchResult[], query: string) {
  const needle = normalize(query);
  return needle
    ? records.filter((record) =>
        record.fields.some((field) => field.includes(needle)),
      )
    : [];
}

export class SearchService {
  #state: SearchState = {
    status: "idle",
    records: [],
    issues: [],
    warnings: [],
    loaded: 0,
    processed: 0,
    total: 0,
    revision: 0,
  };
  #listeners = new Set<() => void>();
  #epoch = 0;
  #loading?: Promise<void>;
  #library: LibraryService;
  #unsubscribe: () => void;
  constructor(
    private readonly drive: LibraryDrive,
    source: LibraryService,
    private readonly generation: () => number,
  ) {
    // A separate reader avoids cancelling view requests or parallel box workers
    // when a library/box view refreshes its own runtime caches.
    this.#library = new LibraryService(drive, generation);
    let revision = source.getSnapshot().revision;
    this.#unsubscribe = source.subscribe(() => {
      const next = source.getSnapshot().revision;
      if (next !== revision) {
        revision = next;
        this.reset();
      }
    });
  }
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  private update(patch: Partial<SearchState>) {
    this.#state = { ...this.#state, ...patch };
    this.#listeners.forEach((listener) => listener());
  }
  reset() {
    this.#epoch++;
    this.#loading = undefined;
    this.#library.reset();
    this.update({
      status: "idle",
      records: [],
      issues: [],
      warnings: [],
      loaded: 0,
      processed: 0,
      total: 0,
      error: undefined,
      revision: this.#state.revision + 1,
    });
  }
  dispose() {
    this.#unsubscribe();
    this.reset();
    this.#listeners.clear();
  }
  load(refresh = false): Promise<void> {
    if (refresh) this.reset();
    if (this.#loading) return this.#loading;
    if (this.#state.status !== "idle") return Promise.resolve();
    const epoch = this.#epoch,
      generation = this.generation(),
      root = this.drive.root?.id;
    const current = () =>
      epoch === this.#epoch &&
      generation === this.generation() &&
      root === this.drive.root?.id;
    this.update({ status: "loading" });
    const loading = (async () => {
      try {
        await this.#library.load(true);
        if (!current()) return;
        const index = this.#library.getSnapshot().index;
        if (!index)
          throw new ClientError(
            this.#library.getSnapshot().error ?? "INVALID_INDEX",
          );
        this.update({ total: index.boxes.length });
        let cursor = 0;
        await Promise.all(
          Array.from({ length: Math.min(4, index.boxes.length) }, async () => {
            while (current() && cursor < index.boxes.length) {
              const entry = index.boxes[cursor++]!;
              try {
                const view = await this.#library.box(entry.boxId);
                if (!current()) return;
                this.update({
                  records: [
                    ...this.#state.records,
                    ...searchRecords(view.inventory),
                  ],
                  loaded: this.#state.loaded + 1,
                  warnings: [
                    ...this.#state.warnings,
                    ...view.warnings.map((code) => ({
                      boxId: entry.boxId,
                      boxNumber: entry.boxNumber,
                      code,
                    })),
                  ],
                });
              } catch (error) {
                if (!current()) return;
                this.update({
                  issues: [
                    ...this.#state.issues,
                    {
                      boxId: entry.boxId,
                      boxNumber: entry.boxNumber,
                      code:
                        error instanceof ClientError
                          ? error.code
                          : "UNAVAILABLE",
                    },
                  ],
                });
              }
              if (current())
                this.update({ processed: this.#state.processed + 1 });
            }
          }),
        );
        if (current())
          this.update({
            status: this.#state.issues.length ? "partial" : "ready",
          });
      } catch (error) {
        if (current())
          this.update({
            status: "error",
            error: error instanceof ClientError ? error.code : "UNAVAILABLE",
          });
      } finally {
        if (current()) this.#loading = undefined;
      }
    })();
    this.#loading = loading;
    return loading;
  }
}
