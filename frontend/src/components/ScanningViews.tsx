import { LoadingStatus } from "./LoadingStatus";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { qrUrl } from "../../../shared/typescript/contracts";
import type { BoxView } from "../services/library";
import { ClientError, errorMessage } from "../services/errors";
import {
  NfcScanner,
  QrCamera,
  nfcAvailable,
  scannedBox,
} from "../services/scanning";
import type { TagResult, TagReview } from "../services/nfc";
import { LibraryConnection } from "./DriveConnection";
import { useStorage } from "./StorageProvider";

export function QrLabelView() {
  const { state } = useStorage();
  const { boxId } = useParams();
  if (!state.root) return <LibraryConnection />;
  return (
    <ConnectedLabel key={`${state.account?.id}:${state.root.id}:${boxId}`} />
  );
}
function ConnectedLabel() {
  const { session, state } = useStorage();
  const { boxId = "" } = useParams();
  const [view, setView] = useState<BoxView>();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const owned = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void session.library
      .box(boxId)
      .then((value) => {
        if (active) setView(value);
      })
      .catch((error) => {
        if (active) setError(error);
      });
    return () => {
      active = false;
      controller.current?.abort();
      if (owned.current) URL.revokeObjectURL(owned.current);
    };
  }, [session, boxId]);
  const generate = async () => {
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setError(undefined);
    try {
      const blob = await session.api.qr(boxId, task.signal);
      if (task.signal.aborted) return;
      if (blob.type !== "image/png" || blob.size > 1024 * 1024 || !blob.size)
        throw new ClientError("API_INCOMPATIBLE");
      if (owned.current) URL.revokeObjectURL(owned.current);
      owned.current = URL.createObjectURL(blob);
      setUrl(owned.current);
    } catch (error) {
      if (!task.signal.aborted) setError(error);
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  };
  return (
    <section className="page-panel">
      <h1>Box QR label</h1>
      {busy && <LoadingStatus>Generating QR label…</LoadingStatus>}
      {!!error && <p role="alert">{errorMessage(error)}</p>}
      {!view && !error && <LoadingStatus>Loading box…</LoadingStatus>}
      {view && (
        <>
          <p>
            Regenerating a label preserves this box’s number, identity and Drive
            folder. A label grants no account access.
          </p>
          <button disabled={busy} onClick={() => void generate()}>
            {url ? "Regenerate QR label" : "Generate QR label"}
          </button>
          {url && (
            <>
              <div className="qr-label">
                <h2>{view.inventory.box.number}</h2>
                <p>{view.inventory.box.name}</p>
                <img
                  src={url}
                  width="256"
                  height="256"
                  alt={`QR code for ${view.inventory.box.number}`}
                />
                <p>{qrUrl(state.config!.publicUrl, boxId)}</p>
              </div>
              <a
                className="button secondary"
                href={url}
                download={`${view.inventory.box.number}-qr.png`}
              >
                Save QR PNG
              </a>
              <button onClick={() => window.print()}>Print box label</button>
            </>
          )}
        </>
      )}
      <Link to={`/box/${boxId}`}>Back to box</Link>
    </section>
  );
}

