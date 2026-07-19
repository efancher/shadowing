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
  SourceType,
  SubtitleCue,
  SubtitleTrack,
  TimingGuide,
  PracticeChunk,
  PracticeEvent,
  TranscriptStatus
} from "../types";
import { db, type ShadowingDatabase } from "../db/schema";
import { EXPORT_FORMAT, newId, nowIso, validateTimestamps } from "./shared";

type ImportMode = "merge" | "replace";
export type PackageImportMode = "merge" | "replace" | "keep-both";

const PACKAGE_FORMAT = "japanese-shadowing-package" as const;

export interface PackageImportSummary {
  title: string;
  channel?: string;
  sentenceCount: number;
  audioCount: number;
  /** True when IDs collide with a different source (merge blocked). */
  hasConflict: boolean;
  /** True when the same source id already exists and can be refreshed via merge. */
  canRefresh: boolean;
  sourceId: string;
}

export interface PackageImportResult {
  sourceId: string;
  sourceTitle: string;
  sentenceCount: number;
  audioCount: number;
}

interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  version: 1;
  createdAt: string;
  generator: { name: string; version: string };
}

interface PackageSource {
  id: string;
  type: SourceType;
  url?: string;
  videoId?: string;
  title: string;
  channel?: string;
  durationMs?: number;
}

interface PackageSentence {
  id: string;
  japanese: string;
  reading?: string;
  english?: string;
  startMs: number;
  endMs: number;
  speaker?: string;
  tags: string[];
  notes?: string;
  transcriptStatus: "unverified" | "auto-caption" | "manually-corrected" | "verified";
  audio: {
    path: string;
    mimeType: string;
    durationMs: number;
  };
}

interface ParsedPackage {
  manifest: PackageManifest;
  source: PackageSource;
  sentences: PackageSentence[];
  files: Record<string, Uint8Array>;
}

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

type ZipInput = Blob | ArrayBuffer | Uint8Array;

async function toUint8Array(input: ZipInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input.arrayBuffer === "function") {
    return new Uint8Array(await input.arrayBuffer());
  }
  return new Uint8Array(await new Response(input).arrayBuffer());
}

