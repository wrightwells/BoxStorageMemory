import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { StorageSession } from "../services/session";

const Context = createContext<StorageSession | null>(null);
export function StorageProvider({
  children,
  session,
}: {
  children: ReactNode;
  session?: StorageSession;
}) {
  const [runtime] = useState(() => session ?? new StorageSession());
  useEffect(() => {
    void runtime.initialize();
    return () => runtime.signOut();
  }, [runtime]);
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}
export function useStorage() {
  const session = useContext(Context);
  if (!session) throw new Error("StorageProvider is required");
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return { session, state };
}

export function useLibrary() {
  const { session } = useStorage();
  const library = session.library;
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot);
  return { library, state };
}
export function useEditing() {
  const { session } = useStorage();
  const editing = session.editing;
  const state = useSyncExternalStore(editing.subscribe, editing.getSnapshot);
  return { editing, state };
}

export function usePhotos() {
  const { session } = useStorage();
  const photos = session.photos;
  const state = useSyncExternalStore(photos.subscribe, photos.getSnapshot);
  return { photos, state };
}
export function useSearch() {
  const { session } = useStorage();
  const search = session.search;
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot);
  return { search, state };
}
