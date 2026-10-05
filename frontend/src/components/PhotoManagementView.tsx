import { LoadingStatus } from "./LoadingStatus";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ClientError, errorMessage } from "../services/errors";
import { LibraryConnection } from "./DriveConnection";
import { Photo } from "./InventoryViews";
import { usePhotos, useStorage } from "./StorageProvider";

export function PhotoManagementView() {
  const { state } = useStorage();
  const { boxId, itemId } = useParams();
  if (!state.root) return <LibraryConnection />;
  return (
    <ConnectedPhotos
      key={`${state.account?.id}:${state.root.id}:${boxId}:${itemId}`}
    />
  );
}
function ConnectedPhotos() {
  const { boxId = "", itemId = "" } = useParams();
  const { photos, state } = usePhotos();
  const [error, setError] = useState<unknown>();
  const [resize, setResize] = useState(true);
  const [stream, setStream] = useState<MediaStream>();
  const [cameraPending, setCameraPending] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [recoveredIds, setRecoveredIds] = useState<string[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    void photos.open(boxId, itemId).catch((error) => {
      if (active.current) setError(error);
    });
    return () => {
      active.current = false;
      photos.reset();
    };
  }, [photos, boxId, itemId]);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream ?? null;
  }, [stream]);
  const act = (action: () => unknown | Promise<unknown>) => {
    setError(undefined);
    try {
      void Promise.resolve(action()).catch((error) => {
        if (active.current) setError(error);
      });
    } catch (error) {
      setError(error);
    }
  };
  const item = state.view?.inventory.items.find((entry) => entry.id === itemId);
  const disabled = state.busy || state.preparing || state.locked;
  const writesDisabled = disabled || !photos.writesAvailable;
  const stopCamera = () => {
    photos.camera.stop();
    setStream(undefined);
    setCameraPending(false);
  };
  return (
    <section className="page-panel">
      <h1>Manage photographs</h1>
      <Link to={`/box/${boxId}/item/${itemId}`}>Back to item</Link>
      {(error || state.error) && (
        <p role="alert">
          {errorMessage(error || new ClientError(state.error!))}
        </p>
      )}
      {!state.view && !error && <LoadingStatus>Loading item…</LoadingStatus>}
      {state.view && (
        <>
          <h2>{item?.name ?? "Item removed"}</h2>
          <p>
            Images are ordinary JPEG files beside the box inventory. Preview
            them before upload. Changing photos preserves the item’s permanent
            identity.
          </p>
          {!photos.writesAvailable && (
            <p role="status">
              Photo uploads and deletion are awaiting Drive concurrency
              verification. You can prepare previews and view existing
              photographs.
            </p>
          )}
          {item && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={resize}
                  disabled={disabled}
                  onChange={(event) => setResize(event.target.checked)}
                />
                Resize new selections to a maximum of 2560 pixels
              </label>
              <label htmlFor="photo-files">
                Choose photographs (up to 20, 25 MiB each)
              </label>
              <input
                id="photo-files"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                multiple
                disabled={disabled}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  act(() => photos.select(files, resize));
                }}
              />
              <label htmlFor="camera-file">
                Take a photograph with your device
              </label>
              <input
                id="camera-file"
                type="file"
                accept="image/*"
                capture="environment"
                disabled={disabled}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  act(() => photos.select(files, resize));
                }}
              />
              {!stream && !cameraPending && (
                <button
                  disabled={disabled}
                  onClick={() => {
                    setCameraPending(true);
                    act(async () => {
                      try {
                        const next = await photos.camera.start();
                        if (active.current) setStream(next);
                      } finally {
                        if (active.current) setCameraPending(false);
                      }
                    });
                  }}
                >
                  Open camera
                </button>
              )}
              {(stream || cameraPending) && (
                <button onClick={stopCamera}>Close camera</button>
              )}
              {cameraPending && (
                <p role="status">
                  Waiting for camera permission… You can close the camera
                  request.
                </p>
              )}
              {stream && (
                <>
                  <video
                    ref={video}
                    autoPlay
                    muted
                    playsInline
                    aria-label="Camera preview"
                  />
                  <button
                    disabled={disabled}
                    onClick={() =>
                      act(async () => {
                        try {
                          const blob = await photos.camera.capture(
                            video.current!,
                          );
                          if (active.current) {
                            setStream(undefined);
                            await photos.select([blob], resize);
                          }
                        } finally {
                          if (active.current) setStream(undefined);
                        }
                      })
                    }
                  >
                    Capture photograph
                  </button>
                </>
              )}
              {state.preparing && (
                <LoadingStatus>Preparing JPEG previews…</LoadingStatus>
              )}
              <div className="photo-previews">
                {state.selected.map((photo, index) => (
                  <figure key={photo.id} className="item-photo">
                    <img
                      src={photo.url}
                      alt={`New photograph preview ${index + 1}`}
                    />
                    <figcaption>
                      JPEG · {Math.ceil(photo.blob.size / 1024)} KiB
                    </figcaption>
                    <button
                      disabled={state.busy || state.preparing}
                      onClick={() => act(() => photos.drop(photo.id))}
                    >
                      Remove preview {index + 1}
                    </button>
                  </figure>
                ))}
              </div>
              <button
                disabled={writesDisabled || !state.selected.length}
                onClick={() => act(() => photos.save({ kind: "add" }))}
              >
                Upload selected photographs
              </button>
              {!!item.images?.length && (
                <>
                  <label htmlFor="replacement-photo">
                    Photograph to replace
                  </label>
                  <select
                    id="replacement-photo"
                    value={replacement}
                    onChange={(event) => setReplacement(event.target.value)}
                  >
                    <option value="">Choose a photograph</option>
                    {item.images.map((filename) => (
                      <option key={filename}>{filename}</option>
                    ))}
                  </select>
                  <button
                    disabled={
                      writesDisabled ||
                      state.selected.length !== 1 ||
                      !replacement
                    }
                    onClick={() => {
                      if (
                        window.confirm(
                          "Replace this photo reference with the selected JPEG? The old file remains until reviewed cleanup; shared files are retained.",
                        )
                      )
                        act(() =>
                          photos.save(
                            { kind: "replace", filename: replacement },
                            true,
                          ),
                        );
                    }}
                  >
                    Replace with selected photograph
                  </button>
                </>
              )}
              {item.images?.map((filename) => (
                <div key={filename}>
                  <Photo boxId={boxId} itemId={itemId} filename={filename} />
                  <button
                    disabled={writesDisabled}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${filename} from this item? The file remains until reviewed cleanup. Shared or unverified files stay in Drive.`,
                        )
                      )
                        act(() =>
                          photos.save({ kind: "remove", filename }, true),
                        );
                    }}
                  >
                    Remove photograph reference
                  </button>
                </div>
              ))}
              <p>
                Deleting this item removes its inventory entry and all its photo
                references. Files are retained for a separate cleanup review.
                Shared and unverified files remain in Drive.
              </p>
              <button
                disabled={writesDisabled}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${item.name} and its ${item.images?.length ?? 0} photo references? Photo files remain until reviewed cleanup.`,
                    )
                  )
                    act(() => photos.save({ kind: "item" }, true));
                }}
              >
                Delete item and review its photos
              </button>
            </>
          )}
          {state.busy && (
            <LoadingStatus>Photo operation in progress…</LoadingStatus>
          )}
          <section className="sub-panel">
            <h2>Recover uploaded photographs</h2>
            <p>
              Scan this item’s owned uploads after an interruption or reload.
              Referenced, duplicate and unverified files are retained. Recovery
              never repeats an upload or recreates a deleted item.
            </p>
            <button
              disabled={state.busy || state.preparing}
              onClick={() =>
                act(async () => {
                  setRecoveredIds([]);
                  await photos.discover();
                })
              }
            >
              Scan owned uploads
            </button>
            <ul aria-label="Recovered photographs">
              {state.recovered.map(({ file, eligible, reason }) => (
                <li key={file.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={recoveredIds.includes(file.id)}
                      disabled={!eligible || state.busy}
                      onChange={(event) =>
                        setRecoveredIds((ids) =>
                          event.target.checked
                            ? [...ids, file.id]
                            : ids.filter((id) => id !== file.id),
                        )
                      }
                    />
                    {file.name}
                  </label>
                  <p>{reason}</p>
                </li>
              ))}
            </ul>
            <button
              disabled={
                !item ||
                !recoveredIds.length ||
                writesDisabled ||
                !!state.operation
              }
              onClick={() => {
                if (
                  window.confirm(
                    "Associate the selected recovered JPEG files with this item after checking current references? No upload is repeated.",
                  )
                )
                  act(() =>
                    photos.recoverFiles(recoveredIds, "associate", true),
                  );
              }}
            >
              Associate selected recovered photos
            </button>
            <button
              disabled={
                !recoveredIds.length || writesDisabled || !!state.operation
              }
              onClick={() => {
                if (
                  window.confirm(
                    "Move only selected, verified and still-unreferenced owned uploads to Drive trash after rechecking current references?",
                  )
                )
                  act(() => photos.recoverFiles(recoveredIds, "cleanup", true));
              }}
            >
              Clean up selected recovered photos
            </button>
          </section>
          {!!state.messages.length && (
            <ul aria-label="Photo operation results">
              {state.messages.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          )}
          {state.operation && (
            <section className="sub-panel">
              <h2>Review interrupted or completed steps</h2>
              <p>
                Operation {state.operation.id}. Uploaded files:{" "}
                {state.operation.uploaded.length}. References{" "}
                {state.operation.refsConfirmed ? "confirmed" : "unconfirmed"}.
                Recovery details stay in memory until you leave this page or
                change accounts.
              </p>
              <button
                disabled={state.busy}
                onClick={() => act(() => photos.review())}
              >
                Re-read current Drive records
              </button>
              <button
                disabled={
                  state.busy ||
                  !photos.retryAvailable ||
                  state.operation.refsConfirmed
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "Retry only the inventory reference update after checking current records? No photos will be uploaded again.",
                    )
                  )
                    act(() => photos.review(true, true));
                }}
              >
                Retry reference update
              </button>
              <button
                disabled={state.busy || !photos.writesAvailable}
                onClick={() => {
                  if (
                    window.confirm(
                      "Move verified owned and currently unreferenced candidate photos to Drive trash? Referenced, shared, changed and unverified files will be retained.",
                    )
                  )
                    act(() => photos.cleanup(true));
                }}
              >
                Review and clean up unreferenced photos
              </button>
              <button
                disabled={state.busy || state.preparing}
                onClick={() => {
                  if (
                    window.confirm(
                      "Discard this in-memory operation review and previews, then scan current uploads? Drive changes are not undone; no files are uploaded or deleted.",
                    )
                  )
                    act(() => photos.forgetOperation(true));
                }}
              >
                Discard operation review and scan uploads
              </button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
