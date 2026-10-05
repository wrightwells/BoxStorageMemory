import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useStorage } from "./StorageProvider";
interface Snapshot {
  query: string;
  scroll: number;
  result: string | null;
}
interface ContextValue {
  enabled: boolean;
  snapshot: Snapshot;
  remember: (snapshot: Snapshot) => void;
}
const empty: Snapshot = { query: "", scroll: 0, result: null };
const Context = createContext<ContextValue>({
  enabled: false,
  snapshot: empty,
  remember: () => {},
});
export function SearchContextProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const { session, state } = useStorage();
  const scope = `${state.account?.id ?? ""}:${state.root?.id ?? ""}`;
  const [cached, setCached] = useState({ scope, snapshot: empty });
  // Authorization/root transitions clear data synchronously through subscription,
  // including sign-out followed by reconnecting to the same account/root.
  useEffect(
    () =>
      session.subscribe(() => {
        const next = session.getSnapshot();
        if (!next.account || !next.root)
          setCached({ scope: "", snapshot: empty });
      }),
    [session],
  );
  useEffect(() => {
    setCached({ scope, snapshot: empty });
    window.boxStorageSearchUx?.clear();
  }, [enabled, scope]);
  const value = useMemo<ContextValue>(
    () => ({
      enabled,
      snapshot: enabled && cached.scope === scope ? cached.snapshot : empty,
      remember: (snapshot) => setCached({ scope, snapshot }),
    }),
    [enabled, cached, scope],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useSearchContext = () => useContext(Context);
