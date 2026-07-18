import Dexie from "dexie";
import { db, type ShadowingDatabase } from "../db/schema";
import type {
  AudioAsset,
  MetadataExport,
  MinedSentence,
  PronunciationAttempt,
  ReferenceAudio,
  Source,
  SourceType,
  TranscriptStatus
} from "../types";

const RECORDING_MIME_TYPES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus"
] as const;
export const MAX_RECORDING_DURATION_MS = 30_000;
const EXPORT_FORMAT = "japanese-pronunciation-lab";
const EXPORT_VERSION = 1;

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

function withoutReferenceLink(sentence: MinedSentence): Omit<MinedSentence, "referenceAudioId"> {
  const copy = { ...sentence };
  delete copy.referenceAudioId;
  return copy;
}

export interface CreateSourceInput {
  type: SourceType;
  title: string;
  url?: string;
  channelOrCreator?: string;
  notes?: string;
}

export interface CreateSentenceInput {
  sourceId: string;
  japanese: string;
  reading?: string;
  english?: string;
  startSeconds?: number;
  endSeconds?: number;
  speakerLabel?: string;
  tags?: string[];
  difficulty?: number;
  notes?: string;
  transcriptStatus?: TranscriptStatus;
}

function cleanOptional(value?: string) {
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

export class SentenceService {
  constructor(private readonly database: ShadowingDatabase = db) {}

  async createSource(input: CreateSourceInput): Promise<Source> {
    const title = input.title.trim();
    if (!title) throw new Error("Source title is required.");
    const timestamp = now();
    const source: Source = {
      id: newId(),
      type: input.type,
      title,
      url: cleanOptional(input.url),
      channelOrCreator: cleanOptional(input.channelOrCreator),
      notes: cleanOptional(input.notes),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.database.sources.add(source);
    return source;
  }

  async createSentence(input: CreateSentenceInput): Promise<MinedSentence> {
    const japanese = input.japanese.trim();
    if (!japanese) throw new Error("Japanese text is required.");
    validateTimestamps(input.startSeconds, input.endSeconds);
    if (!(await this.database.sources.get(input.sourceId))) {
      throw new Error("The selected source does not exist.");
    }
    const timestamp = now();
    const sentence: MinedSentence = {
      id: newId(),
      sourceId: input.sourceId,
      japanese,
      reading: cleanOptional(input.reading),
      english: cleanOptional(input.english),
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      speakerLabel: cleanOptional(input.speakerLabel),
      tags: input.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
      difficulty: input.difficulty,
      notes: cleanOptional(input.notes),
      transcriptStatus: input.transcriptStatus ?? "unverified",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.database.transaction("rw", this.database.sentences, this.database.sources, async () => {
      await this.database.sentences.add(sentence);
      await this.database.sources.update(input.sourceId, { updatedAt: timestamp });
    });
    return sentence;
  }
}

async function getAudioDurationMs(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = url;
    const duration = await new Promise<number>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error("This browser could not read the audio file."));
    });
    return Number.isFinite(duration) ? Math.round(duration * 1000) : 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface UrlLease {
  url: string;
  release: () => void;
}

interface UrlEntry {
  url: string;
  consumers: number;
}

export class AssetService {
  private readonly urls = new Map<string, UrlEntry>();

  constructor(private readonly database: ShadowingDatabase = db) {}

  async createAsset(
    kind: AudioAsset["kind"],
    blob: Blob,
    originalFileName?: string,
    knownDurationMs?: number
  ): Promise<AudioAsset> {
    if (!blob.size) throw new Error("The audio file is empty.");
    return {
      id: newId(),
      kind,
      blob,
      mimeType: blob.type || "application/octet-stream",
      byteLength: blob.size,
      durationMs: knownDurationMs ?? (await getAudioDurationMs(blob)),
      originalFileName,
      createdAt: now()
    };
  }

  async acquireUrl(assetId: string): Promise<UrlLease> {
    let entry = this.urls.get(assetId);
    if (!entry) {
      const asset = await this.database.audioAssets.get(assetId);
      if (!asset) throw new Error("Audio is no longer available.");
      entry = { url: URL.createObjectURL(asset.blob), consumers: 0 };
      this.urls.set(assetId, entry);
    }
    entry.consumers += 1;
    let released = false;
    return {
      url: entry.url,
      release: () => {
        if (released) return;
        released = true;
        const current = this.urls.get(assetId);
        if (!current) return;
        current.consumers -= 1;
        if (current.consumers <= 0) {
          URL.revokeObjectURL(current.url);
          this.urls.delete(assetId);
        }
      }
    };
  }
}

export class ReferenceAudioService {
  private readonly assets: AssetService;

  constructor(private readonly database: ShadowingDatabase = db) {
    this.assets = new AssetService(database);
  }

  async attach(sentenceId: string, file: File): Promise<ReferenceAudio> {
    const sentence = await this.database.sentences.get(sentenceId);
    if (!sentence) throw new Error("Sentence not found.");
    const asset = await this.assets.createAsset("reference", file, file.name);
    const reference: ReferenceAudio = {
      id: newId(),
      sentenceId,
      audioAssetId: asset.id,
      sourceType: "uploaded-audio",
      originalStartSeconds: sentence.startSeconds,
      originalEndSeconds: sentence.endSeconds,
      createdAt: now()
    };
    await this.database.transaction(
      "rw",
      this.database.sentences,
      this.database.audioAssets,
      this.database.referenceAudio,
      async () => {
        const previous = await this.database.referenceAudio.where("sentenceId").equals(sentenceId).first();
        if (previous) {
          await this.database.referenceAudio.delete(previous.id);
          await this.database.audioAssets.delete(previous.audioAssetId);
        }
        await this.database.audioAssets.add(asset);
        await this.database.referenceAudio.add(reference);
        await this.database.sentences.update(sentenceId, {
          referenceAudioId: reference.id,
          updatedAt: now()
        });
      }
    );
    return reference;
  }

  async remove(sentenceId: string) {
    await this.database.transaction(
      "rw",
      this.database.sentences,
      this.database.audioAssets,
      this.database.referenceAudio,
      async () => {
        const reference = await this.database.referenceAudio.where("sentenceId").equals(sentenceId).first();
        if (!reference) return;
        await this.database.referenceAudio.delete(reference.id);
        await this.database.audioAssets.delete(reference.audioAssetId);
        await this.database.sentences.update(sentenceId, {
          referenceAudioId: undefined,
          updatedAt: now()
        });
      }
    );
  }
}

export interface SaveAttemptInput {
  sentenceId: string;
  blob: Blob;
  durationMs: number;
  notes?: string;
}

export class AttemptService {
  private readonly assets: AssetService;

  constructor(private readonly database: ShadowingDatabase = db) {
    this.assets = new AssetService(database);
  }

  async save(input: SaveAttemptInput): Promise<PronunciationAttempt> {
    if (!(await this.database.sentences.get(input.sentenceId))) throw new Error("Sentence not found.");
    const asset = await this.assets.createAsset("attempt", input.blob, undefined, input.durationMs);
    const attempt: PronunciationAttempt = {
      id: newId(),
      sentenceId: input.sentenceId,
      audioAssetId: asset.id,
      durationMs: input.durationMs,
      notes: cleanOptional(input.notes),
      createdAt: now()
    };
    await this.database.transaction(
      "rw",
      this.database.audioAssets,
      this.database.attempts,
      this.database.sentences,
      this.database.sources,
      async () => {
        await this.database.audioAssets.add(asset);
        await this.database.attempts.add(attempt);
        const sentence = await this.database.sentences.get(input.sentenceId);
        if (sentence) {
          await this.database.sentences.update(sentence.id, { updatedAt: now() });
          await this.database.sources.update(sentence.sourceId, { updatedAt: now() });
        }
      }
    );
    return attempt;
  }

  async remove(attemptId: string) {
    await this.database.transaction(
      "rw",
      this.database.audioAssets,
      this.database.attempts,
      this.database.derivedAnalyses,
      async () => {
        const attempt = await this.database.attempts.get(attemptId);
        if (!attempt) return;
        await this.database.derivedAnalyses.where("attemptId").equals(attemptId).delete();
        await this.database.attempts.delete(attemptId);
        await this.database.audioAssets.delete(attempt.audioAssetId);
      }
    );
  }
}

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
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    this.stream = await streamPromise;
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

function playUntilEnded(audio: HTMLAudioElement) {
  return new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("Audio playback failed."));
    audio.currentTime = 0;
    audio.play().catch(reject);
  });
}

