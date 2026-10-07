import { ClientError } from "../services/errors";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import type { LibraryService } from "../services/library";
import { ThumbnailQueue } from "../services/thumbnailQueue";
import { useLibrary, useStorage } from "./StorageProvider";
import { LoadingStatus } from "./LoadingStatus";

export const PhotoRecognitionContext = createContext(false);
export function PhotoRecognitionProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const { state } = useStorage();
  const scope = `${state.account?.id ?? ""}:${state.root?.id ?? ""}`;
  useEffect(() => {
    window.boxStoragePhotoUx?.clear();
  }, [enabled, scope]);
  return (
    <PhotoRecognitionContext.Provider value={enabled}>
      {children}
    </PhotoRecognitionContext.Provider>
  );
}
export const usePhotoRecognition = () => useContext(PhotoRecognitionContext);
const queues = new WeakMap<LibraryService, ThumbnailQueue>();
function queueFor(library: LibraryService) {
  let queue = queues.get(library);
  if (!queue) {
    queue = new ThumbnailQueue();
    queues.set(library, queue);
  }
  return queue;
}
export function InventoryThumbnail({
  boxId,
  itemId,
  filename,
  name,
  fullPhoto = false,
}: {
  boxId: string;
  itemId: string;
  filename: string;
  name: string;
  fullPhoto?: boolean;
}) {
  const { library } = useLibrary();
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const ownedPhoto = useRef<string | undefined>(undefined);
  const [url, setUrl] = useState<string>();
  const [phase, setPhase] = useState<
    "waiting" | "loading" | "ready" | "error" | "deferred"
  >("waiting");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // Load once on first visibility; scrolling must not release/reload photos.
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    if (holder.current) observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) {
      setUrl(undefined);
      setPhase("waiting");
      return;
    }
    let active = true;
    const controller = new AbortController();
    setPhase("loading");
    setUrl(undefined);
    void queueFor(library)
      .run(
        () =>
          library.photo(
            boxId,
            itemId,
            filename,
            fullPhoto ? undefined : 256 * 1024,
          ),
        controller.signal,
      )
      .then((photo) => {
        if (!active) {
          library.releasePhoto(photo);
          return;
        }
        ownedPhoto.current = photo;
        setUrl(photo);
        setPhase("ready");
      })
      .catch((error) => {
        if (
          active &&
          error instanceof ClientError &&
          error.code === "PREVIEW_DEFERRED"
        ) {
          setPhase("deferred");
          return;
        }
        if (active) {
          setPhase("error");
          window.boxStoragePhotoUx?.record("thumbnailFailed");
        }
      });
    return () => {
      active = false;
      controller.abort();
      if (ownedPhoto.current) {
        library.releasePhoto(ownedPhoto.current);
        ownedPhoto.current = undefined;
      }
    };
  }, [visible, library, boxId, itemId, filename, fullPhoto, attempt]);
  return (
    <div ref={holder} className="inventory-thumbnail">
      <Link
        className="inventory-thumbnail-link"
        to={`/box/${boxId}/item/${itemId}`}
        aria-label={`Open item: ${name}`}
        onClick={() => window.boxStoragePhotoUx?.record("thumbnailOpened")}
      >
        {url ? (
          <img
            src={url}
            width="88"
            height="88"
            alt={`Photograph of ${name}`}
            loading="lazy"
            decoding="async"
            onLoad={() => window.boxStoragePhotoUx?.record("thumbnailLoaded")}
            onError={() => {
              if (ownedPhoto.current) {
                library.releasePhoto(ownedPhoto.current);
                ownedPhoto.current = undefined;
              }
              setPhase("error");
              setUrl(undefined);
              window.boxStoragePhotoUx?.record("thumbnailFailed");
            }}
          />
        ) : (
          <span>Open item</span>
        )}
      </Link>
      {phase === "loading" && <LoadingStatus>Loading preview…</LoadingStatus>}
      {phase === "deferred" && <small>Open item to view photo</small>}
      {phase === "error" && (
        <>
          <p role="status">Photograph unavailable.</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Retry preview
          </button>
        </>
      )}
    </div>
  );
}
