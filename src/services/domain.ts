import type {
  MinedSentence,
  PracticeChunk,
  PracticeEvent,
  PronunciationAttempt,
  ReferenceAudio,
  Source,
  SourceType,
  SubtitleCue,
  SubtitleTrack,
  TimingGuide,
  TranscriptStatus,
  ManualRating,
  PracticeMode
} from "../types";
import { db, type ShadowingDatabase } from "../db/schema";
import { AssetService } from "./assets";
import { cleanOptional, newId, nowIso, validateTimestamps } from "./shared";
import { detectSubtitleFormat, parseSrt, parseWebVtt, type ParsedCue } from "./subtitles";
import { extractYouTubeId, youtubeWatchUrl } from "./youtube";
import { seedMoraUnits } from "../analysis/japanese";

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

export class SentenceService {
  constructor(private readonly database: ShadowingDatabase = db) {}

  async createSource(input: CreateSourceInput): Promise<Source> {
    const title = input.title.trim();
    if (!title) throw new Error("Source title is required.");
    const timestamp = nowIso();
    const youtubeId = input.url ? extractYouTubeId(input.url) : undefined;
    const source: Source = {
      id: newId(),
      type: youtubeId ? "youtube" : input.type,
      title,
      url: cleanOptional(input.url) ?? (youtubeId ? youtubeWatchUrl(youtubeId) : undefined),
      externalId: youtubeId,
      channelOrCreator: cleanOptional(input.channelOrCreator),
      notes: cleanOptional(input.notes),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.database.sources.add(source);
    return source;
  }

  async updateSourceTimestamps(sourceId: string) {
    await this.database.sources.update(sourceId, { updatedAt: nowIso() });
  }

  async createSentence(input: CreateSentenceInput): Promise<MinedSentence> {
    const japanese = input.japanese.trim();
    if (!japanese) throw new Error("Japanese text is required.");
    validateTimestamps(input.startSeconds, input.endSeconds);
    if (!(await this.database.sources.get(input.sourceId))) {
      throw new Error("The selected source does not exist.");
    }
    const timestamp = nowIso();
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

  async updateSentence(
    sentenceId: string,
    patch: Partial<Pick<MinedSentence, "japanese" | "reading" | "english" | "startSeconds" | "endSeconds" | "tags" | "notes" | "transcriptStatus">>
  ) {
    validateTimestamps(patch.startSeconds, patch.endSeconds);
    await this.database.sentences.update(sentenceId, { ...patch, updatedAt: nowIso() });
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
      createdAt: nowIso()
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
          updatedAt: nowIso()
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
          updatedAt: nowIso()
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
      createdAt: nowIso()
    };
    await this.database.transaction(
      "rw",
      this.database.audioAssets,
      this.database.attempts,
      this.database.sentences,
      this.database.sources,
      this.database.practiceEvents,
      async () => {
        await this.database.audioAssets.add(asset);
        await this.database.attempts.add(attempt);
        await this.database.practiceEvents.add({
          id: newId(),
          sentenceId: input.sentenceId,
          attemptId: attempt.id,
          mode: "compare",
          startedAt: attempt.createdAt,
          completedAt: attempt.createdAt,
          durationMs: attempt.durationMs
        });
        const sentence = await this.database.sentences.get(input.sentenceId);
        if (sentence) {
          await this.database.sentences.update(sentence.id, { updatedAt: nowIso() });
          await this.database.sources.update(sentence.sourceId, { updatedAt: nowIso() });
        }
      }
    );
    return attempt;
  }

  async updateEvaluation(
    attemptId: string,
    patch: { manualRating?: ManualRating; focusTags?: string[]; isFavorite?: boolean; notes?: string }
  ) {
    await this.database.attempts.update(attemptId, patch);
  }

  async remove(attemptId: string) {
    await this.database.transaction(
      "rw",
      this.database.audioAssets,
      this.database.attempts,
      this.database.derivedAnalyses,
      this.database.practiceEvents,
      async () => {
        const attempt = await this.database.attempts.get(attemptId);
        if (!attempt) return;
        await this.database.derivedAnalyses.where("subjectId").equals(attemptId).delete();
        await this.database.derivedAnalyses.where("attemptId").equals(attemptId).delete();
        await this.database.practiceEvents.where("attemptId").equals(attemptId).delete();
        await this.database.attempts.delete(attemptId);
        await this.database.audioAssets.delete(attempt.audioAssetId);
      }
    );
  }
}

export class SubtitleService {
  constructor(private readonly database: ShadowingDatabase = db) {}

