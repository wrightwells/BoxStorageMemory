import {
  ReferenceLayoutProvider,
  ReferenceCubeIcon,
  ReferenceSearch,
} from "./ReferenceLayout";
import { PhotoRecognitionProvider } from "./PhotoRecognition";
import { NavLink, Outlet } from "react-router-dom";
import { useNavigationExperiment } from "./useNavigationExperiment";
import { SearchContextProvider, useSearchContext } from "./SearchContext";
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

function SearchDestination() {
  const context = useSearchContext();
  const to =
    context.enabled && context.snapshot.query
      ? `/search?q=${encodeURIComponent(context.snapshot.query)}`
      : "/search";
  return (
    <NavLink to={to}>
      <NavigationIcon path="M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0" />
      Search
    </NavLink>
  );
}
export function Layout({ dataRouter = false }: { dataRouter?: boolean }) {
  const { variant, restoreSearch, photoRecognition, referenceLayout } =
    useNavigationExperiment();
  return (
    <ReferenceLayoutProvider enabled={referenceLayout}>
      <PhotoRecognitionProvider enabled={photoRecognition}>
        <SearchContextProvider enabled={restoreSearch}>
          <UnsavedChangesGuard dataRouter={dataRouter} />
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <header
            className={
              variant === "control"
                ? "site-header"
                : "site-header persistent-navigation"
            }
          >
            <NavLink to="/" className="brand">
              {referenceLayout ? (
                <ReferenceCubeIcon />
              ) : (
                <img src="/box.svg" alt="" />
              )}
              {referenceLayout ? "Box Library" : "Box Storage"}
            </NavLink>
            <nav aria-label="Main navigation">
              <NavLink to="/library">
                <NavigationIcon path="M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" />
                {referenceLayout ? "Boxes" : "Library"}
              </NavLink>
              <SearchDestination />
              <NavLink to="/settings">
                <NavigationIcon path="M4 7h16 M4 17h16 M8 4v6 M16 14v6" />
                Settings
              </NavLink>
            </nav>
          </header>
          {referenceLayout && <ReferenceSearch />}
          <main id="main" tabIndex={-1}>
            <Outlet />
          </main>
          <footer>
            <span>Your boxes. Your Google Drive.</span>
            <ServiceStatus />
          </footer>
        </SearchContextProvider>
      </PhotoRecognitionProvider>
    </ReferenceLayoutProvider>
  );
}
