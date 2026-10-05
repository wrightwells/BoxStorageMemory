import { LoadingStatus } from "./LoadingStatus";
import { previewJson } from "./previewJson";
import { useEffect, useState } from "react";
import {
  Link,
  useBlocker,
  useParams,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { InventoryItem } from "../../../shared/typescript/models";
import { ClientError, errorMessage } from "../services/errors";
import { LibraryConnection } from "./DriveConnection";
import { useEditing, usePhotos, useStorage } from "./StorageProvider";

const leaveMessage =
  "You have unsaved changes. Leave this page? Photo previews and operation recovery details are discarded on leaving. This draft stays in memory until another editor is opened or the account/library changes.";
function RouterDraftBlocker() {
  const { state } = useEditing();
  const { photos } = usePhotos();
  const blocker = useBlocker(state.dirty || photos.dirty);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm(leaveMessage)) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  return null;
}
export function UnsavedChangesGuard({
  dataRouter = false,
}: {
  dataRouter?: boolean;
}) {
  const { state } = useEditing();
  const { photos, state: photoState } = usePhotos();
  useEffect(() => {
    if (!state.dirty && !photos.dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(leaveMessage)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    if (!dataRouter) document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [state.dirty, photos, photoState, dataRouter]);
  return dataRouter ? <RouterDraftBlocker /> : null;
}

export function EditingView({ create = false }: { create?: boolean }) {
  const { state } = useStorage();
  const { boxId } = useParams();
  if (!state.root) return <LibraryConnection />;
  return (
    <ConnectedEditor
      key={`${state.account?.id}:${state.root.id}:${create ? "new" : boxId}`}
      create={create}
    />
  );
}
function ConnectedEditor({ create }: { create: boolean }) {
  const { boxId } = useParams();
  const { editing, state } = useEditing();
  const location = useLocation();
  const navigate = useNavigate();
  const { photos } = usePhotos();
  const [photoItem, setPhotoItem] = useState<{
    boxId: string;
    itemId: string;
  }>();
  const [error, setError] = useState<unknown>();
  const [validated, setValidated] = useState(false);
  const draft = state.draft;
  useEffect(() => {
    void editing.open(create ? undefined : boxId).catch(setError);
  }, [editing, boxId, create]);
  useEffect(() => {
    const itemId = location.state?.focusItemId;
    if (
      typeof itemId !== "string" ||
      !draft?.document.items.some((item) => item.id === itemId)
    )
      return;
    const input = document.getElementById(`name-${itemId}`);
    input?.focus();
  }, [draft?.document.box.id, location.state]);
  useEffect(() => {
    setValidated(false);
  }, [draft?.document]);
  useEffect(() => {
    if (
      photoItem &&
      !state.busy &&
      !state.dirty &&
      draft?.document.box.id === photoItem.boxId
    ) {
      // Returning from photographs must load the saved inventory, including new images.
      editing.reset();
      navigate(`/box/${photoItem.boxId}/item/${photoItem.itemId}/photos`);
    }
  }, [
    photoItem,
    state.busy,
    state.dirty,
    draft?.document.box.id,
    navigate,
    editing,
  ]);
  const addPhoto = async (itemId: string) => {
    if (!draft) return;
    const target = { boxId: draft.document.box.id, itemId };
    if (state.dirty || (create && state.result?.outcome !== "complete")) {
      const result = await editing.save();
      if (result?.outcome !== "complete") return;
    }
    const current = editing.getSnapshot();
    if (
      current.draft?.document.box.id === target.boxId &&
      current.draft.document.items.some((item) => item.id === itemId) &&
      !current.dirty
    )
      setPhotoItem(target);
  };
  const act = (action: () => void | Promise<unknown>) => {
    setError(undefined);
    try {
      void Promise.resolve(action()).catch(setError);
    } catch (error) {
      setError(error);
    }
  };
  const ready =
    draft &&
    (create
      ? draft.kind === "create"
      : draft.kind === "edit" && draft.document.box.id === boxId);
  const disabled = state.busy || state.locked || draft?.readOnly;
  const savingAvailable = create
    ? editing.creationAvailable
    : editing.editingAvailable;
  return (
    <>
      <Link to="/library">Back to library</Link>
      {state.status === "loading" && (
        <LoadingStatus>Loading editable record…</LoadingStatus>
      )}
      {state.busy && <LoadingStatus>Working on your box…</LoadingStatus>}
      {(error || state.error) && (
        <p role="alert">
          {errorMessage(error || new ClientError(state.error!))}
        </p>
      )}
      {state.status === "error" && (
        <button
          onClick={() =>
            act(() => editing.open(create ? undefined : boxId, true))
          }
        >
          Retry loading editor
        </button>
      )}
      {ready && (
        <>
          <p>
            Permanent number: <strong>{draft.document.box.number}</strong>
          </p>
          {create && (
            <p>
              This number is a proposal. It is reserved only after a successful
              conditional index claim. No Drive folder has been created.
            </p>
          )}
          {!savingAvailable && (
            <p role="status">
              Saving existing boxes is awaiting Drive concurrency verification.
              You can edit and validate an in-memory draft; no changes will be
              saved.
            </p>
          )}
          {draft.readOnly && (
            <p role="alert">
              This account has insufficient Drive permissions to update this
              record. The editor is read-only.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              act(() => editing.save());
            }}
          >
            <fieldset disabled={disabled}>
              <legend>Box details</legend>
              <label htmlFor="edit-box-name">Box name</label>
              <input
                id="edit-box-name"
                value={draft.document.box.name}
                onChange={(event) =>
                  act(() => editing.box({ name: event.target.value }))
                }
                required
              />
              <label htmlFor="edit-box-location">Location</label>
              <input
                id="edit-box-location"
                value={draft.document.box.location ?? ""}
                onChange={(event) =>
                  act(() => editing.box({ location: event.target.value }))
                }
              />
              <label htmlFor="edit-box-description">Box description</label>
              <textarea
                id="edit-box-description"
                value={draft.document.box.description ?? ""}
                onChange={(event) =>
                  act(() => editing.box({ description: event.target.value }))
                }
              />
              <label htmlFor="edit-box-tags">Box tags (one per line)</label>
              <textarea
                id="edit-box-tags"
                value={draft.document.box.tags?.join("\n") ?? ""}
                onChange={(event) =>
                  act(() =>
                    editing.box({
                      tags: event.target.value
                        .split("\n")
                        .filter((tag) => tag.trim()),
                    }),
                  )
                }
              />
            </fieldset>
            <h2>Inventory items</h2>
            {!draft.document.items.length && <p>This draft has no items.</p>}
            {!!draft.document.items.length && (
              <div
                className="inventory-table-scroll"
                tabIndex={0}
                aria-label="Scrollable inventory items"
              >
                <table
                  className="inventory-editor-table"
                  aria-label="Inventory items"
                >
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Details and photos</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.document.items.map((item) => (
                      <ItemEditor
                        key={item.id}
                        item={item}
                        disabled={!!disabled}
                        photoDisabled={
                          state.busy ||
                          !!draft.readOnly ||
                          !photos.writesAvailable ||
                          (state.locked &&
                            state.result?.outcome !== "complete") ||
                          ((state.dirty || create) && !savingAvailable)
                        }
                        newItem={
                          !draft.original.items.some(
                            (original) => original.id === item.id,
                          )
                        }
                        addPhoto={() => act(() => addPhoto(item.id))}
                        act={act}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p>
              Add photo saves any current box changes before opening the item’s
              photographs.
            </p>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                act(() => {
                  editing.addItem();
                })
              }
            >
              Add item
            </button>
            <p>
              Deleting an item removes its inventory entry when saved. Its photo
              files remain in Drive, including shared references; photo cleanup
              belongs to the photograph management workflow.
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  act(async () => {
                    setValidated(await editing.validate());
                  })
                }
              >
                Validate draft
              </button>
              <button
                type="submit"
                disabled={
                  disabled || !savingAvailable || (!create && !state.dirty)
                }
              >
                {create ? "Create box" : "Save changes"}
              </button>
              <button
                type="button"
                disabled={state.busy}
                onClick={() => {
                  if (
                    !state.dirty ||
                    window.confirm(
                      "Discard this in-memory draft and reload the current Drive records?",
                    )
                  )
                    act(() => editing.open(create ? undefined : boxId, true));
                }}
              >
                Reload current records
              </button>
            </div>
          </form>
          {state.dirty && (
            <p role="status">
              Unsaved changes — held only in this account/library’s memory.
            </p>
          )}
          {validated && (
            <p role="status">
              Draft passed local and application API validation. It has not been
              saved.
            </p>
          )}
          {!!state.issues.length && (
            <div role="alert">
              <p>Review these validation errors:</p>
              <ul>
                {state.issues.map((issue, i) => (
                  <li key={i}>
                    {issue.path || "/"}: {issue.code}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details>
            <summary>Review draft JSON</summary>
            <pre>{previewJson(draft.document)}</pre>
          </details>
          {state.result && (
            <section className="sub-panel" aria-label="Save result">
              <h2>
                {state.result.outcome === "complete"
                  ? "Save verified"
                  : "Save not completed"}
              </h2>
              <p
                role={state.result.outcome === "complete" ? "status" : "alert"}
              >
                {state.result.code
                  ? errorMessage(new ClientError(state.result.code))
                  : "The expected Drive inventory, index and folder state was verified."}
              </p>
              <p>
                Outcome: {state.result.outcome}. Last phase:{" "}
                {state.result.phase}.
              </p>
              {state.result.folderId && (
                <p>Drive folder ID: {state.result.folderId}</p>
              )}
              <ul>
                {state.result.steps.map((step, i) => (
                  <li key={i}>
                    {step.phase}: {step.status}
                    {step.fileId ? ` (${step.fileId})` : ""}
                  </li>
                ))}
              </ul>
              {state.result.outcome !== "complete" && (
                <>
                  <p>
                    Confirmed steps may already be in Drive. An uncertain
                    request may have succeeded. Review current files before
                    another attempt; this operation will not be retried
                    automatically.
                  </p>
                  <button
                    disabled={state.busy}
                    onClick={() => act(() => editing.reviewOperation())}
                  >
                    Review current Drive state
                  </button>
                  <Link to="/library">Open recovery preview</Link>
                </>
              )}
            </section>
          )}
          {state.inspection && (
            <details open>
              <summary>Current Drive state for review</summary>
              <pre>{previewJson(state.inspection)}</pre>
            </details>
          )}
          {state.reconciliation && (
            <>
              <p>
                Reconciliation uses the freshly read authoritative inventory. It
                updates derived index metadata and folder naming, preserving
                other index entries. It does not replay this draft or complete a
                pending creation.
              </p>
              <button
                disabled={
                  state.busy ||
                  !editing.writesAvailable ||
                  state.reconciliation.readOnly
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "Update the index and folder name from the reviewed current inventory?",
                    )
                  )
                    act(() => editing.reconcile(true));
                }}
              >
                Reconcile reviewed metadata
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}
function ItemEditor({
  item,
  disabled,
  photoDisabled,
  newItem,
  addPhoto,
  act,
}: {
  item: InventoryItem;
  disabled: boolean;
  photoDisabled: boolean;
  newItem: boolean;
  addPhoto: () => void;
  act: (action: () => void | Promise<unknown>) => void;
}) {
  const { editing } = useEditing();
  const [expanded, setExpanded] = useState(newItem);
  return (
    <tr className="item-editor">
      <td>
        <label htmlFor={`name-${item.id}`}>Item name</label>
        <input
          disabled={disabled}
          id={`name-${item.id}`}
          value={item.name}
          onChange={(event) =>
            act(() => editing.item(item.id, { name: event.target.value }))
          }
          required
        />
      </td>
      <td>
        <label htmlFor={`quantity-${item.id}`}>Quantity</label>
        <input
          disabled={disabled}
          id={`quantity-${item.id}`}
          type="number"
          min="0"
          max="9007199254740991"
          step="1"
          value={Number.isFinite(item.quantity) ? item.quantity : ""}
          onChange={(event) =>
            act(() =>
              editing.item(item.id, {
                quantity:
                  event.target.value === "" ? NaN : Number(event.target.value),
              }),
            )
          }
          required
        />
      </td>
      <td>
        <details
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>Description, tags, notes and photos</summary>
          <div className="item-expanded-fields">
            <label htmlFor={`description-${item.id}`}>Item description</label>
            <textarea
              disabled={disabled}
              id={`description-${item.id}`}
              value={item.description ?? ""}
              onChange={(event) =>
                act(() =>
                  editing.item(item.id, { description: event.target.value }),
                )
              }
            />
            <label htmlFor={`tags-${item.id}`}>Item tags (one per line)</label>
            <textarea
              disabled={disabled}
              id={`tags-${item.id}`}
              value={item.tags?.join("\n") ?? ""}
              onChange={(event) =>
                act(() =>
                  editing.item(item.id, {
                    tags: event.target.value
                      .split("\n")
                      .filter((tag) => tag.trim()),
                  }),
                )
              }
            />
            <label htmlFor={`notes-${item.id}`}>Notes</label>
            <textarea
              disabled={disabled}
              id={`notes-${item.id}`}
              value={item.notes ?? ""}
              onChange={(event) =>
                act(() => editing.item(item.id, { notes: event.target.value }))
              }
            />
            <p>{item.images?.length ?? 0} photographs</p>
            <button type="button" disabled={photoDisabled} onClick={addPhoto}>
              Add photo
            </button>
          </div>
        </details>
      </td>
      <td>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (
              window.confirm(
                `Delete ${item.name || "this item"} from the draft? Its ${item.images?.length ?? 0} photo references will be removed when saved, but all photo files will remain in Drive. Shared or unrelated photos will not be deleted.`,
              )
            )
              act(() => editing.removeItem(item.id, true));
          }}
        >
          Delete item
        </button>
      </td>
    </tr>
  );
}
