import { ClientError } from "./errors";

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export function photoDimensions(width: number, height: number, resize = true) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 40_000_000
  )
    throw new ClientError("IMAGE_TOO_LARGE");
  const scale = resize ? Math.min(1, 2560 / Math.max(width, height)) : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
export function canvasJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== "image/jpeg")
          reject(new ClientError("IMAGE_ENCODING_FAILED"));
        else resolve(blob);
      },
      "image/jpeg",
      0.9,
    ),
  );
}
// Browser decoding honours source orientation. No image bytes enter inventory JSON.
export async function preparePhoto(
  source: Blob,
  resize = true,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(source.type))
    throw new ClientError("INVALID_IMAGE");
  if (!source.size || source.size > MAX_PHOTO_BYTES)
    throw new ClientError("IMAGE_TOO_LARGE");
  signal?.throwIfAborted();
  let bitmap: ImageBitmap | undefined;
  let image: HTMLImageElement | undefined;
  let url: string | undefined;
  const canvas = document.createElement("canvas");
  try {
    if (typeof createImageBitmap === "function")
      bitmap = await createImageBitmap(source);
    else {
      image = new Image();
      url = URL.createObjectURL(source);
      image.src = url;
      await image.decode();
    }
    signal?.throwIfAborted();
    const decoded = bitmap ?? image!;
    const size = photoDimensions(
      bitmap?.width ?? image!.naturalWidth,
      bitmap?.height ?? image!.naturalHeight,
      resize,
    );
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new ClientError("IMAGE_ENCODING_FAILED");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const result = await canvasJpeg(canvas);
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    if (error instanceof ClientError || signal?.aborted) throw error;
    throw new ClientError("INVALID_IMAGE");
  } finally {
    bitmap?.close();
    if (url) URL.revokeObjectURL(url);
    if (image) image.src = "";
    canvas.width = canvas.height = 0;
  }
}

export class PhotoCamera {
  #stream?: MediaStream;
  #epoch = 0;
  async start(): Promise<MediaStream> {
    this.stop();
    const epoch = this.#epoch;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new ClientError("CAMERA_UNAVAILABLE");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (epoch !== this.#epoch) {
        stream.getTracks().forEach((track) => track.stop());
        throw new ClientError("CONTEXT_CHANGED");
      }
      this.#stream = stream;
      return stream;
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError("CAMERA_UNAVAILABLE");
    }
  }
  stop() {
    this.#epoch++;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = undefined;
  }
  async capture(video: HTMLVideoElement): Promise<Blob> {
    if (!this.#stream || !video.videoWidth || !video.videoHeight)
      throw new ClientError("CAMERA_UNAVAILABLE");
    const epoch = this.#epoch;
    const canvas = document.createElement("canvas");
    try {
      const size = photoDimensions(video.videoWidth, video.videoHeight, false);
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new ClientError("IMAGE_ENCODING_FAILED");
      context.drawImage(video, 0, 0);
      const blob = await canvasJpeg(canvas);
      if (epoch !== this.#epoch) throw new ClientError("CONTEXT_CHANGED");
      return blob;
    } finally {
      canvas.width = canvas.height = 0;
      if (epoch === this.#epoch) this.stop();
    }
  }
}
