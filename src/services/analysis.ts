import type {
  AlignmentMode,
  AlignmentPayload,
  DerivedAnalysis,
  PitchAnalysisPayload
} from "../types";
import { db, type ShadowingDatabase } from "../db/schema";
import { decodeAudioBuffer } from "./media";
import { canonicalizeAudioBuffer, crossCorrelateOffset, detectOnsetSeconds, computePeaks } from "../analysis/audio";
import { extractPitch } from "../analysis/pitch";
import { newId, nowIso } from "./shared";

export class AnalysisService {
  constructor(private readonly database: ShadowingDatabase = db) {}

  async analyzeAssetPitch(assetId: string): Promise<PitchAnalysisPayload> {
    const cached = await this.database.derivedAnalyses
      .where("[subjectType+subjectId+kind]")
      .equals(["asset", assetId, "pitch"])
      .first();
    if (cached) return cached.payload as PitchAnalysisPayload;

    const asset = await this.database.audioAssets.get(assetId);
    if (!asset) throw new Error("Audio asset not found.");
    const buffer = await decodeAudioBuffer(asset.blob);
    const canonical = canonicalizeAudioBuffer(buffer);
    const payload = extractPitch(canonical);
    const record: DerivedAnalysis = {
      id: newId(),
      subjectType: "asset",
      subjectId: assetId,
      kind: "pitch",
      algorithm: "yin",
      algorithmVersion: "1",
      inputAssetIds: [assetId],
      payload,
      createdAt: nowIso()
    };
    await this.database.derivedAnalyses.put(record);
    return payload;
  }

  async analyzeAlignment(
    referenceAssetId: string,
    learnerAssetId: string,
    mode: AlignmentMode
  ): Promise<AlignmentPayload & { referencePeaks: ReturnType<typeof computePeaks>; learnerPeaks: ReturnType<typeof computePeaks> }> {
    const referenceAsset = await this.database.audioAssets.get(referenceAssetId);
    const learnerAsset = await this.database.audioAssets.get(learnerAssetId);
    if (!referenceAsset || !learnerAsset) throw new Error("Comparison audio is missing.");
    const [referenceBuffer, learnerBuffer] = await Promise.all([
      decodeAudioBuffer(referenceAsset.blob),
      decodeAudioBuffer(learnerAsset.blob)
    ]);
    const reference = canonicalizeAudioBuffer(referenceBuffer);
    const learner = canonicalizeAudioBuffer(learnerBuffer);
    const referenceOnset = detectOnsetSeconds(reference.samples, reference.sampleRate);
    const learnerOnset = detectOnsetSeconds(learner.samples, learner.sampleRate);
    let offsetSeconds = 0;
    let confidence: AlignmentPayload["confidence"] = "medium";
    if (mode === "onset-aligned") {
      offsetSeconds = referenceOnset - learnerOnset;
      confidence = "medium";
    } else if (mode === "time-normalized") {
      offsetSeconds = 0;
      confidence = "low";
    } else {
      const sampleOffset = crossCorrelateOffset(reference.samples, learner.samples);
      offsetSeconds = sampleOffset / reference.sampleRate;
      confidence = "medium";
    }
    const payload: AlignmentPayload = {
      mode,
      offsetSeconds,
      durationRatio:
        reference.durationSeconds > 0 ? learner.durationSeconds / reference.durationSeconds : 1,
      confidence
    };
    const comparisonId = `${referenceAssetId}:${learnerAssetId}:${mode}`;
    await this.database.derivedAnalyses.put({
      id: newId(),
      subjectType: "comparison",
      subjectId: comparisonId,
      kind: "alignment",
      algorithm: "envelope-xcorr",
      algorithmVersion: "1",
      inputAssetIds: [referenceAssetId, learnerAssetId],
      payload,
      createdAt: nowIso()
    });
    return {
      ...payload,
      referencePeaks: computePeaks(reference.samples),
      learnerPeaks: computePeaks(learner.samples)
    };
  }
}
