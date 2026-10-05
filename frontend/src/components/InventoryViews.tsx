import { LoadingStatus } from "./LoadingStatus";
import { previewJson } from "./previewJson";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  BoxIndexEntry,
  InventoryItem,
} from "../../../shared/typescript/models";
import { ClientError, errorMessage } from "../services/errors";
import type { BoxView } from "../services/library";
import { LibraryConnection } from "./DriveConnection";
import { useLibrary, useStorage } from "./StorageProvider";

function Failure({ error }: { error: unknown }) {
  return <p role="alert">{errorMessage(error)}</p>;
}
function BoxCard({ entry }: { entry: BoxIndexEntry }) {
  return (
    <li className="box-card">
      <Link to={`/box/${entry.boxId}`}>
        <strong>{entry.boxNumber}</strong> <span>{entry.name}</span>
      </Link>
      <p>{entry.location || "Location not recorded"}</p>
    </li>
  );
}

export function LibraryView() {
  const { state } = useStorage();
  if (!state.root) return <LibraryConnection />;
  return <ConnectedLibraryView key={`${state.account?.id}:${state.root.id}`} />;
}

function ConnectedLibraryView() {
  const { session, state: connection } = useStorage();
  const { library, state } = useLibrary();
  const [number, setNumber] = useState("");
  const [groupByLocation, setGroupByLocation] = useState(false);
  const [lookupError, setLookupError] = useState<unknown>();
  const [initializing, setInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<unknown>();
  const navigate = useNavigate();
  useEffect(() => {
    if (connection.root) void library.load();
  }, [library, connection.root]);
  if (!connection.root) return <LibraryConnection />;
  return (
    <>
      <p>
        Library: {connection.root.name}. Connected as {connection.account?.name}
        .
      </p>
      <div className="actions">
        <button
          className="button secondary"
          onClick={() => void library.load(true)}
          disabled={state.status === "loading" || state.recovering}
        >
          Refresh library
        </button>
        <Link className="button secondary" to="/library/new">
          Draft a new box
        </Link>
      </div>
      {initializing && <LoadingStatus>Initializing library…</LoadingStatus>}
      {state.status === "loading" && (
        <LoadingStatus>Loading box index…</LoadingStatus>
      )}
      {state.error && <Failure error={new ClientError(state.error)} />}
      {state.error === "INDEX_MISSING" && state.emptyLibrary === true && (
        <section className="sub-panel">
          <h2>Initialize an empty library</h2>
          <p>
            Create the first index for an empty folder. Existing inventories
            must be reviewed through recovery instead.
          </p>
          {!!initializationError && <Failure error={initializationError} />}
          <button
            disabled={initializing || state.recovering}
            onClick={() => {
              setInitializing(true);
              setInitializationError(undefined);
              void session.drive
                .initializeLibrary()
                .then(() => library.load(true))
                .catch(setInitializationError)
                .finally(() => setInitializing(false));
            }}
          >
            {initializing
              ? "Initializing library…"
              : "Initialize empty library"}
          </button>
        </section>
      )}
      {state.index && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setLookupError(undefined);
              try {
                const entry = library.lookup(number);
                if (!entry) throw new ClientError("BOX_NOT_FOUND");
                navigate(`/box/${entry.boxId}`);
              } catch (error) {
                setLookupError(error);
              }
            }}
            className="number-lookup"
          >
            <label htmlFor="box-number">Find a box number</label>
            <input
              id="box-number"
              placeholder="BOX-0001"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              required
            />
            <button className="button">Open box</button>
          </form>
          {!!lookupError && <Failure error={lookupError} />}
          {!state.index.boxes.length && (
            <p>No boxes are indexed in this library.</p>
          )}
          {!!state.index.boxes.length && (
            <label className="location-group-toggle">
              <input
                type="checkbox"
                checked={groupByLocation}
                onChange={(event) => setGroupByLocation(event.target.checked)}
              />
              Group boxes by location
            </label>
          )}
          <BoxGroups boxes={state.index.boxes} grouped={groupByLocation} />
        </>
      )}
      <RecoveryPanel />
      <p className="read-only-note">
        Browsing is read-only. Your Drive files are not changed.
      </p>
      {session.getSnapshot().error && (
        <Failure error={new ClientError(session.getSnapshot().error!)} />
      )}
    </>
  );
}

