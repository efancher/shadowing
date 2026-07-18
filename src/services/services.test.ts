import { afterEach, describe, expect, it, vi } from "vitest";
import { ShadowingDatabase } from "../db/schema";
import {
  AttemptService,
  RecordingService,
  SentenceService,
  TransferService,
  validateMetadataExport,
  validateTimestamps
} from ".";

const databases: ShadowingDatabase[] = [];

function createDatabase() {
  const database = new ShadowingDatabase(`shadowing-test-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("sentence validation and persistence", () => {
  it("rejects invalid timestamp ranges", () => {
    expect(() => validateTimestamps(-1, 2)).toThrow("negative");
    expect(() => validateTimestamps(2, 2)).toThrow("after start");
    expect(() => validateTimestamps(3, 2)).toThrow("after start");
  });

  it("creates a source and sentence with normalized fields", async () => {
    const database = createDatabase();
    const service = new SentenceService(database);
    const source = await service.createSource({
      type: "youtube",
      title: "  A useful video  ",
      url: " https://www.youtube.com/watch?v=example "
    });
    const sentence = await service.createSentence({
      sourceId: source.id,
      japanese: " 今日はどこへ行くんですか。 ",
      startSeconds: 83.42,
      endSeconds: 85.81,
      tags: [" question ", ""]
    });

    expect(source.title).toBe("A useful video");
    expect(sentence.japanese).toBe("今日はどこへ行くんですか。");
    expect(sentence.tags).toEqual(["question"]);
    expect(await database.sentences.get(sentence.id)).toEqual(sentence);
  });
});

describe("attempt ownership", () => {
  it("saves and atomically removes an attempt with its audio asset", async () => {
    const database = createDatabase();
    const sentences = new SentenceService(database);
    const attempts = new AttemptService(database);
    const source = await sentences.createSource({ type: "manual", title: "Practice set" });
    const sentence = await sentences.createSentence({ sourceId: source.id, japanese: "おはよう。" });
    const attempt = await attempts.save({
      sentenceId: sentence.id,
      blob: new Blob(["audio"], { type: "audio/mp4" }),
      durationMs: 1_200,
      notes: "First try"
    });

    expect(await database.audioAssets.get(attempt.audioAssetId)).toBeDefined();
    await attempts.remove(attempt.id);
    expect(await database.attempts.get(attempt.id)).toBeUndefined();
    expect(await database.audioAssets.get(attempt.audioAssetId)).toBeUndefined();
  });
});

describe("metadata transfer", () => {
  it("round-trips source and sentence metadata into an empty database", async () => {
    const sourceDatabase = createDatabase();
    const targetDatabase = createDatabase();
    const sentenceService = new SentenceService(sourceDatabase);
    const source = await sentenceService.createSource({ type: "podcast", title: "Episode 1" });
    await sentenceService.createSentence({
      sourceId: source.id,
      japanese: "そうなんですね。",
      transcriptStatus: "verified"
    });

    const exported = await new TransferService(sourceDatabase).exportMetadata();
    expect(exported.manifest.mediaIncluded).toBe(false);
    await new TransferService(targetDatabase).importMetadata(exported, "merge");

    expect(await targetDatabase.sources.count()).toBe(1);
    expect(await targetDatabase.sentences.count()).toBe(1);
  });

  it("rejects dangling sentence references and merge collisions", async () => {
    const database = createDatabase();
    const service = new SentenceService(database);
    const source = await service.createSource({ type: "manual", title: "Set" });
    await service.createSentence({ sourceId: source.id, japanese: "はい。" });
    const exported = await new TransferService(database).exportMetadata();

    expect(() =>
      validateMetadataExport({
        ...exported,
        sentences: [{ ...exported.sentences[0], sourceId: "missing" }]
      })
    ).toThrow("missing source");
    await expect(new TransferService(database).importMetadata(exported, "merge")).rejects.toThrow(
      "already in this library"
    );
  });
});

describe("recording compatibility", () => {
  it("selects the first supported recording MIME type", () => {
    class FakeMediaRecorder {
      static isTypeSupported(type: string) {
        return type === "audio/webm;codecs=opus";
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    expect(RecordingService.supportedMimeType()).toBe("audio/webm;codecs=opus");
  });
});
