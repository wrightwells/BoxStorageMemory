import { BoxIcon } from "./BoxIcon";
import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { BoxView } from "../services/library";
import { ClientError, errorMessage } from "../services/errors";
import { InventoryThumbnail } from "./PhotoRecognition";

function ActionIcon({ kind }: { kind: "edit" | "remove" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "edit" ? (
        <path d="m14 4 6 6 M4 20l4-1L20 7l-4-4L4 15z" />
      ) : (
        <path d="M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7" />
      )}
    </svg>
  );
}
export function ReferenceBoxView({
  view,
  refresh,
}: {
  view: BoxView;
  refresh: () => void;
}) {
  const { box, items } = view.inventory;
  const [tab, setTab] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const labels = [`Items (${items.length})`, "Details", "Files"];
  const select = (next: number) => {
    setTab(next);
    window.boxStorageReferenceUx?.record("boxTabChanged");
  };
  return (
    <div className="reference-box-view">
      {view.warnings.map((warning) => (
        <p role="alert" key={warning}>
          {errorMessage(new ClientError(warning))}
        </p>
      ))}
      <nav className="reference-breadcrumb" aria-label="Breadcrumb">
        <Link to="/library">Boxes</Link>
        <span aria-hidden="true">›</span>
        <span>{box.name}</span>
      </nav>
      <header className="reference-box-heading">
        <BoxIcon className="reference-box-icon" />
        <div className="reference-box-identity">
          <h1>{box.name}</h1>
          <p>{box.location || "Location not recorded"}</p>
          <p>
            <strong>{box.number}</strong>
            <span aria-hidden="true"> · </span>
            {items.length} {items.length === 1 ? "item" : "items"}
            <span aria-hidden="true"> · </span>Updated{" "}
            <time dateTime={box.modified}>
              {new Date(box.modified).toLocaleDateString()}
            </time>
          </p>
        </div>
        <div className="reference-primary-actions">
          <Link className="button secondary" to={`/box/${box.id}/label`}>
            QR label
          </Link>
          <Link className="button secondary" to={`/box/${box.id}/edit`}>
            <ActionIcon kind="edit" />
            Edit Box
          </Link>
          <Link
            className="button"
            to={`/box/${box.id}/edit`}
            state={{ addItem: true }}
            onClick={() =>
              window.boxStorageReferenceUx?.record("addItemOpened")
            }
          >
            Add Item
          </Link>
        </div>
      </header>
      <div className="reference-tabs" role="tablist" aria-label="Box sections">
        {labels.map((label, index) => (
          <button
            key={label}
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === index}
            tabIndex={tab === index ? 0 : -1}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            onClick={() => select(index)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % labels.length
                  : event.key === "ArrowLeft"
                    ? (index + labels.length - 1) % labels.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? labels.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                select(next);
                tabs.current[next]?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <section
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 0 && (
          <>
            {!items.length ? (
              <div className="reference-empty">
                <h2>This box is empty</h2>
                <p>Add an item to start recording its contents.</p>
                <Link
                  className="button"
                  to={`/box/${box.id}/edit`}
                  state={{ addItem: true }}
                >
                  Add Item
                </Link>
              </div>
            ) : (
              <div
                className="inventory-table-scroll"
                tabIndex={0}
                aria-label="Scrollable box inventory"
              >
                <table
                  className="reference-items-table"
                  aria-label="Box inventory items"
                >
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Photo</th>
                      <th scope="col">Description</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <th scope="row">
                          <Link to={`/box/${box.id}/item/${item.id}`}>
                            {item.name}
                          </Link>
                        </th>
                        <td>
                          {item.images?.[0] ? (
                            <div className="inventory-photo-gallery">
                              {item.images.map((filename) => (
                                <InventoryThumbnail
                                  key={filename}
                                  boxId={box.id}
                                  itemId={item.id}
                                  filename={filename}
                                  name={item.name}
                                  fullPhoto
                                />
                              ))}
                            </div>
                          ) : (
                            <Link
                              className="reference-no-photo"
                              to={`/box/${box.id}/item/${item.id}/photos`}
                            >
                              Add photo
                            </Link>
                          )}
                        </td>
                        <td>{item.description || "—"}</td>
                        <td>{item.quantity}</td>
                        <td>
                          <div className="reference-row-actions">
                            <Link
                              className="button secondary"
                              to={`/box/${box.id}/edit`}
                              state={{ focusItemId: item.id }}
                              aria-label={`Edit item: ${item.name}`}
                              title="Edit item"
                              onClick={() =>
                                window.boxStorageReferenceUx?.record(
                                  "rowEditOpened",
                                )
                              }
                            >
                              <ActionIcon kind="edit" />
                            </Link>
                            <Link
                              className="button secondary reference-remove"
                              to={`/box/${box.id}/edit`}
                              state={{ focusItemId: item.id }}
                              aria-label={`Review removal: ${item.name}`}
                              title="Review removal in editor"
                            >
                              <ActionIcon kind="remove" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {tab === 1 && (
          <div className="reference-details">
            <h2>Box details</h2>
            <dl>
              <dt>Box number</dt>
              <dd>{box.number}</dd>
              <dt>Location</dt>
              <dd>{box.location || "Location not recorded"}</dd>
              <dt>Description</dt>
              <dd>{box.description || "No description recorded"}</dd>
              <dt>Tags</dt>
              <dd>{box.tags?.join(", ") || "No tags"}</dd>
              <dt>Created</dt>
              <dd>{new Date(box.created).toLocaleString()}</dd>
              <dt>Updated</dt>
              <dd>{new Date(box.modified).toLocaleString()}</dd>
            </dl>
            <div className="actions">
              <Link className="button secondary" to={`/box/${box.id}/tags`}>
                Manage NFC tags
              </Link>
            </div>
          </div>
        )}
        {tab === 2 && (
          <div className="reference-files">
            <h2>Files in Google Drive</h2>
            <p>
              Open this box’s Drive folder to view its inventory and photograph
              files.
            </p>
            <a
              className="button secondary"
              href={`https://drive.google.com/drive/folders/${view.folder.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Drive folder
            </a>
          </div>
        )}
      </section>
      <div className="reference-secondary-actions">
        <button className="button secondary" onClick={refresh}>
          Refresh box
        </button>
        <Link to="/library">Back to library</Link>
      </div>
    </div>
  );
}
