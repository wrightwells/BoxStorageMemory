import { normalizeNfc } from "../../../shared/typescript/contract-core";
import type { BoxIndexEntry } from "../../../shared/typescript/models";
import type { ApiClient } from "./api";
import {
  EditingService,
  type EditingDrive,
  type OperationResult,
} from "./editing";
import { LibraryService, type LibraryDrive } from "./library";
import { ClientError } from "./errors";

export interface TagReview {
  uid: string;
  owner?: BoxIndexEntry;
  boxes: BoxIndexEntry[];
}
export interface TagResult {
  complete: boolean;
  steps: { boxId: string; result: OperationResult }[];
  code?: string;
}
export class NfcService {
  #epoch = 0;
  #busy = false;
  #editor?: EditingService;
  #reader: LibraryService;
  constructor(
    private readonly drive: EditingDrive & LibraryDrive,
    private readonly library: LibraryService,
    private readonly api: Pick<ApiClient, "validate">,
    private readonly generation: () => number,
    private readonly enabled: () => boolean,
    private readonly otherDirty: () => boolean,
  ) {
    this.#reader = new LibraryService(drive, generation);
  }
  reset() {
    this.#epoch++;
    this.#busy = false;
    this.#editor?.reset();
    this.#reader.reset();
  }
  private fence() {
    const epoch = this.#epoch,
      generation = this.generation(),
      root = this.drive.root?.id;
    return () => {
      if (
        epoch !== this.#epoch ||
        generation !== this.generation() ||
        root !== this.drive.root?.id
      )
        throw new ClientError("CONTEXT_CHANGED");
    };
  }
  async review(value: string): Promise<TagReview> {
    if (!this.enabled()) throw new ClientError("NFC_UNAVAILABLE");
    let uid: string;
    try {
      uid = normalizeNfc(value);
    } catch {
      throw new ClientError("INVALID_NFC_ID");
    }
    const check = this.fence();
    const report = await this.#reader.recover();
    check();
    if (!report.complete)
      throw new ClientError(
        report.issues.some((i) => i.code === "DUPLICATE_NFC_ID")
          ? "DUPLICATE_NFC_ID"
          : "RECOVERY_INCOMPLETE",
      );
    const boxes = report.candidate.boxes;
    return { uid, owner: boxes.find((box) => box.nfcIds.includes(uid)), boxes };
  }
  async assign(
    value: string,
    boxId: string,
    options: { confirmed: boolean; moveConfirmed: boolean; replace: boolean },
  ): Promise<TagResult> {
    if (!options.confirmed) throw new ClientError("CONFIRMATION_REQUIRED");
    return this.change(value, boxId, options);
  }
  async remove(value: string, boxId: string, confirmed: boolean) {
    if (!confirmed) throw new ClientError("CONFIRMATION_REQUIRED");
    return this.change(value, boxId);
  }
  private async change(
    value: string,
    boxId: string,
    options?: { moveConfirmed: boolean; replace: boolean },
  ): Promise<TagResult> {
    if (this.#busy || this.otherDirty()) throw new ClientError("EDIT_BUSY");
    if (!this.enabled()) throw new ClientError("NFC_UNAVAILABLE");
    this.drive.assertWritesAvailable(); // Also gates cross-client tag/creation coordination.
    this.#busy = true;
    const epoch = this.#epoch,
      check = this.fence();
    const outcome: TagResult = { complete: false, steps: [] };
    try {
      const review = await this.review(value);
      check();
      if (!review.boxes.some((box) => box.boxId === boxId))
        throw new ClientError("BOX_NOT_FOUND");
      if (!options && review.owner?.boxId !== boxId)
        throw new ClientError("NFC_NOT_ASSIGNED");
      if (
        options &&
        review.owner &&
        review.owner.boxId !== boxId &&
        !options.moveConfirmed
      )
        throw new ClientError("NFC_MOVE_CONFIRMATION_REQUIRED");
      const save = async (
        id: string,
        transform: (ids: string[]) => string[],
      ) => {
        const editor = new EditingService(
          this.drive,
          this.library,
          this.api,
          this.generation,
        );
        this.#editor = editor;
        await editor.open(id, true);
        check();
        const draft = editor.getSnapshot().draft;
        if (!draft)
          throw new ClientError(
            editor.getSnapshot().error ?? "INVENTORY_MISSING",
          );
        const ids = draft.document.box.nfcIds;
        const next = transform(ids);
        if (JSON.stringify(next) === JSON.stringify(ids)) return;
        editor.nfcIds(next);
        const result = await editor.save();
        check();
        if (!result)
          throw new ClientError(
            editor.getSnapshot().error ?? "INVALID_INVENTORY",
          );
        outcome.steps.push({ boxId: id, result });
        if (result.outcome !== "complete")
          throw new ClientError(result.code ?? "AMBIGUOUS_WRITE");
      };
      if (options && review.owner && review.owner.boxId !== boxId) {
        await save(review.owner.boxId, (ids) =>
          ids.filter((id) => id !== review.uid),
        );
        // Old authority and its index are confirmed before the new association.
        const fresh = await this.review(review.uid);
        check();
        if (fresh.owner) throw new ClientError("DUPLICATE_NFC_ID");
      }
      await save(boxId, (ids) =>
        options
          ? options.replace
            ? [review.uid]
            : [...new Set([...ids, review.uid])]
          : ids.filter((id) => id !== review.uid),
      );
      const final = await this.review(review.uid);
      check();
      if (options ? final.owner?.boxId !== boxId : !!final.owner)
        throw new ClientError("READ_CONFLICT");
      outcome.complete = true;
    } catch (error) {
      check();
      outcome.code =
        error instanceof ClientError ? error.code : "AMBIGUOUS_WRITE";
    } finally {
      if (epoch === this.#epoch) {
        this.#busy = false;
        this.library.reset();
      }
    }
    return outcome;
  }
}
