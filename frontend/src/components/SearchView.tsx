import { Spinner } from "./LoadingStatus";
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClientError, errorMessage } from "../services/errors";
import { matchSearch } from "../services/search";
import { LibraryConnection } from "./DriveConnection";
import { useSearch, useStorage } from "./StorageProvider";

export function SearchView() {
  const { state } = useStorage();
  if (!state.root) return <LibraryConnection />;
  return <ConnectedSearch key={`${state.account?.id}:${state.root.id}`} />;
}
function ConnectedSearch() {
  const { search, state } = useSearch();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  useEffect(() => {
    if (state.status === "idle") void search.load();
  }, [search, state.status, state.revision]);
  const matches = useMemo(
    () =>
      matchSearch(state.records, query).sort(
        (a, b) =>
          a.boxNumber.localeCompare(b.boxNumber) ||
          a.kind.localeCompare(b.kind) ||
          a.name.localeCompare(b.name),
      ),
    [state.records, query],
  );
  return (
    <>
      <label htmlFor="storage-query">Search boxes and items</label>
      <input
        id="storage-query"
        type="search"
        value={query}
        maxLength={500}
        placeholder="Box number, item description, tags or notes"
        onChange={(event) => {
          const next = new URLSearchParams(params);
          if (event.target.value) next.set("q", event.target.value);
          else next.delete("q");
          setParams(next, { replace: true });
        }}
      />
      <button
        disabled={state.status === "loading"}
        onClick={() => void search.load(true)}
      >
        Refresh search
      </button>
      <p>
        Search uses current inventories for the boxes in your library index.
        Refresh to check external Drive changes. Use library recovery to
        discover unindexed boxes.
      </p>
      <p role="status">
        {state.status === "loading" && <Spinner />}
        {state.status === "loading"
          ? `Search is incomplete while loading: ${state.processed} of ${state.total} boxes checked.`
          : state.status === "partial"
            ? `Search is incomplete: ${state.loaded} of ${state.total} boxes available.`
            : state.status === "ready"
              ? `Search ready: ${state.loaded} indexed boxes loaded.`
              : "Search is not ready."}
      </p>
      {state.error && (
        <p role="alert">{errorMessage(new ClientError(state.error))}</p>
      )}
      {!!state.issues.length && (
        <section>
          <h2>Unavailable boxes</h2>
          <ul>
            {state.issues.map((issue) => (
              <li key={issue.boxId}>
                {issue.boxNumber}: {errorMessage(new ClientError(issue.code))}
              </li>
            ))}
          </ul>
          <p>Results below exclude these boxes. Retry with Refresh search.</p>
        </section>
      )}
      {!!state.warnings.length && (
        <ul aria-label="Search warnings">
          {state.warnings.map((issue) => (
            <li key={`${issue.boxId}:${issue.code}`}>
              {issue.boxNumber}: {errorMessage(new ClientError(issue.code))}
            </li>
          ))}
        </ul>
      )}
      {!query.trim() ? (
        <p>Enter a box number or words to search.</p>
      ) : (
        <>
          <p>
            {matches.length} matching{" "}
            {matches.length === 1 ? "record" : "records"}
            {state.status !== "ready"
              ? " in the inventories loaded so far"
              : ""}
            .
          </p>
          {!matches.length && state.status === "ready" && (
            <p>No matching boxes or items.</p>
          )}
          <ul className="item-list" aria-label="Search results">
            {matches.map((match) => (
              <li key={match.key}>
                <Link
                  to={
                    match.itemId
                      ? `/box/${match.boxId}/item/${match.itemId}`
                      : `/box/${match.boxId}`
                  }
                >
                  <strong>{match.name}</strong>
                </Link>
                <p>
                  {match.boxNumber} · {match.boxName} ·{" "}
                  {match.location || "Location not recorded"}
                </p>
                {match.description && <p>{match.description}</p>}
                <Link
                  to={`/box/${match.boxId}/edit`}
                  state={
                    match.itemId ? { focusItemId: match.itemId } : undefined
                  }
                >
                  Edit {match.kind}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to="/library">Back to library</Link>
    </>
  );
}
