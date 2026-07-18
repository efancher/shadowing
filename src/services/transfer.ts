import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import Dexie from "dexie";
import type {
  AudioAsset,
  MediaArchiveManifest,
  MetadataExport,
  MinedSentence,
  PronunciationAttempt,
  ReferenceAudio,
  Source,
  SourceMedia,
  SubtitleCue,
  SubtitleTrack,
  TimingGuide,
  PracticeChunk,
  PracticeEvent
} from "../types";
import { db, type ShadowingDatabase } from "../db/schema";
import { EXPORT_FORMAT, nowIso, validateTimestamps } from "./shared";

type ImportMode = "merge" | "replace";

function withoutReferenceLink(sentence: MinedSentence): Omit<MinedSentence, "referenceAudioId"> {
  const copy = { ...sentence };
  delete copy.referenceAudioId;
  return copy;
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  return "bin";
}

async function blobToUint8Array(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

export class TransferService {
  constructor(private readonly database: ShadowingDatabase = db) {}

  async exportMetadata(): Promise<MetadataExport> {
    const [sources, sentences, referenceClipCount, attemptCount] = await Promise.all([
      this.database.sources.toArray(),
      this.database.sentences.toArray(),
      this.database.referenceAudio.count(),
      this.database.attempts.count()
    ]);
    return {
      manifest: {
        format: EXPORT_FORMAT,
        version: 1,
        exportedAt: nowIso(),
        mediaIncluded: false
      },
      sources,
      sentences: sentences.map(withoutReferenceLink),
      practiceSummary: { referenceClipCount, attemptCount }
    };
  }

  async importMetadata(value: unknown, mode: ImportMode) {
    const data = validateMetadataExport(value);
    await this.database.transaction(
      "rw",
      [
        this.database.sources,
        this.database.sentences,
        this.database.audioAssets,
        this.database.referenceAudio,
        this.database.attempts,
        this.database.derivedAnalyses,
        this.database.sourceMedia,
        this.database.subtitleTracks,
        this.database.subtitleCues,
        this.database.timingGuides,
        this.database.practiceChunks,
        this.database.practiceEvents
      ],
      async () => {
        if (mode === "replace") {
          await Promise.all([
            this.database.sources.clear(),
            this.database.sentences.clear(),
            this.database.audioAssets.clear(),
            this.database.referenceAudio.clear(),
            this.database.attempts.clear(),
            this.database.derivedAnalyses.clear(),
            this.database.sourceMedia.clear(),
            this.database.subtitleTracks.clear(),
            this.database.subtitleCues.clear(),
            this.database.timingGuides.clear(),
            this.database.practiceChunks.clear(),
            this.database.practiceEvents.clear()
          ]);
        } else {
          const sourceIds = new Set(await this.database.sources.toCollection().primaryKeys());
          const sentenceIds = new Set(await this.database.sentences.toCollection().primaryKeys());
          const collision =
            data.sources.some(({ id }) => sourceIds.has(id)) ||
            data.sentences.some(({ id }) => sentenceIds.has(id));
          if (collision) throw new Error("Import contains IDs already in this library. Use Replace instead.");
        }
        await this.database.sources.bulkAdd(data.sources);
        await this.database.sentences.bulkAdd(data.sentences);
      }
    );
  }

  async storageSummary() {
    const [sources, sentences, referenceClips, attempts, assets, sourceMedia] = await Promise.all([
      this.database.sources.count(),
      this.database.sentences.count(),
      this.database.referenceAudio.count(),
      this.database.attempts.count(),
      this.database.audioAssets.toArray(),
      this.database.sourceMedia.toArray()
    ]);
    const referenceBytes = assets
      .filter((asset) => asset.kind === "reference")
      .reduce((total, asset) => total + asset.byteLength, 0);
    const attemptBytes = assets
      .filter((asset) => asset.kind === "attempt")
      .reduce((total, asset) => total + asset.byteLength, 0);
    const sourceMediaBytes = sourceMedia.reduce((total, item) => total + item.byteLength, 0);
    const largest = [...assets, ...sourceMedia]
      .map((item) => ({
        id: item.id,
        label: "originalFileName" in item ? item.originalFileName ?? item.id : item.id,
        bytes: item.byteLength
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5);
    return {
      sources,
      sentences,
      referenceClips,
      attempts,
      mediaBytes: referenceBytes + attemptBytes + sourceMediaBytes,
      referenceBytes,
      attemptBytes,
      sourceMediaBytes,
      largest
    };
  }

  async exportMediaArchive(): Promise<Blob> {
    const [
      sources,
      sentences,
      references,
      attempts,
      assets,
      sourceMedia,
      subtitleTracks,
      subtitleCues,
      timingGuides,
      practiceChunks,
      practiceEvents
    ] = await Promise.all([
      this.database.sources.toArray(),
      this.database.sentences.toArray(),
      this.database.referenceAudio.toArray(),
      this.database.attempts.toArray(),
      this.database.audioAssets.toArray(),
      this.database.sourceMedia.toArray(),
      this.database.subtitleTracks.toArray(),
      this.database.subtitleCues.toArray(),
      this.database.timingGuides.toArray(),
      this.database.practiceChunks.toArray(),
      this.database.practiceEvents.toArray()
    ]);

    const manifest: MediaArchiveManifest = {
      format: EXPORT_FORMAT,
      version: 2,
      exportedAt: nowIso(),
      mediaIncluded: true
    };

    const files: Record<string, Uint8Array> = {
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
      "metadata/sources.json": strToU8(JSON.stringify(sources)),
      "metadata/sentences.json": strToU8(JSON.stringify(sentences)),
      "metadata/references.json": strToU8(JSON.stringify(references)),
      "metadata/attempts.json": strToU8(JSON.stringify(attempts)),
      "metadata/source-media.json": strToU8(
        JSON.stringify(sourceMedia.map((item) => {
          const { blob, ...meta } = item;
          void blob;
          return meta;
        }))
      ),
      "metadata/audio-assets.json": strToU8(
        JSON.stringify(assets.map((item) => {
          const { blob, ...meta } = item;
          void blob;
          return meta;
        }))
      ),
      "metadata/subtitle-tracks.json": strToU8(JSON.stringify(subtitleTracks)),
      "metadata/subtitle-cues.json": strToU8(JSON.stringify(subtitleCues)),
      "metadata/timing-guides.json": strToU8(JSON.stringify(timingGuides)),
      "metadata/practice-chunks.json": strToU8(JSON.stringify(practiceChunks)),
      "metadata/practice-events.json": strToU8(JSON.stringify(practiceEvents))
    };

    for (const asset of assets) {
      files[`media/${asset.id}.${extensionForMime(asset.mimeType)}`] = await blobToUint8Array(asset.blob);
    }
    for (const media of sourceMedia) {
      files[`source-media/${media.id}.${extensionForMime(media.mimeType)}`] = await blobToUint8Array(media.blob);
    }

    const zipped = zipSync(files, { level: 6 });
    return new Blob([zipped], { type: "application/zip" });
  }

  async importMediaArchive(file: File, mode: ImportMode) {
    const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const manifestRaw = unzipped["manifest.json"];
    if (!manifestRaw) throw new Error("Archive is missing manifest.json.");
    const manifest = JSON.parse(strFromU8(manifestRaw)) as MediaArchiveManifest;
    if (manifest.format !== EXPORT_FORMAT || manifest.version !== 2 || !manifest.mediaIncluded) {
      throw new Error("This is not a supported media archive.");
    }

    const sources = JSON.parse(strFromU8(unzipped["metadata/sources.json"])) as Source[];
    const sentences = JSON.parse(strFromU8(unzipped["metadata/sentences.json"])) as MinedSentence[];
    const references = JSON.parse(strFromU8(unzipped["metadata/references.json"])) as ReferenceAudio[];
    const attempts = JSON.parse(strFromU8(unzipped["metadata/attempts.json"])) as PronunciationAttempt[];
    const assetMeta = JSON.parse(strFromU8(unzipped["metadata/audio-assets.json"])) as Array<Omit<AudioAsset, "blob">>;
    const sourceMediaMeta = JSON.parse(strFromU8(unzipped["metadata/source-media.json"])) as Array<
      Omit<SourceMedia, "blob">
    >;
    const subtitleTracks = JSON.parse(strFromU8(unzipped["metadata/subtitle-tracks.json"] ?? strToU8("[]"))) as SubtitleTrack[];
    const subtitleCues = JSON.parse(strFromU8(unzipped["metadata/subtitle-cues.json"] ?? strToU8("[]"))) as SubtitleCue[];
    const timingGuides = JSON.parse(strFromU8(unzipped["metadata/timing-guides.json"] ?? strToU8("[]"))) as TimingGuide[];
    const practiceChunks = JSON.parse(strFromU8(unzipped["metadata/practice-chunks.json"] ?? strToU8("[]"))) as PracticeChunk[];
    const practiceEvents = JSON.parse(strFromU8(unzipped["metadata/practice-events.json"] ?? strToU8("[]"))) as PracticeEvent[];

    const assets: AudioAsset[] = [];
    for (const meta of assetMeta) {
      const key = Object.keys(unzipped).find((name) => name.startsWith(`media/${meta.id}.`));
      if (!key) throw new Error(`Archive is missing media for asset ${meta.id}.`);
      assets.push({ ...meta, blob: new Blob([unzipped[key] as BlobPart], { type: meta.mimeType }) });
    }
    const sourceMedia: SourceMedia[] = [];
    for (const meta of sourceMediaMeta) {
      const key = Object.keys(unzipped).find((name) => name.startsWith(`source-media/${meta.id}.`));
      if (!key) throw new Error(`Archive is missing source media ${meta.id}.`);
      sourceMedia.push({ ...meta, blob: new Blob([unzipped[key] as BlobPart], { type: meta.mimeType }) });
    }

    await this.database.transaction(
      "rw",
      [
        this.database.sources,
        this.database.sentences,
        this.database.audioAssets,
        this.database.referenceAudio,
        this.database.attempts,
        this.database.derivedAnalyses,
        this.database.sourceMedia,
        this.database.subtitleTracks,
        this.database.subtitleCues,
        this.database.timingGuides,
        this.database.practiceChunks,
        this.database.practiceEvents
      ],
      async () => {
        if (mode === "replace") {
          await Promise.all([
            this.database.sources.clear(),
            this.database.sentences.clear(),
            this.database.audioAssets.clear(),
            this.database.referenceAudio.clear(),
            this.database.attempts.clear(),
            this.database.derivedAnalyses.clear(),
            this.database.sourceMedia.clear(),
            this.database.subtitleTracks.clear(),
            this.database.subtitleCues.clear(),
            this.database.timingGuides.clear(),
            this.database.practiceChunks.clear(),
            this.database.practiceEvents.clear()
          ]);
        } else {
          const sourceIds = new Set(await this.database.sources.toCollection().primaryKeys());
          if (sources.some(({ id }) => sourceIds.has(id))) {
            throw new Error("Archive contains IDs already in this library. Use Replace instead.");
          }
        }
        await this.database.sources.bulkAdd(sources);
        await this.database.sentences.bulkAdd(sentences);
        await this.database.audioAssets.bulkAdd(assets);
        await this.database.referenceAudio.bulkAdd(references);
        await this.database.attempts.bulkAdd(attempts);
        await this.database.sourceMedia.bulkAdd(sourceMedia);
        await this.database.subtitleTracks.bulkAdd(subtitleTracks);
        await this.database.subtitleCues.bulkAdd(subtitleCues);
        await this.database.timingGuides.bulkAdd(timingGuides);
        await this.database.practiceChunks.bulkAdd(practiceChunks);
        await this.database.practiceEvents.bulkAdd(practiceEvents);
      }
    );
  }
}

export function validateMetadataExport(value: unknown): MetadataExport {
  if (!value || typeof value !== "object") throw new Error("Backup must be a JSON object.");
  const data = value as Partial<MetadataExport>;
  if (
    data.manifest?.format !== EXPORT_FORMAT ||
    data.manifest.version !== 1 ||
    !Array.isArray(data.sources) ||
    !Array.isArray(data.sentences)
  ) {
    throw new Error("This is not a supported Japanese Pronunciation Lab metadata backup.");
  }
  const sourceIds = new Set<string>();
  for (const source of data.sources) {
    if (!source?.id || !source.title || sourceIds.has(source.id)) throw new Error("Backup has invalid sources.");
    sourceIds.add(source.id);
  }
  for (const sentence of data.sentences) {
    if (!sentence?.id || !sentence.japanese || !sourceIds.has(sentence.sourceId)) {
      throw new Error("Backup has an invalid sentence or missing source.");
    }
    validateTimestamps(sentence.startSeconds, sentence.endSeconds);
  }
  return data as MetadataExport;
}

export function isQuotaError(error: unknown) {
  return (
    error instanceof Dexie.QuotaExceededError ||
    (error instanceof DOMException && error.name === "QuotaExceededError")
  );
}
