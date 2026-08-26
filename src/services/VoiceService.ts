/**
 * Voice notes.
 *
 * The feature that matters most for these users specifically: a rider cannot
 * type at a junction, and in this market plenty of drivers would rather speak
 * than write — in a language whose keyboard their phone may not even have.
 *
 * Deliberately not calls. Real calling needs a signalling server, STUN, and a
 * TURN relay for the carrier NAT most drivers sit behind, which is running
 * infrastructure with a bandwidth bill. A voice note needs a microphone and the
 * upload path the app already has.
 */

/** Above this a note is a monologue, and a monologue is a phone call. */
export const MAX_SECONDS = 120;

/** Stop before the upload becomes a problem on a 3G connection. */
export const MAX_BYTES = 2 * 1024 * 1024;

export interface RecordedVoice {
  blob: Blob;
  seconds: number;
  /** Object URL for local playback before it is sent. Release it afterwards. */
  preview: string;
  mimeType: string;
  /** Coarse loudness per slice, 0..1, for drawing a waveform. */
  levels: number[];
}

/**
 * The first container the browser will actually record.
 *
 * Android's WebView gives webm/opus; iOS Safari gives mp4/aac and refuses webm
 * outright. Asking for a type it cannot produce throws at construction, so the
 * list is tried in order rather than assumed.
 */
function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((type) => {
    try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
  });
}

export function voiceSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!pickMimeType()
  );
}

export interface Recorder {
  stop: () => Promise<RecordedVoice | null>;
  cancel: () => void;
  /** Seconds elapsed, for the timer next to the button. */
  elapsed: () => number;
  /** Live level 0..1, so the button can pulse with the voice. */
  level: () => number;
}

/**
 * Start recording. Throws if the microphone is refused, which the caller shows
 * as a message rather than silence — a button that does nothing when tapped is
 * how a driver decides the feature is broken.
 */
export async function startRecording(onAutoStop?: () => void): Promise<Recorder> {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error("unsupported");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // A phone in a helmet mount on a main road. These are the difference
      // between a usable note and a recording of the traffic.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  // Loudness, for the waveform and the pulsing button.
  const levels: number[] = [];
  let live = 0;
  let audioCtx: AudioContext | undefined;
  let raf = 0;
  try {
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let lastSample = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
      live = peak;
      // One bar every 100ms is enough shape to read; sampling every frame would
      // give 60 bars a second and a waveform nobody can see.
      const now = performance.now();
      if (now - lastSample > 100) { levels.push(peak); lastSample = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  } catch {
    // No analyser is survivable: the note still records, it just has no shape.
  }

  const startedAt = Date.now();
  let settled = false;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());   // releases the mic indicator
    void audioCtx?.close().catch(() => undefined);
  };

  // Hard stop, so a button held by accident in a pocket cannot record forever.
  const limit = setTimeout(() => {
    if (recorder.state === "recording") { recorder.stop(); onAutoStop?.(); }
  }, MAX_SECONDS * 1000);

  recorder.start(250);

  return {
    elapsed: () => (Date.now() - startedAt) / 1000,
    level: () => live,
    cancel: () => {
      settled = true;
      clearTimeout(limit);
      try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* already stopped */ }
      cleanup();
    },
    stop: () =>
      new Promise<RecordedVoice | null>((resolve) => {
        if (settled) return resolve(null);
        settled = true;
        clearTimeout(limit);
        const seconds = (Date.now() - startedAt) / 1000;
        recorder.onstop = () => {
          cleanup();
          const blob = new Blob(chunks, { type: mimeType });
          // A tap that was not meant as a recording, or a mic that produced
          // nothing. Either way there is no note here, and sending an empty
          // bubble is worse than sending none.
          if (blob.size < 1200 || seconds < 0.7) return resolve(null);
          resolve({
            blob,
            seconds: Math.round(seconds * 10) / 10,
            preview: URL.createObjectURL(blob),
            mimeType,
            levels: levels.slice(),
          });
        };
        try {
          if (recorder.state !== "inactive") recorder.stop();
          else recorder.onstop?.(new Event("stop"));
        } catch {
          cleanup();
          resolve(null);
        }
      }),
  };
}

/** mm:ss, for the timer and the playback bubble. */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Thin a level series down to a fixed number of bars.
 *
 * A two-minute note holds twelve hundred samples and a bubble is sixty pixels
 * wide, so the bars have to be an average of a window rather than every nth
 * sample — picking every nth would drop the loud moments that give a waveform
 * its shape.
 */
export function waveform(levels: number[], bars = 28): number[] {
  if (!levels.length) return new Array(bars).fill(0.15);
  const out: number[] = [];
  const per = levels.length / bars;
  for (let i = 0; i < bars; i++) {
    const from = Math.floor(i * per);
    const to = Math.max(from + 1, Math.floor((i + 1) * per));
    let sum = 0;
    for (let j = from; j < to && j < levels.length; j++) sum += levels[j];
    // A floor, so silence still draws a line rather than a gap.
    out.push(Math.max(0.12, Math.min(1, (sum / (to - from)) * 1.6)));
  }
  return out;
}
