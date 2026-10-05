import { afterEach, describe, expect, it, vi } from "vitest";
import {
  photoDimensions,
  preparePhoto,
  PhotoCamera,
} from "../src/services/image-processing";

function canvasFixture() {
  const drawImage = vi.fn(),
    fillRect = vi.fn(),
    close = vi.fn();
  const canvas = document.createElement("canvas");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
    fillRect,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (done, type) => done(new Blob(["jpeg"], { type })),
  );
  vi.spyOn(document, "createElement").mockReturnValue(canvas);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 4000, height: 3000, close })),
  );
  return { drawImage, fillRect, close, canvas };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("JPEG processing", () => {
  it("preserves aspect ratio without upscaling, supports disabling resize, and bounds pixel allocation", () => {
    expect(photoDimensions(4000, 3000)).toEqual({ width: 2560, height: 1920 });
    expect(photoDimensions(3000, 4000)).toEqual({ width: 1920, height: 2560 });
    expect(photoDimensions(100, 50)).toEqual({ width: 100, height: 50 });
    expect(photoDimensions(4000, 3000, false)).toEqual({
      width: 4000,
      height: 3000,
    });
    expect(() => photoDimensions(10000, 10000)).toThrow("IMAGE_TOO_LARGE");
    expect(() => photoDimensions(20000, 1)).toThrow("IMAGE_TOO_LARGE");
    expect(() => photoDimensions(0, 10)).toThrow("IMAGE_TOO_LARGE");
  });
  it("decodes orientation with browser defaults, paints transparency white, encodes JPEG and closes its bitmap", async () => {
    const f = canvasFixture(),
      source = new Blob(["png"], { type: "image/png" });
    const blob = await preparePhoto(source);
    expect(createImageBitmap).toHaveBeenCalledWith(source);
    expect(blob.type).toBe("image/jpeg");
    expect(f.fillRect).toHaveBeenCalledWith(0, 0, 2560, 1920);
    expect(f.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      2560,
      1920,
    );
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.canvas.width).toBe(0);
  });
  it("rejects unsupported and oversized source files before decoding", async () => {
    canvasFixture();
    await expect(
      preparePhoto(new Blob(["svg"], { type: "image/svg+xml" })),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(
      preparePhoto(
        new Blob([new Uint8Array(26 * 1024 * 1024)], { type: "image/jpeg" }),
      ),
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it("closes decoded resources on encoding failure", async () => {
    const f = canvasFixture();
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((done) =>
      done(null),
    );
    await expect(
      preparePhoto(new Blob(["jpg"], { type: "image/jpeg" })),
    ).rejects.toMatchObject({ code: "IMAGE_ENCODING_FAILED" });
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.canvas.height).toBe(0);
  });
  it("drops canceled decode results and closes their bitmap", async () => {
    const f = canvasFixture(),
      controller = new AbortController();
    vi.mocked(createImageBitmap).mockImplementation(async () => {
      controller.abort();
      return { width: 10, height: 10, close: f.close } as ImageBitmap;
    });
    await expect(
      preparePhoto(
        new Blob(["jpg"], { type: "image/jpeg" }),
        true,
        controller.signal,
      ),
    ).rejects.toHaveProperty("name", "AbortError");
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.drawImage).not.toHaveBeenCalled();
  });
});
describe("camera lifecycle", () => {
  it("requests video only and stops every track", async () => {
    const stops = [vi.fn(), vi.fn()],
      stream = {
        getTracks: () => stops.map((stop) => ({ stop })),
      } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const camera = new PhotoCamera();
    await camera.start();
    camera.stop();
    camera.stop();
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    stops.forEach((stop) => expect(stop).toHaveBeenCalledTimes(1));
  });
  it("stops a late permission grant after navigation/cancel", async () => {
    let resolve!: (stream: MediaStream) => void;
    const pending = new Promise<MediaStream>((done) => {
        resolve = done;
      }),
      stop = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => pending },
    });
    const camera = new PhotoCamera(),
      starting = camera.start();
    camera.stop();
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await expect(starting).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it("turns denial and missing support into a usable file-selection fallback error", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("denied", "NotAllowedError");
        }),
      },
    });
    await expect(new PhotoCamera().start()).rejects.toMatchObject({
      code: "CAMERA_UNAVAILABLE",
    });
    vi.stubGlobal("navigator", {});
    await expect(new PhotoCamera().start()).rejects.toMatchObject({
      code: "CAMERA_UNAVAILABLE",
    });
  });
  it("captures a JPEG and stops the stream", async () => {
    canvasFixture();
    const stop = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop }] }),
      },
    });
    const camera = new PhotoCamera();
    await camera.start();
    const blob = await camera.capture({
      videoWidth: 640,
      videoHeight: 480,
    } as HTMLVideoElement);
    expect(blob.type).toBe("image/jpeg");
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
