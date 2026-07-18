import type { ReferenceAudio, SourceMedia, SourceMediaKind } from "../types";
import { db, type ShadowingDatabase } from "../db/schema";
import { AssetService } from "./assets";
import {
  cleanOptional,
  getMediaDurationMs,
  MAX_CLIP_DURATION_MS,
  MAX_SOURCE_MEDIA_BYTES,
  MAX_SOURCE_MEDIA_DURATION_MS,
  MIN_CLIP_DURATION_MS,
  newId,
  nowIso,
  validateTimestamps
} from "./shared";

function inferMediaKind(file: File): SourceMediaKind {
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name)) return "video";
  return "audio";
}

export async function decodeAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    const data = await blob.arrayBuffer();
    return await context.decodeAudioData(data.slice(0));
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function sliceAudioBuffer(
  buffer: AudioBuffer,
  startSeconds: number,
  endSeconds: number
): AudioBuffer {
  validateTimestamps(startSeconds, endSeconds);
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSeconds * sampleRate));
  const endSample = Math.min(buffer.length, Math.ceil(endSeconds * sampleRate));
  const frameCount = Math.max(1, endSample - startSample);
  const context = new OfflineAudioContext(1, frameCount, sampleRate);
  const sliced = context.createBuffer(1, frameCount, sampleRate);
  const mono = sliced.getChannelData(0);
  const channelCount = buffer.numberOfChannels;
  for (let i = 0; i < frameCount; i += 1) {
    let sample = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      sample += buffer.getChannelData(channel)[startSample + i] ?? 0;
    }
    mono[i] = sample / channelCount;
  }
  return sliced;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const samples = buffer.getChannelData(0);
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export class MediaImportService {
  constructor(private readonly database: ShadowingDatabase = db) {}

  async attachSourceMedia(sourceId: string, file: File): Promise<SourceMedia> {
    if (!(await this.database.sources.get(sourceId))) throw new Error("Source not found.");
    if (file.size > MAX_SOURCE_MEDIA_BYTES) {
      throw new Error(`Media must be under ${Math.round(MAX_SOURCE_MEDIA_BYTES / (1024 * 1024))} MB.`);
    }
    const durationMs = await getMediaDurationMs(file);
    if (durationMs > MAX_SOURCE_MEDIA_DURATION_MS) {
      throw new Error("Media longer than 30 minutes is not supported on mobile browsers.");
    }
    const media: SourceMedia = {
      id: newId(),
      sourceId,
      kind: inferMediaKind(file),
      blob: file,
      mimeType: file.type || "application/octet-stream",
      byteLength: file.size,
      durationMs,
      originalFileName: cleanOptional(file.name),
      createdAt: nowIso()
    };
    await this.database.transaction("rw", this.database.sourceMedia, this.database.sources, async () => {
      const existing = await this.database.sourceMedia.where("sourceId").equals(sourceId).toArray();
      await Promise.all(existing.map((item) => this.database.sourceMedia.delete(item.id)));
      await this.database.sourceMedia.add(media);
      await this.database.sources.update(sourceId, {
        type: media.kind === "video" ? "uploaded-video" : "uploaded-audio",
        updatedAt: nowIso()
      });
    });
    return media;
  }

  async removeSourceMedia(sourceId: string) {
    await this.database.sourceMedia.where("sourceId").equals(sourceId).delete();
  }
}

export class ClipExportService {
  private readonly assets: AssetService;

  constructor(private readonly database: ShadowingDatabase = db) {
    this.assets = new AssetService(database);
  }

  async saveClipAsReference(options: {
    sentenceId: string;
    media: SourceMedia | Blob;
    startSeconds: number;
    endSeconds: number;
    originalFileName?: string;
    discardSourceMediaId?: string;
  }): Promise<ReferenceAudio> {
    const durationMs = Math.round((options.endSeconds - options.startSeconds) * 1000);
    if (durationMs < MIN_CLIP_DURATION_MS) throw new Error("Clip is too short.");
    if (durationMs > MAX_CLIP_DURATION_MS) throw new Error("Clip must be 20 seconds or shorter.");
    const sentence = await this.database.sentences.get(options.sentenceId);
    if (!sentence) throw new Error("Sentence not found.");

    const blob = options.media instanceof Blob ? options.media : options.media.blob;
    const decoded = await decodeAudioBuffer(blob);
    const sliced = sliceAudioBuffer(decoded, options.startSeconds, options.endSeconds);
    const wav = encodeWav(sliced);
    const asset = await this.assets.createAsset("reference", wav, options.originalFileName ?? "clip.wav", durationMs);
    const reference: ReferenceAudio = {
      id: newId(),
      sentenceId: options.sentenceId,
      audioAssetId: asset.id,
      sourceType: "local-media-clip",
      originalStartSeconds: options.startSeconds,
      originalEndSeconds: options.endSeconds,
      createdAt: nowIso()
    };

    await this.database.transaction(
      "rw",
      [
        this.database.sentences,
        this.database.audioAssets,
        this.database.referenceAudio,
        this.database.sourceMedia,
        this.database.derivedAnalyses
      ],
      async () => {
        const previous = await this.database.referenceAudio.where("sentenceId").equals(options.sentenceId).first();
        if (previous) {
          await this.database.referenceAudio.delete(previous.id);
          await this.database.audioAssets.delete(previous.audioAssetId);
          await this.database.derivedAnalyses
            .where("subjectId")
            .equals(previous.audioAssetId)
            .delete();
        }
        await this.database.audioAssets.add(asset);
        await this.database.referenceAudio.add(reference);
        await this.database.sentences.update(options.sentenceId, {
          referenceAudioId: reference.id,
          startSeconds: options.startSeconds,
          endSeconds: options.endSeconds,
          updatedAt: nowIso()
        });
        if (options.discardSourceMediaId) {
          await this.database.sourceMedia.delete(options.discardSourceMediaId);
        }
      }
    );
    return reference;
  }
}