async function blobToUint8Array(blob: Blob) {
  return toUint8Array(blob);
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

  async inspectShadowingPackage(file: ZipInput): Promise<PackageImportSummary> {
    const files = unzipSync(await toUint8Array(file));
    const parsed = parseShadowingPackage(files);
    const existingSource = await this.database.sources.get(parsed.source.id);
    const existingSentences = await this.database.sentences.toArray();
    const existingSentenceIds = new Set(existingSentences.map((sentence) => sentence.id));
    const sentenceOwner = new Map(existingSentences.map((sentence) => [sentence.id, sentence.sourceId]));
    const colliding = parsed.sentences.filter((sentence) => existingSentenceIds.has(sentence.id));
    const canRefresh =
      Boolean(existingSource) &&
      colliding.every((sentence) => sentenceOwner.get(sentence.id) === parsed.source.id);
    const hasConflict =
      (!existingSource && colliding.length > 0) ||
      (Boolean(existingSource) && !canRefresh);
    return {
      title: parsed.source.title,
      channel: parsed.source.channel,
      sentenceCount: parsed.sentences.length,
      audioCount: parsed.sentences.length,
      hasConflict,
      canRefresh,
      sourceId: parsed.source.id
    };
  }

  async importShadowingPackage(file: ZipInput, mode: PackageImportMode): Promise<PackageImportResult> {
    const files = unzipSync(await toUint8Array(file));
    const parsed = parseShadowingPackage(files);
    const timestamp = nowIso();
    let sourceId = parsed.source.id;
    const sentenceIdMap = new Map<string, string>();

    const existingSource = await this.database.sources.get(parsed.source.id);
    const existingSentences = await this.database.sentences.toArray();
    const existingSentenceIds = new Set(existingSentences.map((sentence) => sentence.id));
    const sentenceOwner = new Map(existingSentences.map((sentence) => [sentence.id, sentence.sourceId]));
    const collidingIds = parsed.sentences.filter((sentence) => existingSentenceIds.has(sentence.id));
    const sameSourceRefresh =
      mode === "merge" &&
      Boolean(existingSource) &&
      collidingIds.every((sentence) => sentenceOwner.get(sentence.id) === parsed.source.id);

    if (mode === "keep-both") {
      sourceId = newId();
      for (const sentence of parsed.sentences) {
        sentenceIdMap.set(sentence.id, newId());
      }
    } else if (mode === "merge") {
      if (existingSource && !sameSourceRefresh) {
        throw new Error("Package contains IDs already in this library. Use Keep both or Replace.");
      }
      if (!existingSource && collidingIds.length > 0) {
        throw new Error("Package contains IDs already in this library. Use Keep both or Replace.");
      }
      for (const sentence of parsed.sentences) {
        sentenceIdMap.set(sentence.id, sentence.id);
      }
    } else {
      for (const sentence of parsed.sentences) {
        sentenceIdMap.set(sentence.id, sentence.id);
      }
    }

    const source: Source = {
      id: sourceId,
      type: parsed.source.type,
      title: parsed.source.title,
      url: parsed.source.url,
      externalId: parsed.source.videoId,
      channelOrCreator: parsed.source.channel,
      notes: `Imported from ${PACKAGE_FORMAT} v1 (${parsed.manifest.generator.name} ${parsed.manifest.generator.version})`,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const assets: AudioAsset[] = [];
    const references: ReferenceAudio[] = [];
    const sentences: MinedSentence[] = [];

    for (const packageSentence of parsed.sentences) {
      const sentenceId = sentenceIdMap.get(packageSentence.id) ?? packageSentence.id;
      const assetId = newId();
      const referenceId = newId();
      const audioBytes = files[assertSafeZipPath(packageSentence.audio.path)];
      assets.push({
        id: assetId,
        kind: "reference",
        blob: new Blob([audioBytes as BlobPart], { type: packageSentence.audio.mimeType }),
        mimeType: packageSentence.audio.mimeType,
        byteLength: audioBytes.byteLength,
        durationMs: packageSentence.audio.durationMs,
        originalFileName: packageSentence.audio.path.split("/").at(-1),
        createdAt: timestamp
      });
      references.push({
        id: referenceId,
        sentenceId,
        audioAssetId: assetId,
        sourceType: "local-media-clip",
        originalStartSeconds: packageSentence.startMs / 1000,
        originalEndSeconds: packageSentence.endMs / 1000,
        createdAt: timestamp
      });
      sentences.push({
        id: sentenceId,
        sourceId,
        japanese: packageSentence.japanese.trim(),
        reading: packageSentence.reading,
        english: packageSentence.english,
        startSeconds: packageSentence.startMs / 1000,
        endSeconds: packageSentence.endMs / 1000,
        speakerLabel: packageSentence.speaker,
        tags: packageSentence.tags ?? [],
        notes: packageSentence.notes,
        transcriptStatus: mapTranscriptStatus(packageSentence.transcriptStatus),
        referenceAudioId: referenceId,
        createdAt: timestamp,
        updatedAt: timestamp
      });
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
        } else if (sameSourceRefresh) {
          const oldSentences = await this.database.sentences.where("sourceId").equals(parsed.source.id).toArray();
          const oldSentenceIds = oldSentences.map((sentence) => sentence.id);
          if (oldSentenceIds.length > 0) {
            const oldRefs = await this.database.referenceAudio.where("sentenceId").anyOf(oldSentenceIds).toArray();
            const oldAssetIds = oldRefs.map((reference) => reference.audioAssetId);
            await this.database.sentences.bulkDelete(oldSentenceIds);
            if (oldRefs.length > 0) {
              await this.database.referenceAudio.bulkDelete(oldRefs.map((reference) => reference.id));
            }
            if (oldAssetIds.length > 0) {
              await this.database.audioAssets.bulkDelete(oldAssetIds);
            }
            const kept = new Set(sentences.map((sentence) => sentence.id));
            const staleAttemptIds = (await this.database.attempts.where("sentenceId").anyOf(oldSentenceIds).toArray())
              .filter((attempt) => !kept.has(attempt.sentenceId))
              .map((attempt) => attempt.id);
            if (staleAttemptIds.length > 0) {
              await this.database.attempts.bulkDelete(staleAttemptIds);
            }
          }
        }
        await this.database.sources.put(source);
        await this.database.sentences.bulkPut(sentences);
        await this.database.audioAssets.bulkPut(assets);
        await this.database.referenceAudio.bulkPut(references);
      }
    );

    return {
      sourceId,
      sourceTitle: source.title,
      sentenceCount: sentences.length,
      audioCount: assets.length
    };
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

function assertSafeZipPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe path in package: ${path}`);
  }
  return normalized;
}

function mapTranscriptStatus(status: PackageSentence["transcriptStatus"]): TranscriptStatus {
  if (status === "auto-caption") return "machine-generated";
  return status;
}

function parseShadowingPackage(files: Record<string, Uint8Array>): ParsedPackage {
  for (const name of Object.keys(files)) assertSafeZipPath(name);
  const manifestRaw = files["manifest.json"];
  const sourceRaw = files["source.json"];
  const sentencesRaw = files["sentences.json"];
  if (!manifestRaw || !sourceRaw || !sentencesRaw) {
    throw new Error("Package must include manifest.json, source.json, and sentences.json.");
  }
  const manifest = JSON.parse(strFromU8(manifestRaw)) as PackageManifest;
  if (manifest.format !== PACKAGE_FORMAT || manifest.version !== 1) {
    throw new Error("This is not a supported japanese-shadowing-package v1 file.");
  }
  const source = JSON.parse(strFromU8(sourceRaw)) as PackageSource;
  const sentences = JSON.parse(strFromU8(sentencesRaw)) as PackageSentence[];
  if (!source?.id || !source.title) throw new Error("Package source.json is invalid.");
  if (!Array.isArray(sentences) || sentences.length === 0) {
    throw new Error("Package sentences.json must contain at least one sentence.");
  }
  for (const sentence of sentences) {
    if (!sentence?.id || !sentence.japanese?.trim()) {
      throw new Error("Package has an invalid sentence.");
    }
    if (sentence.endMs <= sentence.startMs) {
      throw new Error(`Sentence ${sentence.id} has invalid timestamps.`);
    }
    const audioPath = assertSafeZipPath(sentence.audio?.path ?? "");
    if (!audioPath.startsWith("audio/")) {
      throw new Error(`Audio path must be under audio/: ${audioPath}`);
    }
    if (!files[audioPath]) {
      throw new Error(`Package is missing audio file ${audioPath}.`);
    }
    if (!sentence.audio.durationMs || sentence.audio.durationMs < 1) {
      throw new Error(`Sentence ${sentence.id} has invalid audio duration.`);
    }
  }
  return { manifest, source, sentences, files };
}
