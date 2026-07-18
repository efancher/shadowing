import Dexie, { type EntityTable } from "dexie";
import type {
  AudioAsset,
  DerivedAnalysis,
  MinedSentence,
  PronunciationAttempt,
  ReferenceAudio,
  Source
} from "../types";

export class ShadowingDatabase extends Dexie {
  sources!: EntityTable<Source, "id">;
  sentences!: EntityTable<MinedSentence, "id">;
  audioAssets!: EntityTable<AudioAsset, "id">;
  referenceAudio!: EntityTable<ReferenceAudio, "id">;
  attempts!: EntityTable<PronunciationAttempt, "id">;
  derivedAnalyses!: EntityTable<DerivedAnalysis, "id">;

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
  }
}

export const db = new ShadowingDatabase();
