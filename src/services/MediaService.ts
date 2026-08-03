import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

// Web / iPhone-Safari picker: a file input (which offers Photo Library + Take
// Photo on mobile), downscaled to keep the image small.
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
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxWidth = 1280;
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
          try {
            done(canvas.toDataURL("image/jpeg", 0.72));
          } catch {
            done(typeof reader.result === "string" ? reader.result : undefined);
          }
        };
        img.onerror = () => done(typeof reader.result === "string" ? reader.result : undefined);
        img.src = reader.result as string;
      };
      reader.onerror = () => done(undefined);
      reader.readAsDataURL(file);
    };

    // Resolve if the picker is cancelled (no file chosen).
    window.addEventListener(
      "focus",
      () => window.setTimeout(() => { if (!input.files?.length) done(undefined); }, 1000),
      { once: true },
    );

    input.click();
  });
}

export const MediaService = {
  // Opens the camera/gallery (asking permission) and returns a compressed
  // data-URL image, or undefined if cancelled.
  async pickImage(): Promise<string | undefined> {
    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Prompt, // lets the user choose Camera or Photos
          quality: 60,
          width: 1280,
          allowEditing: false,
        });
        return photo.dataUrl;
      } catch {
        return undefined; // cancelled or permission denied
      }
    }
    return pickWebImage();
  },

  async pickChatImage(): Promise<string | undefined> {
    return this.pickImage();
  },
};
