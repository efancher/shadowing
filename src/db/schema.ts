import Dexie, { type EntityTable } from "dexie";
import type {
  AppSetting,
  AudioAsset,
  DerivedAnalysis,
  MinedSentence,
  PracticeChunk,
  PracticeEvent,
  PronunciationAttempt,
  ReferenceAudio,
  Source,
  SourceMedia,
  SubtitleCue,
  SubtitleTrack,
  TimingGuide
} from "../types";

export class ShadowingDatabase extends Dexie {
  sources!: EntityTable<Source, "id">;
  sentences!: EntityTable<MinedSentence, "id">;
  audioAssets!: EntityTable<AudioAsset, "id">;
  referenceAudio!: EntityTable<ReferenceAudio, "id">;
  attempts!: EntityTable<PronunciationAttempt, "id">;
  derivedAnalyses!: EntityTable<DerivedAnalysis, "id">;
  sourceMedia!: EntityTable<SourceMedia, "id">;
  subtitleTracks!: EntityTable<SubtitleTrack, "id">;
  subtitleCues!: EntityTable<SubtitleCue, "id">;
  timingGuides!: EntityTable<TimingGuide, "id">;
  practiceChunks!: EntityTable<PracticeChunk, "id">;
  practiceEvents!: EntityTable<PracticeEvent, "id">;
  settings!: EntityTable<AppSetting, "key">;

  constructor(name = "shadowing") {
    super(name);

    this.version(1).stores({
      sources: "id, type, title, updatedAt",
      sentences: "id, sourceId, updatedAt, [sourceId+updatedAt], *tags",
      audioAssets: "id, kind, createdAt",
      referenceAudio: "id, &sentenceId, &audioAssetId",
      attempts: "id, sentenceId, &audioAssetId, createdAt, [sentenceId+createdAt]",
      derivedAnalyses: "id, attemptId, kind, [algorithm+algorithmVersion]"
    });

    this.version(2)
      .stores({
        sources: "id, type, title, updatedAt, externalId",
        sentences: "id, sourceId, updatedAt, [sourceId+updatedAt], *tags, transcriptStatus",
        audioAssets: "id, kind, createdAt",
        referenceAudio: "id, &sentenceId, &audioAssetId",
        attempts: "id, sentenceId, &audioAssetId, createdAt, [sentenceId+createdAt], isFavorite",
        derivedAnalyses:
          "id, attemptId, subjectType, subjectId, kind, [subjectType+subjectId+kind], [algorithm+algorithmVersion]",
        sourceMedia: "id, sourceId, createdAt",
        subtitleTracks: "id, sourceId, createdAt",
        subtitleCues: "id, trackId, sourceId, [trackId+startMs], [sourceId+startMs]",
        timingGuides: "id, &sentenceId, updatedAt",
        practiceChunks: "id, sentenceId, [sentenceId+order]",
        practiceEvents: "id, sentenceId, attemptId, startedAt, [sentenceId+startedAt]",
        settings: "key, updatedAt"
      })
      .upgrade(async (transaction) => {
        const analyses = transaction.table("derivedAnalyses");
        await analyses.toCollection().modify((record: DerivedAnalysis) => {
          if (!record.subjectType || !record.subjectId) {
            record.subjectType = "comparison";
            record.subjectId = record.attemptId ?? record.id;
          }
        });
      });
  }
}

export const db = new ShadowingDatabase();
