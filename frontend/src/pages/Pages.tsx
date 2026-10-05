import { useReferenceLayout } from "../components/ReferenceLayout";
import { Link, useLocation } from "react-router-dom";
import { useStorage } from "../components/StorageProvider";
import { validUuid } from "../services/library";
import { DriveConnection } from "../components/DriveConnection";
import { InventoryView, LibraryView } from "../components/InventoryViews";
import { SearchView } from "../components/SearchView";
import { EditingView } from "../components/EditingViews";

export function HomePage() {
  return (
    <section className="hero">
      <p className="eyebrow">A place for everything</p>
      <h1>
        Remember what’s
        <br />
        inside your boxes.
      </h1>
      <p className="intro">
        Keep your inventory and item photographs together in your own Google
        Drive. Find the right box when you need it.
      </p>
      <Link className="button" to="/library">
        Open library
      </Link>
      <div className="feature-grid">
        <article>
          <span className="feature-number">01</span>
          <h2>Keep it together</h2>
          <p>
            One folder for each box, with its inventory and photographs side by
            side.
          </p>
        </article>
        <article>
          <span className="feature-number">02</span>
          <h2>Find it again</h2>
          <p>Look up a box by its permanent number or search for an item.</p>
        </article>
        <article>
          <span className="feature-number">03</span>
          <h2>Make it yours</h2>
          <p>
            Your records stay as ordinary files under your own Google account.
          </p>
        </article>
      </div>
    </section>
  );
}

export function LoginPage() {
  const { state } = useStorage();
  const location = useLocation();
  const requested = location.state?.returnTo;
  const parts = typeof requested === "string" ? requested.split("/") : [];
  const recordPath =
    parts[1] === "box" &&
    validUuid(parts[2] ?? "") &&
    (parts.length === 3 ||
      (parts.length === 4 &&
        ["edit", "label", "tags"].includes(parts[3] ?? "")) ||
      (parts.length === 5 &&
        parts[3] === "item" &&
        validUuid(parts[4] ?? "")) ||
      (parts.length === 6 &&
        parts[3] === "item" &&
        validUuid(parts[4] ?? "") &&
        parts[5] === "photos"))
      ? requested
      : "/library";
  const searchQuery =
    typeof requested === "string" && requested.startsWith("/search?")
      ? new URLSearchParams(requested.slice(8)).get("q")?.slice(0, 500)
      : undefined;
  const returnTo =
    requested === "/library/new"
      ? requested
      : requested === "/search" || searchQuery !== undefined
        ? `/search${searchQuery ? `?${new URLSearchParams({ q: searchQuery })}` : ""}`
        : recordPath;
  return (
    <section className="page-panel">
      <p className="eyebrow">Your account</p>
      <h1>Connect Google Drive</h1>
      <p>
        Connect your account, then choose the folder containing your library.
      </p>
      <DriveConnection />
      <p>
        <Link to={state.root ? returnTo : "/library"}>
          {state.root && returnTo !== "/library"
            ? returnTo.startsWith("/search")
              ? "Continue search"
              : returnTo === "/library/new"
                ? "Continue box creation"
                : "Open requested record"
            : "Back to library"}
        </Link>
      </p>
    </section>
  );
}

export function LibraryPage() {
  return (
    <section className="page-panel">
      <header className="library-heading">
        <h1>Box library</h1>
        <Link className="button" to="/library/new">
          Add
        </Link>
      </header>
      <LibraryView />
    </section>
  );
}
export function SearchPage() {
  return (
    <section className="page-panel">
      <h1>Search your storage</h1>
      <SearchView />
    </section>
  );
}
export function BoxPage() {
  const referenceLayout = useReferenceLayout();
  return (
    <section className={referenceLayout ? "reference-box-page" : "page-panel"}>
      {!referenceLayout && <h1>Box details</h1>}
      <InventoryView />
    </section>
  );
}
export function EditBoxPage() {
  return (
    <section className="page-panel">
      <h1>Edit box</h1>
      <EditingView />
    </section>
  );
}
export function CreateBoxPage() {
  return (
    <section className="page-panel">
      <h1>Create box</h1>
      <EditingView create />
    </section>
  );
}
export function ItemPage() {
  return (
    <section className="page-panel">
      <h1>Item details</h1>
      <InventoryView itemOnly />
    </section>
  );
}
export function SettingsPage() {
  return (
    <section className="page-panel">
      <h1>Settings</h1>
      <p>Choose the Google account and storage folder for your library.</p>
      <DriveConnection />
    </section>
  );
}
export function NotFoundPage() {
  return (
    <section className="page-panel">
      <h1>Page not found</h1>
      <p>This page does not exist.</p>
      <Link className="button" to="/library">
        Open library
      </Link>
    </section>
  );
}
