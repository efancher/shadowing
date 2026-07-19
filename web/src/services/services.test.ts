import { afterEach, describe, expect, it, vi } from "vitest";
import { ShadowingDatabase } from "../db/schema";
import { parseMoraLabels, seedMoraUnits, confidenceFromSignal } from "../analysis/japanese";
import { canonicalizeAudioBuffer, detectOnsetSeconds } from "../analysis/audio";
import {
  AttemptService,
  RecordingService,
  SentenceService,
  TransferService,
  parseSrt,
  parseWebVtt,
  extractYouTubeId,
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
      url: " https://www.youtube.com/watch?v=dQw4w9WgXcQ "
    });
    const sentence = await service.createSentence({
      sourceId: source.id,
      japanese: " 今日はどこへ行くんですか。 ",
      startSeconds: 83.42,
      endSeconds: 85.81,
      tags: [" question ", ""]
    });

    expect(source.title).toBe("A useful video");
    expect(source.externalId).toBe("dQw4w9WgXcQ");
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

describe("subtitles and youtube helpers", () => {
  it("parses webvtt and srt cues", () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:02.500
こんにちは

2
00:00:02.500 --> 00:00:04.000
世界`;
    const srt = `1
00:00:01,000 --> 00:00:02,500
こんにちは

2
00:00:02,500 --> 00:00:04,000
世界`;
    expect(parseWebVtt(vtt)).toHaveLength(2);
    expect(parseSrt(srt)[0]?.text).toBe("こんにちは");
  });

  it("extracts youtube ids from common url forms", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
});

describe("japanese timing helpers", () => {
  it("parses mora labels including small kana and seeds units", () => {
    expect(parseMoraLabels("きょう")).toEqual(["きょ", "う"]);
    expect(parseMoraLabels("がっこう")).toEqual(["が", "っ", "こ", "う"]);
    const units = seedMoraUnits("しんぶん", 2);
    expect(units).toHaveLength(4);
    expect(units[0]?.startSeconds).toBeCloseTo(0);
    expect(units.at(-1)?.endSeconds).toBeCloseTo(2);
  });

  it("keeps low confidence when reading is missing", () => {
    expect(
      confidenceFromSignal({
        hasReading: false,
        voicedRatio: 0.8,
        origin: "heuristic"
      })
    ).toBe("low");
  });
});

describe("audio analysis helpers", () => {
  it("detects onset after leading silence", () => {
    const samples = new Float32Array(2048);
    for (let i = 1024; i < samples.length; i += 1) samples[i] = 0.4;
    const buffer = {
      length: samples.length,
      numberOfChannels: 1,
      sampleRate: 16_000,
      getChannelData: () => samples
    } as unknown as AudioBuffer;
    const canonical = canonicalizeAudioBuffer(buffer, 16_000);
    expect(detectOnsetSeconds(canonical.samples, canonical.sampleRate)).toBeGreaterThan(0.01);
  });
});

describe("shadowing package import", () => {
  it("imports japanese-shadowing-package v1 into dexie stores", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const database = createDatabase();
    const transfer = new TransferService(database);
    const audio = new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4]);
    const zipped = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "japanese-shadowing-package",
          version: 1,
          createdAt: "2026-07-18T00:00:00Z",
          generator: { name: "shadowmine", version: "0.1.0" }
        })
      ),
      "source.json": strToU8(
        JSON.stringify({
          id: "source-pkg-1",
          type: "youtube",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          videoId: "dQw4w9WgXcQ",
          title: "Package Source",
          channel: "Channel"
        })
      ),
      "sentences.json": strToU8(
        JSON.stringify([
          {
            id: "sentence-001",
            japanese: "こんにちは。",
            english: "Hello.",
            startMs: 1000,
            endMs: 2000,
            tags: ["greeting"],
            transcriptStatus: "manually-corrected",
            audio: { path: "audio/sentence-001.wav", mimeType: "audio/wav", durationMs: 500 }
          }
        ])
      ),
      "audio/sentence-001.wav": audio
    });
    const summary = await transfer.inspectShadowingPackage(zipped);
    expect(summary.sentenceCount).toBe(1);
    expect(summary.hasConflict).toBe(false);
    const result = await transfer.importShadowingPackage(zipped, "merge");
    expect(result.sourceId).toBe("source-pkg-1");
    expect(await database.sentences.count()).toBe(1);
    expect(await database.referenceAudio.count()).toBe(1);
    expect(await database.audioAssets.count()).toBe(1);
  });
});
