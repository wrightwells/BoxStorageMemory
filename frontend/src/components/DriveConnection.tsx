import { LibraryTools } from "./LibraryTools";
import { LoadingStatus } from "./LoadingStatus";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { DriveFile } from "../services/drive";
import { ClientError, errorMessage } from "../services/errors";
import { useStorage } from "./StorageProvider";

export function DriveConnection({
  showLibraryTools = false,
}: {
  showLibraryTools?: boolean;
}) {
  const { session, state } = useStorage();
  const mayDiscard = () =>
    (!session.editing.getSnapshot().dirty && !session.photos.dirty) ||
    window.confirm(
      "Changing the account or library clears unsaved drafts. Discard this draft?",
    );
  const connected = !!state.account;
  return (
    <div className="empty-state" aria-busy={state.loading || state.busy}>
      {state.error && (
        <p role="alert">{errorMessage(new ClientError(state.error))}</p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {state.auth.status === "expired" && (
        <p role="alert">{errorMessage(new ClientError("AUTH_REQUIRED"))}</p>
      )}
      {state.loading && (
        <LoadingStatus>Loading connection settings…</LoadingStatus>
      )}
      {!state.ready && !state.loading && (
        <button
          type="button"
          className="button"
          onClick={() => void session.retryInitialization()}
        >
          Retry connection setup
        </button>
      )}
      {connected ? (
        <>
          <h2>Connected Google account</h2>
          <p>
            {state.account?.name}
            {state.account?.email && ` (${state.account.email})`}
          </p>
          <div className="actions">
            <button
              className="button"
              disabled={state.busy}
              onClick={() => {
                if (mayDiscard()) void session.connect();
              }}
            >
              Switch account
            </button>
            <button
              className="button secondary"
              onClick={() => {
                if (mayDiscard()) session.signOut();
              }}
            >
              Sign out
            </button>
            <button
              className="button secondary"
              onClick={() => {
                if (mayDiscard()) void session.revoke();
              }}
            >
              Revoke Google access
            </button>
          </div>
          <p>
            Sign-out ends local access. Revocation also removes this app’s
            Google grant.
          </p>
          {state.root ? (
            <>
              <h2>Library folder</h2>
              <p>{state.root.name}</p>
              <p>
                {state.root.capabilities?.canAddChildren === false
                  ? "This folder is read-only for this account."
                  : "Your library is connected."}
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  if (mayDiscard()) session.changeRoot();
                }}
              >
                Change library folder
              </button>
              {showLibraryTools && (
                <LibraryTools key={`${state.account?.id}:${state.root.id}`} />
              )}
            </>
          ) : state.busy ? (
            <LoadingStatus>Connecting to Google Drive…</LoadingStatus>
          ) : (
            <RootSetup key={state.revision} />
          )}
        </>
      ) : (
        <>
          <h2>Connect your Google Drive</h2>
          <p>
            Google requests access to your Drive account, including files
            outside this library. Box Storage uses the folder you choose. Access
            tokens stay in this browser’s memory.
          </p>
          <button
            className="button"
            disabled={!state.ready || state.busy || state.loading}
            onClick={() => void session.connect()}
          >
            {state.auth.status === "expired"
              ? "Reconnect Google Drive"
              : "Sign in with Google"}
          </button>
          {state.busy && (
            <LoadingStatus>
              Complete the Google authorization window…
            </LoadingStatus>
          )}
        </>
      )}
    </div>
  );
}

function RootSetup() {
  const { session, state } = useStorage();
  const [path, setPath] = useState([{ id: "root", name: "My Drive" }]);
  const [folders, setFolders] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [folderId, setFolderId] = useState("");
  const [name, setName] = useState("Box Storage");
  const parent = path[path.length - 1]!;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFolders([]);
    setError(undefined);
    void session.drive
      .browseFolders(parent.id, controller.signal)
      .then((files) => {
        if (!controller.signal.aborted) setFolders(files);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session, parent.id, attempt]);
  return (
    <div className="root-setup">
      <h2>Choose a library folder</h2>
      <p>
        Select an existing folder or create an empty folder in My Drive. No
        inventory files will be created yet.
      </p>
      <nav aria-label="Folder path">
        {path.map((part, index) => (
          <button
            type="button"
            key={part.id}
            onClick={() => setPath(path.slice(0, index + 1))}
          >
            {part.name}
          </button>
        ))}
      </nav>
      {parent.id !== "root" && (
        <button
          className="button"
          disabled={state.busy}
          onClick={() => void session.selectRoot(parent.id)}
        >
          Use current folder
        </button>
      )}
      {loading && <LoadingStatus>Loading folders…</LoadingStatus>}
      {error && <p role="alert">{error}</p>}
      {error && (
        <button type="button" onClick={() => setAttempt(attempt + 1)}>
          Retry folder listing
        </button>
      )}
      {!loading && !error && folders.length === 0 && (
        <p>No folders here. Enter a folder ID or create a folder below.</p>
      )}
      <ul className="folder-list">
        {folders.map((folder) => (
          <li key={folder.id}>
            <span>{folder.name}</span>
            <button
              type="button"
              onClick={() =>
                setPath([...path, { id: folder.id, name: folder.name }])
              }
            >
              Browse {folder.name}
            </button>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => void session.selectRoot(folder.id)}
            >
              Use {folder.name}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void session.selectRoot(folderId.trim());
        }}
      >
        <label htmlFor="root-id">
          Google Drive folder ID (including shared folders)
        </label>
        <input
          id="root-id"
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
          required
          autoComplete="off"
        />
        <button className="button secondary" disabled={state.busy}>
          Use folder ID
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void session.createRoot(name);
        }}
      >
        <label htmlFor="root-name">New library folder name</label>
        <input
          id="root-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          required
        />
        <button
          className="button secondary"
          disabled={state.busy || !name.trim()}
        >
          Create library folder
        </button>
      </form>
      <p>
        Your selected folder ID is remembered for this Google account.
        Inventory, photographs and Google tokens are not saved in browser
        storage.
      </p>
    </div>
  );
}

export function LibraryConnection() {
  const { state } = useStorage();
  const location = useLocation();
  if (!state.account)
    return (
      <>
        {state.auth.status === "expired" && (
          <p role="alert">{errorMessage(new ClientError("AUTH_REQUIRED"))}</p>
        )}
        <div className="empty-state">
          <h2>Connect your Google Drive</h2>
          <p>A connected account is needed to open your box records.</p>
          <Link
            className="button"
            to="/login"
            state={{ returnTo: `${location.pathname}${location.search}` }}
          >
            Account setup
          </Link>
        </div>
      </>
    );
  return (
    <>
      <DriveConnection />
      {state.root && (
        <p>
          The library folder is ready. <Link to="/library">Browse boxes</Link>
        </p>
      )}
    </>
  );
}
