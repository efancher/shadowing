const RECORDING_MIME_TYPES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus"
] as const;

export const MAX_RECORDING_DURATION_MS = 30_000;

export class RecordingService {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private startedAtMs = 0;

  static supportedMimeType() {
    if (!("MediaRecorder" in window)) return undefined;
    return RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone recording is not supported in this browser.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    const mimeType = RecordingService.supportedMimeType();
    this.recorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType })
      : new MediaRecorder(this.stream);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.startedAtMs = Date.now();
    this.recorder.start();
  }

  async stop(): Promise<{ blob: Blob; durationMs: number }> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") throw new Error("No recording is in progress.");
    const mimeType = recorder.mimeType || RecordingService.supportedMimeType() || "audio/mp4";
    return new Promise((resolve, reject) => {
      recorder.onerror = () => {
        this.cleanup();
        reject(new Error("Recording failed."));
      };
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: mimeType });
        const durationMs = Date.now() - this.startedAtMs;
        this.cleanup();
        if (!blob.size) reject(new Error("No audio was captured."));
        else resolve({ blob, durationMs });
      };
      recorder.stop();
    });
  }

  cancel() {
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
    this.cleanup();
  }

  private cleanup() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.recorder = undefined;
  }
}

export interface CalibrationResult {
  ambientRms: number;
  speechRms: number;
  peak: number;
  clipping: boolean;
  guidance: string[];
}

export async function calibrateMicrophone(durationMs = 2500): Promise<CalibrationResult> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const samples: number[] = [];
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      let peak = 0;
      for (const sample of data) {
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      samples.push(Math.sqrt(sum / data.length), peak);
      if (performance.now() - started >= durationMs) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });
  stream.getTracks().forEach((track) => track.stop());
  await context.close().catch(() => undefined);
  const rmsValues = samples.filter((_, index) => index % 2 === 0);
  const peaks = samples.filter((_, index) => index % 2 === 1);
  const ambientRms = rmsValues.slice(0, Math.ceil(rmsValues.length / 3)).reduce((a, b) => a + b, 0) /
    Math.max(1, Math.ceil(rmsValues.length / 3));
  const speechRms = rmsValues.slice(Math.ceil(rmsValues.length / 3)).reduce((a, b) => a + b, 0) /
    Math.max(1, rmsValues.length - Math.ceil(rmsValues.length / 3));
  const peak = Math.max(...peaks, 0);
  const clipping = peak > 0.98;
  const guidance: string[] = [];
  if (speechRms < 0.02) guidance.push("Move closer to the microphone.");
  if (clipping) guidance.push("The recording is clipping. Move farther away or lower input volume.");
  if (ambientRms > 0.03) guidance.push("Background noise may interfere with pitch detection.");
  if (guidance.length === 0) guidance.push("Microphone levels look usable.");
  return { ambientRms, speechRms, peak, clipping, guidance };
}

function playUntilEnded(audio: HTMLAudioElement, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      audio.pause();
      audio.currentTime = 0;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Audio playback failed."));
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    audio.currentTime = 0;
    audio.play().catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

export class PlaybackCoordinator {
  private controller?: AbortController;

  cancel() {
    this.controller?.abort();
    this.controller = undefined;
  }

  async alternate(reference: HTMLAudioElement, learner: HTMLAudioElement, gapMs = 250) {
    this.cancel();
    this.controller = new AbortController();
    const { signal } = this.controller;
    await playUntilEnded(reference, signal);
    if (signal.aborted) return;
    await new Promise((resolve) => window.setTimeout(resolve, gapMs));
    if (signal.aborted) return;
    await playUntilEnded(learner, signal);
  }

  async playSequence(players: HTMLAudioElement[], gapMs = 200) {
    this.cancel();
    this.controller = new AbortController();
    const { signal } = this.controller;
    for (const player of players) {
      if (signal.aborted) return;
      await playUntilEnded(player, signal);
      if (signal.aborted) return;
      await new Promise((resolve) => window.setTimeout(resolve, gapMs));
    }
  }
}
