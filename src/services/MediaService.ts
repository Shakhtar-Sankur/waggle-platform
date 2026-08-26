import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

/**
 * A picked photo, ready to upload.
 *
 * Two sizes, because the feed and the viewer want different things: the feed
 * shows dozens of images and only needs ~20 KB each, while the full size is
 * fetched once, on tap. Previously both were the same 479 KB base64 string
 * inlined into the row.
 *
 * `preview` is a local object URL so the composer can show the photo instantly,
 * before any upload happens. Revoke it when you are done with it.
 */
export interface PickedPhoto {
  full: Blob;
  thumb: Blob;
  preview: string;
  /** Pixel size AFTER downscaling — what will actually be sent, not what came
   *  off the camera. Shown in the composer so the driver can see what they are
   *  about to spend data on. */
  width: number;
  height: number;
  /** Encoded size of `full`, in bytes. */
  bytes: number;
}

const FULL_WIDTH = 1280;
const THUMB_WIDTH = 400;
const FULL_QUALITY = 0.72;
const THUMB_QUALITY = 0.6;

function drawScaled(img: HTMLImageElement, maxWidth: number): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
      "image/jpeg",
      quality,
    );
  });
}

/** Decode any image source into the two sizes we store. */
async function encodeBoth(src: string): Promise<PickedPhoto> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not read that image."));
    el.src = src;
  });
  const scaled = drawScaled(img, FULL_WIDTH);
  const full = await toBlob(scaled, FULL_QUALITY);
  const thumb = await toBlob(drawScaled(img, THUMB_WIDTH), THUMB_QUALITY);
  return {
    full,
    thumb,
    preview: URL.createObjectURL(full),
    width: scaled.width,
    height: scaled.height,
    bytes: full.size,
  };
}

// Web / iPhone-Safari picker: a file input, which on mobile offers both the
// photo library and the camera.
function pickWebImage(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const done = (value?: string) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return done(undefined);
      const reader = new FileReader();
      reader.onload = () => done(typeof reader.result === "string" ? reader.result : undefined);
      reader.onerror = () => done(undefined);
      reader.readAsDataURL(file);
    };

    // Resolve if the picker was cancelled, so the caller is never left hanging.
    window.addEventListener(
      "focus",
      () => window.setTimeout(() => { if (!input.files?.length) done(undefined); }, 1000),
      { once: true },
    );

    input.click();
  });
}


/** A short video chosen for a reel, kept as a File so it uploads unmodified. */
export interface PickedVideo {
  file: File;
  preview: string;      // object URL for the <video> element
  durationSeconds: number;
  sizeBytes: number;
}

// Deliberately small. These drivers pay for mobile data by the megabyte, and
// the app has no transcoding — whatever the phone produces is what gets
// uploaded, so the limit is the only thing protecting them from a 200 MB clip.
export const REEL_MAX_BYTES = 30 * 1024 * 1024;   // 30 MB
export const REEL_MAX_SECONDS = 60;

/** Read a video's duration without decoding the whole file. */
function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => resolve(0);
    v.src = url;
  });
}

export const MediaService = {

  /**
   * Pick a short video for a reel.
   *
   * Returns a reason rather than throwing when the clip is rejected, so the
   * composer can tell the driver WHY — "too long" and "too big" need different
   * answers from them.
   */
  async pickVideo(): Promise<
    { ok: true; video: PickedVideo } | { ok: false; reason: "cancelled" | "tooBig" | "tooLong" }
  > {
    const file = await new Promise<File | undefined>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/mp4,video/quicktime,video/webm";
      input.style.display = "none";
      document.body.appendChild(input);
      let settled = false;
      const done = (f?: File) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(f);
      };
      input.onchange = () => done(input.files?.[0] ?? undefined);
      window.addEventListener(
        "focus",
        () => window.setTimeout(() => { if (!input.files?.length) done(undefined); }, 1000),
        { once: true },
      );
      input.click();
    });

    if (!file) return { ok: false, reason: "cancelled" };
    if (file.size > REEL_MAX_BYTES) return { ok: false, reason: "tooBig" };

    const preview = URL.createObjectURL(file);
    const durationSeconds = await probeDuration(preview);
    if (durationSeconds > REEL_MAX_SECONDS) {
      URL.revokeObjectURL(preview);
      return { ok: false, reason: "tooLong" };
    }
    return { ok: true, video: { file, preview, durationSeconds, sizeBytes: file.size } };
  },
  /**
   * Open the camera or gallery and return the photo at two sizes, or undefined
   * if the driver cancelled or denied permission.
   */
  async pickImage(): Promise<PickedPhoto | undefined> {
    let source: string | undefined;

    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Prompt,
          quality: 80, // re-encoded below; keep detail until then
          width: FULL_WIDTH,
          allowEditing: false,
        });
        source = photo.dataUrl;
      } catch {
        return undefined; // cancelled or permission denied
      }
    } else {
      source = await pickWebImage();
    }

    if (!source) return undefined;
    try {
      return await encodeBoth(source);
    } catch {
      return undefined;
    }
  },

  async pickChatImage(): Promise<PickedPhoto | undefined> {
    return this.pickImage();
  },

  /** Free a preview object URL. Safe to call with a remote URL or undefined. */
  releasePreview(preview?: string) {
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
  },

  /**
   * Older posts stored the whole image inline as a data: URL. They still render
   * — this is how the UI tells one from the other.
   */
  isLegacyInlineImage(url?: string) {
    return !!url?.startsWith("data:");
  },
};
