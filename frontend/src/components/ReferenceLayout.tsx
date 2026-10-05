import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useStorage } from "./StorageProvider";
export const ReferenceLayoutContext = createContext(false);
export const useReferenceLayout = () => useContext(ReferenceLayoutContext);
export function ReferenceLayoutProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const { state } = useStorage();
  const scope = `${state.account?.id ?? ""}:${state.root?.id ?? ""}`;
  useEffect(() => {
    window.boxStorageReferenceUx?.clear();
  }, [enabled, scope]);
  return (
    <ReferenceLayoutContext.Provider value={enabled}>
      {children}
    </ReferenceLayoutContext.Provider>
  );
}
export function ReferenceCubeIcon() {
  return (
    <svg
      className="reference-cube"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M24 3 43 14v21L24 46 5 35V14z M5 14l19 11 19-11 M24 25v21" />
    </svg>
  );
}
export function ReferenceSearch() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { state } = useStorage();
  useEffect(() => {
    setQuery("");
  }, [state.account?.id, state.root?.id]);
  return (
    <form
      className="reference-search"
      role="search"
      aria-label="Search library"
      onSubmit={(event) => {
        event.preventDefault();
        navigate(
          `/search${query.trim() ? `?${new URLSearchParams({ q: query.trim() })}` : ""}`,
        );
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 6 6" />
      </svg>
      <input
        type="search"
        aria-label="Search library query"
        placeholder="Search boxes or items…"
        value={query}
        maxLength={500}
        onChange={(event) => setQuery(event.target.value)}
      />
      <button type="submit">Search</button>
    </form>
  );
}