  async importFile(sourceId: string, file: File): Promise<{ track: SubtitleTrack; cues: SubtitleCue[] }> {
    if (!(await this.database.sources.get(sourceId))) throw new Error("Source not found.");
    const content = await file.text();
    const format = detectSubtitleFormat(file.name, content);
    const parsed = format === "webvtt" ? parseWebVtt(content) : parseSrt(content);
    if (parsed.length === 0) throw new Error("No subtitle cues were found.");
    const track: SubtitleTrack = {
      id: newId(),
      sourceId,
      label: file.name,
      format,
      transcriptStatus: "machine-generated",
      createdAt: nowIso()
    };
    const cues = parsed.map((cue, order) => this.toCue(track.id, sourceId, cue, order));
    await this.database.transaction(
      "rw",
      this.database.subtitleTracks,
      this.database.subtitleCues,
      async () => {
        const existing = await this.database.subtitleTracks.where("sourceId").equals(sourceId).toArray();
        for (const old of existing) {
          await this.database.subtitleCues.where("trackId").equals(old.id).delete();
          await this.database.subtitleTracks.delete(old.id);
        }
        await this.database.subtitleTracks.add(track);
        await this.database.subtitleCues.bulkAdd(cues);
      }
    );
    return { track, cues };
  }

  private toCue(trackId: string, sourceId: string, cue: ParsedCue, order: number): SubtitleCue {
    return {
      id: newId(),
      trackId,
      sourceId,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
      order
    };
  }
}

export class TimingGuideService {
  constructor(private readonly database: ShadowingDatabase = db) {}

  async ensureForSentence(sentence: MinedSentence, durationSeconds: number): Promise<TimingGuide> {
    const existing = await this.database.timingGuides.where("sentenceId").equals(sentence.id).first();
    if (existing) return existing;
    const text = sentence.reading || sentence.japanese;
    const guide: TimingGuide = {
      id: newId(),
      sentenceId: sentence.id,
      readingSnapshot: sentence.reading,
      textSnapshot: text,
      morae: seedMoraUnits(text, durationSeconds),
      origin: "heuristic",
      confidence: sentence.reading ? "medium" : "low",
      revision: 1,
      updatedAt: nowIso()
    };
    await this.database.timingGuides.add(guide);
    return guide;
  }

  async save(guide: TimingGuide) {
    await this.database.timingGuides.put({
      ...guide,
      origin: "manual",
      confidence: "high",
      revision: guide.revision + 1,
      updatedAt: nowIso()
    });
  }
}

export class PracticeService {
  constructor(private readonly database: ShadowingDatabase = db) {}

  async saveChunks(sentenceId: string, chunks: Array<Omit<PracticeChunk, "id" | "sentenceId">>) {
    await this.database.transaction("rw", this.database.practiceChunks, async () => {
      await this.database.practiceChunks.where("sentenceId").equals(sentenceId).delete();
      await this.database.practiceChunks.bulkAdd(
        chunks.map((chunk, order) => ({
          id: newId(),
          sentenceId,
          order,
          text: chunk.text,
          translation: chunk.translation,
          startSeconds: chunk.startSeconds,
          endSeconds: chunk.endSeconds,
          notes: chunk.notes
        }))
      );
    });
  }

  async logEvent(input: {
    sentenceId: string;
    mode: PracticeMode;
    attemptId?: string;
    chunkId?: string;
    rating?: ManualRating;
    focusTags?: string[];
    durationMs?: number;
  }) {
    const event: PracticeEvent = {
      id: newId(),
      sentenceId: input.sentenceId,
      mode: input.mode,
      attemptId: input.attemptId,
      chunkId: input.chunkId,
      rating: input.rating,
      focusTags: input.focusTags,
      startedAt: nowIso(),
      completedAt: nowIso(),
      durationMs: input.durationMs
    };
    await this.database.practiceEvents.add(event);
    return event;
  }
}
