export const MAX_SOURCE_MEDIA_BYTES = 80 * 1024 * 1024;
export const MAX_SOURCE_MEDIA_DURATION_MS = 30 * 60 * 1000;
export const MAX_CLIP_DURATION_MS = 20_000;
export const MIN_CLIP_DURATION_MS = 200;
export const ANALYSIS_SAMPLE_RATE = 16_000;
export const FINE_ADJUST_STEPS = [0.01, 0.05, 0.1, 0.5] as const;
export const PLAYBACK_SPEEDS = [1, 0.9, 0.8, 0.7, 0.6] as const;
export const EXPORT_FORMAT = "japanese-pronunciation-lab" as const;

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

export function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

export function validateTimestamps(startSeconds?: number, endSeconds?: number) {
  if (startSeconds !== undefined && startSeconds < 0) {
    throw new Error("Start time cannot be negative.");
  }
  if (endSeconds !== undefined && endSeconds < 0) {
    throw new Error("End time cannot be negative.");
  }
  if (startSeconds !== undefined && endSeconds !== undefined && endSeconds <= startSeconds) {
    throw new Error("End time must be after start time.");
  }
}

export function formatClock(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = (safe % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${remainder}`;
}

export async function getMediaDurationMs(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const element = document.createElement(blob.type.startsWith("video/") ? "video" : "audio");
    element.preload = "metadata";
    element.src = url;
    const duration = await new Promise<number>((resolve, reject) => {
      element.onloadedmetadata = () => resolve(element.duration);
      element.onerror = () => reject(new Error("This browser could not read the media file."));
    });
    return Number.isFinite(duration) ? Math.round(duration * 1000) : 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}
