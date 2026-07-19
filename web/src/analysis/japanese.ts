import type { ConfidenceLevel, MoraUnit, TimingObservation } from "../types";
import type { PitchAnalysisPayload } from "../types";

const SMALL_KANA = new Set(["ゃ", "ゅ", "ょ", "ャ", "ュ", "ョ", "ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ァ", "ィ", "ゥ", "ェ", "ォ"]);

export function parseMoraLabels(readingOrText: string): string[] {
  const cleaned = readingOrText.replace(/\s+/g, "").replace(/[。．！？!?,、]/g, "");
  const labels: string[] = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i] ?? "";
    const next = cleaned[i + 1] ?? "";
    if (SMALL_KANA.has(next)) {
      labels.push(char + next);
      i += 1;
      continue;
    }
    labels.push(char);
  }
  return labels.filter(Boolean);
}

export function seedMoraUnits(text: string, durationSeconds: number): MoraUnit[] {
  const labels = parseMoraLabels(text);
  if (labels.length === 0 || durationSeconds <= 0) return [];
  const step = durationSeconds / labels.length;
  return labels.map((label, index) => {
    let kind: MoraUnit["kind"] = "normal";
    if (label === "っ" || label === "ッ") kind = "sokuon";
    else if (label === "ん" || label === "ン") kind = "hatsuon";
    else if (/[ー]/.test(label) || /([あいうえおアイウエオ])\1/.test(label)) kind = "long-vowel";
    return {
      label,
      startSeconds: index * step,
      endSeconds: (index + 1) * step,
      kind
    };
  });
}

export function confidenceFromSignal(options: {
  hasReading: boolean;
  voicedRatio: number;
  alignmentConfidence?: ConfidenceLevel;
  origin: "heuristic" | "manual";
}): ConfidenceLevel {
  if (options.origin === "manual" && options.voicedRatio > 0.35) return "high";
  if (!options.hasReading) return "low";
  if (options.voicedRatio < 0.2) return "low";
  if (options.alignmentConfidence === "low") return "low";
  if (options.voicedRatio > 0.45) return "medium";
  return "low";
}

export function buildTimingObservations(options: {
  referenceDuration: number;
  learnerDuration: number;
  referencePitch?: PitchAnalysisPayload;
  learnerPitch?: PitchAnalysisPayload;
  morae?: MoraUnit[];
  confidence: ConfidenceLevel;
}): TimingObservation[] {
  const observations: TimingObservation[] = [];
  const ratio = options.referenceDuration > 0 ? options.learnerDuration / options.referenceDuration : 1;
  if (Math.abs(ratio - 1) > 0.12) {
    observations.push({
      id: "duration-ratio",
      kind: "duration",
      confidence: options.confidence,
      message:
        ratio > 1
          ? "Your recording is longer than the reference."
          : "Your recording is shorter than the reference.",
      detail: `Duration ratio ${ratio.toFixed(2)} (learner ÷ reference). This measures overall length, not pronunciation quality.`
    });
  } else {
    observations.push({
      id: "duration-close",
      kind: "duration",
      confidence: options.confidence === "low" ? "low" : "medium",
      message: "Overall duration is close to the reference.",
      detail: `Duration ratio ${ratio.toFixed(2)}.`
    });
  }

  const refMedian = options.referencePitch?.medianHz;
  const learnMedian = options.learnerPitch?.medianHz;
  if (refMedian && learnMedian) {
    const semitoneGap = 12 * Math.log2(learnMedian / refMedian);
    observations.push({
      id: "pitch-register",
      kind: "pitch",
      confidence: options.confidence,
      message:
        Math.abs(semitoneGap) < 2
          ? "Median pitch register is similar after accounting for speaker differences."
          : "Median absolute pitch differs, which is expected across speakers. Prefer the normalized contour view.",
      detail: `Reference median ${refMedian.toFixed(0)} Hz, learner median ${learnMedian.toFixed(0)} Hz (${semitoneGap.toFixed(1)} semitones).`
    });
  }

  const sokuon = options.morae?.find((mora) => mora.kind === "sokuon");
  if (sokuon) {
    observations.push({
      id: "sokuon-hint",
      kind: "sokuon",
      confidence: options.confidence === "high" ? "medium" : "low",
      message: "Possible consonant closure region marked for っ. Compare hold duration by ear and waveform energy.",
      detail: `${sokuon.startSeconds.toFixed(2)}s–${sokuon.endSeconds.toFixed(2)}s`
    });
  }

  const longVowel = options.morae?.find((mora) => mora.kind === "long-vowel");
  if (longVowel) {
    observations.push({
      id: "long-vowel-hint",
      kind: "long-vowel",
      confidence: options.confidence === "high" ? "medium" : "low",
      message: "Likely long-vowel region. Check whether your vowel duration is shorter or longer than the reference.",
      detail: `${longVowel.label} @ ${longVowel.startSeconds.toFixed(2)}s`
    });
  }

  if (options.confidence === "low") {
    observations.push({
      id: "low-confidence",
      kind: "meta",
      confidence: "low",
      message: "Automatic observations have low confidence. Use them as listening prompts, not corrections.",
      detail: "Improve confidence by adding a reading, manually editing mora markers, and recording with less noise."
    });
  }

  return observations;
}
