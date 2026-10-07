import { useEffect, useState } from "react";
import { ClientError, errorMessage } from "../services/errors";
import { useLibrary } from "./StorageProvider";
import { LoadingStatus } from "./LoadingStatus";
import { previewJson } from "./previewJson";

function Failure({ error }: { error: unknown }) {
  return <p role="alert">{errorMessage(error)}</p>;
}

export function LibraryTools() {
  const { library, state } = useLibrary();
  useEffect(() => {
    void library.load();
  }, [library]);
  return (
    <section className="library-tools sub-panel" aria-label="Tools">
      <h2>Tools</h2>
      {state.status === "loading" && (
        <LoadingStatus>Loading box index…</LoadingStatus>
      )}
      {state.error && <Failure error={new ClientError(state.error)} />}
      <button
        className="button secondary"
        onClick={() => void library.load(true)}
        disabled={state.status === "loading" || state.recovering}
      >
        Refresh library
      </button>
      <RecoveryPanel />
    </section>
  );
}

export function RecoveryPanel() {
  const { library, state } = useLibrary();
  const [error, setError] = useState<unknown>();
  const report = state.recovery;
  return (
    <section className="sub-panel">
      <h3>Index recovery</h3>
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
