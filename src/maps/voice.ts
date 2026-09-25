import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

/**
 * Spoken directions. The phone's own speech engine, so it works offline and
 * costs nothing: the Capacitor plugin on the phone (Android's WebView has no
 * speech of its own), the browser's speech in a browser.
 */
const LOCALES: Record<string, string> = { en: "en-IN", hi: "hi-IN", bn: "bn-IN", ta: "ta-IN", te: "te-IN", mr: "mr-IN", kn: "kn-IN", ml: "ml-IN", gu: "gu-IN", or: "or-IN" };

export async function speak(text: string, lang = "en"): Promise<void> {
  const locale = LOCALES[lang] ?? "en-IN";
  try {
    if (Capacitor.isNativePlatform()) {
      await TextToSpeech.stop().catch(() => undefined);
      await TextToSpeech.speak({ text, lang: locale, rate: 1.0, category: "playback" });
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = locale;
      window.speechSynthesis.speak(u);
    }
  } catch {
    // No voice on this phone: the words are on screen anyway.
  }
}

export function stopSpeaking(): void {
  try {
    if (Capacitor.isNativePlatform()) void TextToSpeech.stop();
    else if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  } catch {
    /* nothing to stop */
  }
}
