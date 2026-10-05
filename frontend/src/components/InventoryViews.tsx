import { LoadingStatus } from "./LoadingStatus";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  BoxIndexEntry,
  InventoryItem,
} from "../../../shared/typescript/models";
import type { DriveFile } from "../services/drive";
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
        <Link to="/settings">Account and folder settings</Link>
        <Link className="button secondary" to="/library/new">
          Draft a new box
        </Link>
      </div>
      {initializing && <LoadingStatus>Initializing library…</LoadingStatus>}
      {state.status === "loading" && (
        <LoadingStatus>Loading box index…</LoadingStatus>
      )}
      {state.error && <Failure error={new ClientError(state.error)} />}
      {state.error === "INDEX_MISSING" && (
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
          <ul className="box-grid">
            {state.index.boxes.map((entry) => (
              <BoxCard entry={entry} key={entry.boxId} />
            ))}
          </ul>
        </>
      )}
      <FolderBrowser
        key={`${connection.root.id}:${state.revision}`}
        root={connection.root}
      />
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

function FolderBrowser({ root }: { root: DriveFile }) {
  const { library, state } = useLibrary();
  const [path, setPath] = useState([root]);
  const [folders, setFolders] = useState<DriveFile[]>([]);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const current = path[path.length - 1]!;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFolders([]);
    setError(undefined);
    void library
      .folders(current.id)
      .then((files) => {
        if (active) setFolders(files);
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
  }, [library, current.id, attempt]);
  return (
    <section className="sub-panel">
      <h2>Browse folders</h2>
      <nav aria-label="Library folder path">
        {path.map((folder, index) => (
          <button
            key={folder.id}
            onClick={() => setPath(path.slice(0, index + 1))}
          >
            {folder.name}
          </button>
        ))}
      </nav>
      {loading && <LoadingStatus>Loading library folders…</LoadingStatus>}
      {!!error && (
        <>
          <Failure error={error} />
          <button onClick={() => setAttempt(attempt + 1)}>
            Retry folder browsing
          </button>
        </>
      )}
      {!loading && !error && folders.length === 0 && <p>No subfolders here.</p>}
      <ul className="folder-list">
        {folders.map((folder) => (
          <li key={folder.id}>
            <button onClick={() => setPath([...path, folder])}>
              {folder.name}
            </button>
          </li>
        ))}
      </ul>
      <ul className="box-grid">
        {state.index?.boxes
          .filter((box) => box.driveFolderId === current.id)
          .map((box) => (
            <BoxCard key={box.boxId} entry={box} />
          ))}
      </ul>
    </section>
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
            <pre>{JSON.stringify(report.candidate, null, 2)}</pre>
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
      <Link to="/library">Back to library</Link>
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
          <h2>
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
          <Link to={`/box/${boxId}/edit`}>Edit box and items</Link>
          <Link to={`/box/${boxId}/label`}>QR label</Link>
          <Link to={`/box/${boxId}/tags`}>Manage NFC tags</Link>
          {itemOnly ? (
            item ? (
              <ItemDetails item={item} boxId={boxId} />
            ) : (
              <Failure error={new ClientError("ITEM_NOT_FOUND")} />
            )
          ) : (
            <>
              {!view.inventory.items.length && <p>This box is empty.</p>}
              <ul className="item-list">
                {view.inventory.items.map((item) => (
                  <li key={item.id}>
                    <Link to={`/box/${boxId}/item/${item.id}`}>
                      <strong>{item.name}</strong>
                    </Link>
                    <Link to={`/box/${boxId}/item/${item.id}/photos`}>
                      Manage photographs
                    </Link>
                    <p>Quantity: {item.quantity}</p>
                    <p>{item.description}</p>
                    {!!item.images?.length && (
                      <p>
                        {item.images.length} photographs — open item to view
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {itemOnly && <Link to={`/box/${boxId}`}>Back to box</Link>}
        </>
      )}
    </>
  );
}

function ItemDetails({ item, boxId }: { item: InventoryItem; boxId: string }) {
  return (
    <article>
      <h3>{item.name}</h3>
      <Link to={`/box/${boxId}/item/${item.id}/photos`}>
        Manage photographs
      </Link>
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
        />
      ))}
    </article>
  );
}
export function Photo({
  boxId,
  itemId,
  filename,
}: {
  boxId: string;
  itemId: string;
  filename: string;
}) {
  const { library, state } = useLibrary();
  const [url, setUrl] = useState<string>();
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let owned: string | undefined;
    setUrl(undefined);
    setError(undefined);
    if (requested) {
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
  }, [library, boxId, itemId, filename, requested, state.revision, attempt]);
  return (
    <figure className="item-photo">
      <figcaption>{filename}</figcaption>
      {!url && (
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
          <img src={url} alt={`Item photograph: ${filename}`} />
          <button onClick={() => setRequested(false)}>Close photo</button>
        </>
      )}
    </figure>
  );
}
