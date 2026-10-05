import { NavLink, Outlet } from "react-router-dom";
import { ServiceStatus } from "./ServiceStatus";
import { UnsavedChangesGuard } from "./EditingViews";

export function Layout({ dataRouter = false }: { dataRouter?: boolean }) {
  return (
    <>
      <UnsavedChangesGuard dataRouter={dataRouter} />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <NavLink to="/" className="brand">
          <img src="/box.svg" alt="" />
          Box Storage
        </NavLink>
        <nav aria-label="Main navigation">
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/scan">Scan</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer>
        <span>Your boxes. Your Google Drive.</span>
        <ServiceStatus />
      </footer>
    </>
  );
}
