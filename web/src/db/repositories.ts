import Dexie from "dexie";
import type {
  AudioAsset,
  MinedSentence,
  ReferenceAudio,
  Source
} from "../types";
import { db, type ShadowingDatabase } from "./schema";

export class SourceRepository {
  constructor(private readonly database: ShadowingDatabase = db) {}

  list() {
    return this.database.sources.orderBy("updatedAt").reverse().toArray();
  }

  get(id: string) {
    return this.database.sources.get(id);
  }

  put(source: Source) {
    return this.database.sources.put(source);
  }
}

export class SentenceRepository {
  constructor(private readonly database: ShadowingDatabase = db) {}

  listForSource(sourceId: string) {
    return this.database.sentences.where("sourceId").equals(sourceId).reverse().sortBy("updatedAt");
  }

  get(id: string) {
    return this.database.sentences.get(id);
  }

  put(sentence: MinedSentence) {
    return this.database.sentences.put(sentence);
  }
}

export class AssetRepository {
  constructor(private readonly database: ShadowingDatabase = db) {}

  get(id: string) {
    return this.database.audioAssets.get(id);
  }

  put(asset: AudioAsset) {
    return this.database.audioAssets.put(asset);
  }
}

export class ReferenceAudioRepository {
  constructor(private readonly database: ShadowingDatabase = db) {}

  getForSentence(sentenceId: string) {
    return this.database.referenceAudio.where("sentenceId").equals(sentenceId).first();
  }

  put(reference: ReferenceAudio) {
    return this.database.referenceAudio.put(reference);
  }
}

export class AttemptRepository {
  constructor(private readonly database: ShadowingDatabase = db) {}

  listForSentence(sentenceId: string) {
    return this.database.attempts
      .where("[sentenceId+createdAt]")
      .between([sentenceId, Dexie.minKey], [sentenceId, Dexie.maxKey])
      .reverse()
      .toArray();
  }

  get(id: string) {
    return this.database.attempts.get(id);
  }
}