export class PlaybackCoordinator {
  private cancelled = false;

  cancel(...players: HTMLAudioElement[]) {
    this.cancelled = true;
    players.forEach((player) => {
      player.pause();
      player.currentTime = 0;
    });
  }

  async alternate(reference: HTMLAudioElement, learner: HTMLAudioElement) {
    this.cancelled = false;
    await playUntilEnded(reference);
    if (!this.cancelled) await playUntilEnded(learner);
  }
}

type ImportMode = "merge" | "replace";

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
        version: EXPORT_VERSION,
        exportedAt: now(),
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
        this.database.derivedAnalyses
      ],
      async () => {
        if (mode === "replace") {
          await Promise.all([
            this.database.sources.clear(),
            this.database.sentences.clear(),
            this.database.audioAssets.clear(),
            this.database.referenceAudio.clear(),
            this.database.attempts.clear(),
            this.database.derivedAnalyses.clear()
          ]);
        } else {
          const sourceIds = new Set(await this.database.sources.toCollection().primaryKeys());
          const sentenceIds = new Set(await this.database.sentences.toCollection().primaryKeys());
          const collision = data.sources.some(({ id }) => sourceIds.has(id)) ||
            data.sentences.some(({ id }) => sentenceIds.has(id));
          if (collision) throw new Error("Import contains IDs already in this library. Use Replace instead.");
        }
        await this.database.sources.bulkAdd(data.sources);
        await this.database.sentences.bulkAdd(data.sentences);
      }
    );
  }

  async storageSummary() {
    const [sources, sentences, referenceClips, attempts, assets] = await Promise.all([
      this.database.sources.count(),
      this.database.sentences.count(),
      this.database.referenceAudio.count(),
      this.database.attempts.count(),
      this.database.audioAssets.toArray()
    ]);
    return {
      sources,
      sentences,
      referenceClips,
      attempts,
      mediaBytes: assets.reduce((total, asset) => total + asset.byteLength, 0)
    };
  }
}

export function validateMetadataExport(value: unknown): MetadataExport {
  if (!value || typeof value !== "object") throw new Error("Backup must be a JSON object.");
  const data = value as Partial<MetadataExport>;
  if (
    data.manifest?.format !== EXPORT_FORMAT ||
    data.manifest.version !== EXPORT_VERSION ||
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
  return error instanceof Dexie.QuotaExceededError ||
    (error instanceof DOMException && error.name === "QuotaExceededError");
}
