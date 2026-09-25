import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Hand a file to the person: a download in a browser, and on a phone the share
 * sheet (save to Files, WhatsApp it to the accountant, print). An Android web
 * view cannot download a blob, which is why the phone takes the other road.
 */
export async function saveFile(name: string, mime: string, content: Uint8Array | string) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
    await Share.share({ title: name, url: written.uri, dialogTitle: name });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
