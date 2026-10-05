import { NavLink, Outlet } from "react-router-dom";
import { ServiceStatus } from "./ServiceStatus";
import { UnsavedChangesGuard } from "./EditingViews";

function NavigationIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

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
          <NavLink to="/library">
            <NavigationIcon path="M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" />
            Library
          </NavLink>
          <NavLink to="/search">
            <NavigationIcon path="M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0" />
            Search
          </NavLink>
          <NavLink to="/scan">
            <NavigationIcon path="M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M7 12h10" />
            Scan
          </NavLink>
          <NavLink to="/settings">
            <NavigationIcon path="M4 7h16 M4 17h16 M8 4v6 M16 14v6" />
            Settings
          </NavLink>
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