function useNfcScan(
  onFound: (uid: string) => void,
  onError: (error: unknown) => void,
) {
  const { state } = useStorage();
  const [scanner] = useState(() => new NfcScanner());
  const [reading, setReading] = useState(false);
  const enabled = state.config?.features.webNfc === true;
  const available = nfcAvailable(enabled);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        scanner.stop();
        setReading(false);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      scanner.stop();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [scanner, state.root?.id, state.account?.id]);
  const stop = () => {
    scanner.stop();
    setReading(false);
  };
  const start = async () => {
    setReading(true);
    try {
      await scanner.start(
        enabled,
        (uid) => {
          setReading(false);
          onFound(uid);
        },
        (error) => {
          setReading(false);
          onError(error);
        },
      );
    } catch (error) {
      setReading(false);
      onError(error);
    }
  };
  return (
    <>
      <button disabled={!available || reading} onClick={() => void start()}>
        Read NFC tag
      </button>
      {reading && (
        <>
          <p role="status">Hold a compatible tag near your device.</p>
          <button onClick={stop}>Stop NFC reading</button>
        </>
      )}
      {!available && (
        <p>
          Web NFC is unavailable or disabled. Use QR, search or box-number
          lookup.
        </p>
      )}
    </>
  );
}
export function ScanView() {
  const { state } = useStorage();
  return <ConnectedScan key={`${state.account?.id}:${state.root?.id}`} />;
}
function ConnectedScan() {
  const { session, state } = useStorage();
  const navigate = useNavigate();
  const [scanner] = useState(() => new QrCamera());
  const [running, setRunning] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>();
  const [tag, setTag] = useState<TagReview>();
  const [pending, setPending] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const active = useRef(true);
  const cameraAttempt = useRef(0);
  useEffect(() => {
    active.current = true;
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active.current = false;
      scanner.stop();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [scanner]);
  const stop = () => {
    cameraAttempt.current++;
    scanner.stop();
    setRunning(false);
    if (video.current) video.current.srcObject = null;
  };
  const open = (value: string) => {
    stop();
    setError(undefined);
    try {
      if (!state.config) throw new ClientError("API_UNAVAILABLE");
      const boxId = scannedBox(value, state.config.publicUrl);
      navigate(`/box/${boxId}`);
    } catch (error) {
      setError(error);
    }
  };
  const nfc = useNfcScan((uid) => {
    setError(undefined);
    setTag(undefined);
    setPending(true);
    void session.nfc
      .review(uid)
      .then((review) => {
        if (active.current) setTag(review);
      })
      .catch((error) => {
        if (active.current) setError(error);
      })
      .finally(() => {
        if (active.current) setPending(false);
      });
  }, setError);
  return (
    <section className="page-panel">
      <h1>Scan a box</h1>
      <p>
        Scan a label from this deployment or paste its exact URL. Other links
        and plain text will be rejected.
      </p>
      {!!error && <p role="alert">{errorMessage(error)}</p>}
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        className="scanner-video"
        aria-label="QR camera preview"
        hidden={!running}
      />
      <button
        disabled={running || !state.config}
        onClick={() => {
          setError(undefined);
          setRunning(true);
          const attempt = ++cameraAttempt.current;
          void scanner
            .start(
              video.current!,
              (value) => {
                if (active.current && attempt === cameraAttempt.current)
                  open(value);
              },
              () => {
                if (active.current && attempt === cameraAttempt.current) {
                  stop();
                  setError(new ClientError("CAMERA_UNAVAILABLE"));
                }
              },
            )
            .catch((error) => {
              if (active.current && attempt === cameraAttempt.current) {
                stop();
                setError(error);
              }
            });
        }}
      >
        Start QR camera
      </button>
      {running && <button onClick={stop}>Stop QR camera</button>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          open(text);
        }}
      >
        <label htmlFor="qr-text">QR label URL</label>
        <input
          id="qr-text"
          value={text}
          maxLength={2048}
          onChange={(event) => setText(event.target.value)}
          required
        />
        <button disabled={!state.config}>Open QR label</button>
      </form>
      <h2>Optional NFC lookup</h2>
      {state.root ? nfc : <LibraryConnection />}
      {pending && <p role="status">Checking authoritative tag mappings…</p>}
      {tag && (
        <>
          {tag.owner ? (
            <Link to={`/box/${tag.owner.boxId}`}>
              Open {tag.owner.boxNumber} · {tag.owner.name}
            </Link>
          ) : (
            <p>
              This tag is unassigned. Open a box and choose Manage NFC tags to
              register it.
            </p>
          )}
        </>
      )}
      <Link to="/library">Browse or enter a box number</Link>
      <Link to="/search">Search boxes and items</Link>
    </section>
  );
}
export function NfcManagementView() {
  const { state } = useStorage();
  const { boxId } = useParams();
  if (!state.root) return <LibraryConnection />;
  return (
    <ConnectedTags key={`${state.account?.id}:${state.root.id}:${boxId}`} />
  );
}
function ConnectedTags() {
  const { session, state } = useStorage();
  const { boxId = "" } = useParams();
  const [view, setView] = useState<BoxView>();
  const [review, setReview] = useState<TagReview>();
  const [result, setResult] = useState<TagResult>();
  const [error, setError] = useState<unknown>();
  const [replace, setReplace] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [move, setMove] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void session.library
      .box(boxId)
      .then((value) => {
        if (active.current) setView(value);
      })
      .catch((error) => {
        if (active.current) setError(error);
      });
    return () => {
      active.current = false;
    };
  }, [session, boxId]);
  const perform = async (action: () => Promise<TagResult>) => {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const value = await action();
      if (!active.current) return;
      setResult(value);
      setConfirm(false);
      setReview(undefined);
      setMove(false);
      setView(await session.library.box(boxId, true));
    } catch (error) {
      if (active.current) setError(error);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const nfc = useNfcScan((uid) => {
    setReview(undefined);
    setConfirm(false);
    setMove(false);
    setError(undefined);
    void session.nfc
      .review(uid)
      .then((value) => {
        if (active.current) setReview(value);
      })
      .catch((error) => {
        if (active.current) setError(error);
      });
  }, setError);
  const enabled = state.config?.features.webNfc === true;
  return (
    <section className="page-panel">
      <h1>Manage NFC tags</h1>
      {!view && !error && <LoadingStatus>Loading box…</LoadingStatus>}
      {busy && <LoadingStatus>Updating NFC tags…</LoadingStatus>}
      {!!error && <p role="alert">{errorMessage(error)}</p>}
      {view && (
        <>
          <h2>
            {view.inventory.box.number} · {view.inventory.box.name}
          </h2>
          <p>
            Tag changes preserve the box’s number, UUID and Drive folder. Tag
            payloads are not used as identity.
          </p>
          {!session.editing.writesAvailable && (
            <p role="status">
              Tag changes await Drive concurrency verification. Existing
              mappings can be read.
            </p>
          )}
          <ul>
            {view.inventory.box.nfcIds.map((uid) => (
              <li key={uid}>
                {uid}{" "}
                <button
                  disabled={
                    busy || !enabled || !session.editing.writesAvailable
                  }
                  onClick={() => {
                    setReview({ uid, owner: undefined, boxes: [] });
                    setConfirm(false);
                    setMove(false);
                  }}
                >
                  Review removal of {uid}
                </button>
              </li>
            ))}
          </ul>
          {!view.inventory.box.nfcIds.length && <p>No NFC tags registered.</p>}
          {!busy && nfc}
          {review && (
            <>
              <p>Tag identifier: {review.uid}</p>
              {review.owner && (
                <p>
                  Currently assigned to {review.owner.boxNumber} ·{" "}
                  {review.owner.name}.
                </p>
              )}
              {!review.owner && !!review.boxes.length && (
                <p>This tag is unassigned.</p>
              )}
              {!!review.boxes.length && (
                <label>
                  <input
                    type="checkbox"
                    checked={replace}
                    onChange={(event) => setReplace(event.target.checked)}
                  />
                  Replace all tags currently on this box
                </label>
              )}
              {review.owner && review.owner.boxId !== boxId && (
                <label>
                  <input
                    type="checkbox"
                    checked={move}
                    onChange={(event) => setMove(event.target.checked)}
                  />
                  Move this tag from {review.owner.boxNumber}; remove its old
                  mapping first
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(event) => setConfirm(event.target.checked)}
                />
                Confirm the reviewed tag change
              </label>
              <button
                disabled={
                  !confirm ||
                  busy ||
                  !enabled ||
                  !session.editing.writesAvailable ||
                  (!!review.owner && review.owner.boxId !== boxId && !move)
                }
                onClick={() =>
                  void perform(() =>
                    review.boxes.length
                      ? session.nfc.assign(review.uid, boxId, {
                          confirmed: confirm,
                          moveConfirmed: move,
                          replace,
                        })
                      : session.nfc.remove(review.uid, boxId, confirm),
                  )
                }
              >
                {review.boxes.length
                  ? "Save tag association"
                  : "Remove tag mapping"}
              </button>
            </>
          )}
        </>
      )}
      {result && (
        <>
          <p role="status">
            {result.complete
              ? "Tag change verified."
              : "Tag change incomplete. Review current mappings before a new attempt; earlier steps may have saved."}
          </p>
          {result.code && (
            <p role="alert">{errorMessage(new ClientError(result.code))}</p>
          )}
          <ul>
            {result.steps.map((step, i) => (
              <li key={i}>
                Box {step.result.boxNumber}: {step.result.outcome};{" "}
                {step.result.phase}
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to={`/box/${boxId}`}>Back to box</Link>
    </section>
  );
}
