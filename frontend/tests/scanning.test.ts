import { afterEach, describe, expect, it, vi } from "vitest";
import {
  scannedBox,
  decodeQr,
  QrCamera,
  NfcScanner,
  nfcAvailable,
} from "../src/services/scanning";
import qr from "./fixtures/qr-rgba.json";
import { BOX } from "./library-fixtures";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("QR scanning", () => {
  it("decodes pixels from a real generated QR with no native detector", async () => {
    const data = new Uint8ClampedArray(Buffer.from(qr.rgba, "base64"));
    const value = await decodeQr(data, qr.width, qr.height);
    expect(scannedBox(value, "https://boxes.example")).toBe(BOX);
    await expect(decodeQr(data, 4096, 4096)).rejects.toThrow("INVALID_IMAGE");
    expect(await decodeQr(new Uint8ClampedArray(400), 10, 10)).toBeUndefined();
  });
  it.each([
    "hello",
    `http://boxes.example/box/${BOX}`,
    `https://other.example/box/${BOX}`,
    `https://boxes.example/box/${BOX}?q=1`,
    `https://boxes.example/box/${BOX}#x`,
    `https://boxes.example/box/${BOX}/`,
    `https://boxes.example/box/${BOX.toUpperCase()}`,
    `https://boxes.example/box/%39${BOX.slice(1)}`,
    `https://boxes.example@evil.example/box/${BOX}`,
    `https://boxes.example/box/../box/${BOX}`,
  ])("rejects unrelated or noncanonical QR %s", (value) => {
    expect(() => scannedBox(value, "https://boxes.example")).toThrow(
      "INVALID_QR_URL",
    );
  });
  it("stops tracks and fences a permission response arriving after cancellation", async () => {
    const scanner = new QrCamera();
    let release!: (stream: MediaStream) => void;
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            release = resolve;
          }),
      },
    });
    const video = document.createElement("video");
    const start = scanner.start(video, vi.fn(), vi.fn());
    scanner.stop();
    release(stream);
    await expect(start).rejects.toThrow("CONTEXT_CHANGED");
    expect(stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeUndefined();
  });
});
class Reader extends EventTarget {
  static current: Reader;
  signal?: AbortSignal;
  constructor() {
    super();
    Reader.current = this;
  }
  scan = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
    this.signal = signal;
  });
}
describe("optional Web NFC", () => {
  it("requires deployment enablement, secure top-level context and an available reader", () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("NDEFReader", Reader);
    expect(nfcAvailable(true)).toBe(true);
    expect(nfcAvailable(false)).toBe(false);
    vi.stubGlobal("isSecureContext", false);
    expect(nfcAvailable(true)).toBe(false);
  });
  it("uses serial number only, normalizes byte order, stops after one read and ignores late events", async () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("NDEFReader", Reader);
    const scanner = new NfcScanner(),
      found = vi.fn(),
      failed = vi.fn();
    await scanner.start(true, found, failed);
    const event = new Event("reading");
    Object.assign(event, {
      serialNumber: "04-aa-bb-cc",
      message: { records: [{ data: "another box" }] },
    });
    Reader.current.dispatchEvent(event);
    expect(found).toHaveBeenCalledWith("04AABBCC");
    expect(Reader.current.signal?.aborted).toBe(true);
    Reader.current.dispatchEvent(event);
    expect(found).toHaveBeenCalledOnce();
  });
  it.each(["", "not-a-uid", "04:aa-bb"])(
    "rejects unusable serial %s without trusting NDEF payload",
    async (serialNumber) => {
      vi.stubGlobal("isSecureContext", true);
      vi.stubGlobal("NDEFReader", Reader);
      const scanner = new NfcScanner(),
        found = vi.fn(),
        failed = vi.fn();
      await scanner.start(true, found, failed);
      Reader.current.dispatchEvent(
        Object.assign(new Event("reading"), { serialNumber }),
      );
      expect(found).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INVALID_NFC_ID" }),
      );
    },
  );
  it("handles permission denial and unreadable tags", async () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("NDEFReader", Reader);
    const scanner = new NfcScanner(),
      failed = vi.fn();
    await scanner.start(true, vi.fn(), failed);
    Reader.current.dispatchEvent(new Event("readingerror"));
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NFC_UNREADABLE" }),
    );
  });
});