function BoxGroups({
  boxes,
  grouped,
}: {
  boxes: BoxIndexEntry[];
  grouped: boolean;
}) {
  if (!grouped)
    return (
      <ul className="box-grid">
        {boxes.map((entry) => (
          <BoxCard key={entry.boxId} entry={entry} />
        ))}
      </ul>
    );
  const groups = new Map<string, BoxIndexEntry[]>();
  for (const box of boxes) {
    const location = box.location?.trim() || "";
    const entries = groups.get(location) ?? [];
    entries.push(box);
    groups.set(location, entries);
  }
  return (
    <>
      {[...groups.entries()]
        .sort(([a], [b]) =>
          a === ""
            ? 1
            : b === ""
              ? -1
              : a.localeCompare(b, undefined, { numeric: true }),
        )
        .map(([location, entries]) => (
          <section
            className="location-group"
            key={location}
            aria-label={location || "Location not recorded"}
          >
            <h2>{location || "Location not recorded"}</h2>
            <ul className="box-grid">
              {entries.map((entry) => (
                <BoxCard key={entry.boxId} entry={entry} />
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}

export function RecoveryPanel() {
  const { library, state } = useLibrary();
  const [error, setError] = useState<unknown>();
  const report = state.recovery;
  return (
    <section className="sub-panel">
      <h2>Index recovery</h2>
      <p>
        Discover inventories inside this library and review a proposed index.
        Unavailable existing records are retained and reported. Original files
        remain unchanged.
      </p>
      <button
        className="button secondary"
        disabled={state.recovering || state.status === "loading"}
        onClick={() => {
          setError(undefined);
          void library.recover().catch(setError);
        }}
      >
        Preview rebuilt index
      </button>
      {state.recovering && (
        <LoadingStatus>Scanning library inventories…</LoadingStatus>
      )}
      {!!error && <Failure error={error} />}
      {report && (
        <>
          <p role="status">
            Found {report.discovered} valid inventories across{" "}
            {report.scans.length} folders. Retained {report.retained}{" "}
            unavailable records.
          </p>
          {report.issues.length > 0 ? (
            <ul className="recovery-issues">
              {report.issues.map((issue, index) => (
                <li key={index}>
                  {errorMessage(new ClientError(issue.code))}
                  {issue.boxNumber && ` (${issue.boxNumber})`}
                  {issue.folderId &&
                    ` — ${report.scans.find((scan) => scan.folder.id === issue.folderId)?.folder.name ?? "Unavailable folder"}`}
                </li>
              ))}
            </ul>
          ) : (
            <p>No duplicate or unavailable records were found.</p>
          )}
          <details>
            <summary>Review proposed index JSON</summary>
            <pre>{previewJson(report.candidate)}</pre>
          </details>
          <p>
            Index replacement is awaiting verified protection against concurrent
            changes. This preview has not been saved to Google Drive.
          </p>
          <button className="button" disabled>
            Replace index after review
          </button>
        </>
      )}
    </section>
  );
}

export function InventoryView({ itemOnly = false }: { itemOnly?: boolean }) {
  const { state: connection } = useStorage();
  const { state } = useLibrary();
  const { boxId, itemId } = useParams();
  if (!connection.root) return <LibraryConnection />;
  return (
    <ConnectedInventoryView
      key={`${connection.account?.id}:${connection.root.id}:${state.revision}:${boxId}:${itemId}`}
      itemOnly={itemOnly}
    />
  );
}

function ConnectedInventoryView({ itemOnly }: { itemOnly: boolean }) {
  const { boxId = "", itemId = "" } = useParams();
  const { state: connection } = useStorage();
  const { library, state } = useLibrary();
  const [view, setView] = useState<BoxView>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setView(undefined);
    setError(undefined);
    setLoading(true);
    if (connection.root)
      void library
        .box(boxId)
        .then((result) => {
          if (active) setView(result);
        })
        .catch((error) => {
          if (active) setError(error);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
    };
  }, [library, boxId, connection.root, state.revision, attempt]);
  if (!connection.root) return <LibraryConnection />;
  const item = view?.inventory.items.find((item) => item.id === itemId);
  return (
    <>
      <Link to={itemOnly ? `/box/${boxId}` : "/library"}>
        {itemOnly ? "Back to box" : "Back to library"}
      </Link>
      <button
        className="button secondary"
        disabled={loading}
        onClick={() => {
          setView(undefined);
          setError(undefined);
          void library.load(true);
          setAttempt(attempt + 1);
        }}
      >
        Refresh box
      </button>
      {loading && <LoadingStatus>Loading inventory…</LoadingStatus>}
      {!!error && (
        <>
          <Failure error={error} />
          <p>
            Review the original files in Google Drive or use the library’s index
            recovery preview. No file has been changed.
          </p>
        </>
      )}
      {view && (
        <>
          <h2 className="record-title">
            {view.inventory.box.number} · {view.inventory.box.name}
          </h2>
          <p>{view.inventory.box.location || "Location not recorded"}</p>
          <p>{view.inventory.box.description}</p>
          <p>Drive folder: {view.folder.name}</p>
          {view.warnings.map((warning) => (
            <Failure key={warning} error={new ClientError(warning)} />
          ))}
          <p className="read-only-note">
            Read-only inventory. Refresh to check for changes made in Google
            Drive.
          </p>
          <div className="actions box-actions">
            <Link className="button" to={`/box/${boxId}/edit`}>
              Edit box and items
            </Link>
            {!itemOnly && (
              <>
                <Link className="button secondary" to={`/box/${boxId}/label`}>
                  QR label
                </Link>
                <Link className="button secondary" to={`/box/${boxId}/tags`}>
                  Manage NFC tags
                </Link>
              </>
            )}
          </div>
          {itemOnly ? (
            item ? (
              <ItemDetails item={item} boxId={boxId} />
            ) : (
              <Failure error={new ClientError("ITEM_NOT_FOUND")} />
            )
          ) : (
            <>
              {!view.inventory.items.length && <p>This box is empty.</p>}
              {!!view.inventory.items.length && (
                <div className="inventory-table-scroll">
                  <table
                    className="box-items-table"
                    aria-label="Box inventory items"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col">Quantity</th>
                        <th scope="col">Description</th>
                        <th scope="col">Photographs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.inventory.items.map((item) => (
                        <tr key={item.id}>
                          <th scope="row">
                            <Link to={`/box/${boxId}/item/${item.id}`}>
                              {item.name}
                            </Link>
                          </th>
                          <td>{item.quantity}</td>
                          <td>{item.description}</td>
                          <td>
                            <PhotoButton item={item} boxId={boxId} />
                            {!!item.images?.length && (
                              <p>
                                {item.images.length} photographs — open item to
                                view
                              </p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function PhotoButton({ item, boxId }: { item: InventoryItem; boxId: string }) {
  return (
    <Link
      className="button secondary photo-action"
      to={`/box/${boxId}/item/${item.id}/photos`}
      aria-label="Manage photographs"
      title={`Manage photographs for ${item.name}`}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 5-5 4 4 4-6 5 7" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
function ItemDetails({ item, boxId }: { item: InventoryItem; boxId: string }) {
  return (
    <article>
      <h3 className="record-title">{item.name}</h3>
      {!item.images?.length && <PhotoButton item={item} boxId={boxId} />}
      <p>Quantity: {item.quantity}</p>
      <p>{item.description}</p>
      <p>{item.notes}</p>
      {!!item.tags?.length && <p>Tags: {item.tags.join(", ")}</p>}
      {!item.images?.length && <p>No photographs for this item.</p>}
      {item.images?.map((filename) => (
        <Photo
          key={filename}
          boxId={boxId}
          itemId={item.id}
          filename={filename}
          autoLoad
          linkToManagement
        />
      ))}
    </article>
  );
}
export function Photo({
  boxId,
  itemId,
  filename,
  autoLoad = false,
  linkToManagement = false,
}: {
  boxId: string;
  itemId: string;
  filename: string;
  autoLoad?: boolean;
  linkToManagement?: boolean;
}) {
  const { library, state } = useLibrary();
  const [url, setUrl] = useState<string>();
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(autoLoad);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let owned: string | undefined;
    setUrl(undefined);
    setError(undefined);
    if (autoLoad || requested) {
      setLoading(true);
      void library
        .photo(boxId, itemId, filename)
        .then((photo) => {
          if (active) {
            owned = photo;
            setUrl(photo);
          } else library.releasePhoto(photo);
        })
        .catch((error) => {
          if (active) setError(error);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
      if (owned) library.releasePhoto(owned);
    };
  }, [
    library,
    boxId,
    itemId,
    filename,
    autoLoad,
    requested,
    state.revision,
    attempt,
  ]);
  return (
    <figure className="item-photo">
      <figcaption>{filename}</figcaption>
      {!url && (!autoLoad || !!error) && (
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => {
            setRequested(true);
            setAttempt(attempt + 1);
          }}
        >
          {error ? "Retry photo" : "Load photo"}
        </button>
      )}
      {loading && <LoadingStatus>Loading photograph…</LoadingStatus>}
      {!!error && <Failure error={error} />}
      {url && (
        <>
          {linkToManagement ? (
            <Link
              className="photo-management-link"
              to={`/box/${boxId}/item/${itemId}/photos`}
              aria-label="Manage photographs"
              title="Manage photographs"
            >
              <img src={url} alt={`Item photograph: ${filename}`} />
            </Link>
          ) : (
            <img src={url} alt={`Item photograph: ${filename}`} />
          )}
          {!autoLoad && (
            <button onClick={() => setRequested(false)}>Close photo</button>
          )}
        </>
      )}
    </figure>
  );
}
