import { normalizeNfc, parseQr } from "../../../shared/typescript/contracts";
import { ClientError } from "./errors";
import { PhotoCamera } from "./image-processing";

export function scannedBox(value: unknown, origin: string) {
  try {
    return parseQr(value, origin);
  } catch {
    throw new ClientError("INVALID_QR_URL");
  }
}
// Decode only bounded pixels; no frame or payload reaches the server or logs.
export async function decodeQr(
  data: Uint8ClampedArray,
  width: number,
  height: number,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 1024 * 1024 ||
    data.length !== width * height * 4
  )
    throw new ClientError("INVALID_IMAGE");
  const { default: jsQR } = await import("jsqr");
  return jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data;
}
export class QrCamera {
  readonly camera = new PhotoCamera();
  #epoch = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #canvas?: HTMLCanvasElement;
  stop() {
    this.#epoch++;
    clearTimeout(this.#timer);
    this.camera.stop();
    if (this.#canvas) this.#canvas.width = this.#canvas.height = 0;
    this.#canvas = undefined;
  }
  async start(
    video: HTMLVideoElement,
    found: (value: string) => void,
    failed: () => void,
  ) {
    this.stop();
    const epoch = this.#epoch;
    const stream = await this.camera.start();
    if (epoch !== this.#epoch) return;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      if (epoch !== this.#epoch) return;
      this.stop();
      throw new ClientError("CAMERA_UNAVAILABLE");
    }
    if (epoch !== this.#epoch) return;
    const canvas = document.createElement("canvas");
    this.#canvas = canvas;
    const frame = async () => {
      if (epoch !== this.#epoch) return;
      try {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const scale = Math.min(
            1,
            960 / Math.max(video.videoWidth, video.videoHeight),
          );
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new ClientError("CAMERA_UNAVAILABLE");
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const value = await decodeQr(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height,
          );
          if (epoch !== this.#epoch) return;
          if (value) {
            this.stop();
            video.srcObject = null;
            found(value);
            return;
          }
        }
        this.#timer = setTimeout(() => void frame(), 250);
      } catch {
        if (epoch === this.#epoch) {
          this.stop();
          video.srcObject = null;
          failed();
        }
      }
    };
    void frame();
  }
}
export interface NfcReader extends EventTarget {
  scan(options: { signal: AbortSignal }): Promise<void>;
}
type NfcWindow = Window & { NDEFReader?: new () => NfcReader };
export function nfcAvailable(enabled: boolean) {
  return (
    enabled &&
    window.isSecureContext &&
    window.top === window.self &&
    typeof (window as NfcWindow).NDEFReader === "function"
  );
}
export class NfcScanner {
  #controller?: AbortController;
  #reader?: NfcReader;
  #epoch = 0;
  stop() {
    this.#epoch++;
    this.#controller?.abort();
    this.#controller = undefined;
    this.#reader = undefined;
  }
  async start(
    enabled: boolean,
    found: (uid: string) => void,
    failed: (error: ClientError) => void,
  ) {
    this.stop();
    if (!nfcAvailable(enabled)) throw new ClientError("NFC_UNAVAILABLE");
    const epoch = this.#epoch;
    const controller = new AbortController();
    this.#controller = controller;
    const reader = new (window as NfcWindow).NDEFReader!();
    this.#reader = reader;
    reader.addEventListener(
      "reading",
      (event) => {
        if (epoch !== this.#epoch) return;
        try {
          const uid = normalizeNfc(
            (event as Event & { serialNumber: string }).serialNumber,
          );
          this.stop();
          found(uid);
        } catch {
          this.stop();
          failed(new ClientError("INVALID_NFC_ID"));
        }
      },
      { signal: controller.signal },
    );
    reader.addEventListener(
      "readingerror",
      () => {
        if (epoch === this.#epoch) {
          this.stop();
          failed(new ClientError("NFC_UNREADABLE"));
        }
      },
      { signal: controller.signal },
    );
    try {
      await this.#reader.scan({ signal: controller.signal });
    } catch {
      if (epoch === this.#epoch) {
        this.stop();
        throw new ClientError("NFC_UNAVAILABLE");
      }
    }
  }
}
