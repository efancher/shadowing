import { useEffect, useMemo, useState } from "react";
import type { AlignmentMode, PitchAnalysisPayload, TimingObservation } from "../types";
import { AnalysisService } from "../services";
import { buildTimingObservations, confidenceFromSignal } from "../analysis/japanese";
import { useAssetUrl } from "../hooks/useAssetUrl";

const analysisService = new AnalysisService();

function PeakWaveform({
  peaks,
  label
}: {
  peaks: Array<{ min: number; max: number }>;
  label: string;
}) {
  const points = useMemo(() => {
    if (peaks.length === 0) return "";
    const width = 600;
    const height = 80;
    const mid = height / 2;
    return peaks
      .map((peak, index) => {
        const x = (index / Math.max(1, peaks.length - 1)) * width;
        const yMax = mid - peak.max * mid;
        return `${x},${yMax}`;
      })
      .join(" ");
  }, [peaks]);

  return (
    <div className="peak-waveform">
      <span className="player-label">{label}</span>
      <svg viewBox="0 0 600 80" role="img" aria-label={`${label} waveform`}>
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
      </svg>
    </div>
  );
}

function PitchCanvas({
  pitch,
  label,
  mode
}: {
  pitch?: PitchAnalysisPayload;
  label: string;
  mode: "hz" | "semitones";
}) {
  const path = useMemo(() => {
    if (!pitch || pitch.frames.length === 0) return "";
    const width = 600;
    const height = 120;
    const values = pitch.frames
      .map((frame) => (mode === "hz" ? frame.hz : frame.relativeSemitones))
      .filter((value): value is number => value !== null);
    if (values.length === 0) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.001, max - min);
    return pitch.frames
      .map((frame, index) => {
        const value = mode === "hz" ? frame.hz : frame.relativeSemitones;
        if (value === null || !frame.voiced) return null;
        const x = (index / Math.max(1, pitch.frames.length - 1)) * width;
        const y = height - ((value - min) / span) * (height - 12) - 6;
        return `${x},${y}`;
      })
      .filter(Boolean)
      .join(" ");
  }, [pitch, mode]);

  return (
    <div className="pitch-plot">
      <span className="player-label">{label}</span>
      <svg viewBox="0 0 600 120" role="img" aria-label={`${label} pitch contour`}>
        <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={label.includes("Learner") ? "6 4" : undefined} points={path} />
      </svg>
    </div>
  );
}

export function AnalysisPanel({
  referenceAssetId,
  learnerAssetId,
  hasReading,
  durationHintSeconds
}: {
  referenceAssetId?: string;
  learnerAssetId?: string;
  hasReading: boolean;
  durationHintSeconds: number;
}) {
  const [mode, setMode] = useState<AlignmentMode>("original");
  const [pitchMode, setPitchMode] = useState<"hz" | "semitones">("semitones");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [referencePitch, setReferencePitch] = useState<PitchAnalysisPayload>();
  const [learnerPitch, setLearnerPitch] = useState<PitchAnalysisPayload>();
  const [peaks, setPeaks] = useState<{
    referencePeaks: Array<{ min: number; max: number }>;
    learnerPeaks: Array<{ min: number; max: number }>;
    offsetSeconds: number;
    durationRatio: number;
    confidence: TimingObservation["confidence"];
  }>();
  const referenceUrl = useAssetUrl(referenceAssetId);
  const learnerUrl = useAssetUrl(learnerAssetId);

  useEffect(() => {
    if (!referenceAssetId || !learnerAssetId) return;
    let active = true;
    setBusy(true);
    setError(undefined);
    Promise.all([
      analysisService.analyzeAssetPitch(referenceAssetId),
      analysisService.analyzeAssetPitch(learnerAssetId),
      analysisService.analyzeAlignment(referenceAssetId, learnerAssetId, mode)
    ])
      .then(([refPitch, learnPitch, alignment]) => {
        if (!active) return;
        setReferencePitch(refPitch);
        setLearnerPitch(learnPitch);
        setPeaks({
          referencePeaks: alignment.referencePeaks,
          learnerPeaks: alignment.learnerPeaks,
          offsetSeconds: alignment.offsetSeconds,
          durationRatio: alignment.durationRatio,
          confidence: alignment.confidence
        });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Analysis failed.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [referenceAssetId, learnerAssetId, mode]);

  if (!referenceAssetId || !learnerAssetId) {
    return <p className="muted">Add a local reference clip and save an attempt to unlock waveform and pitch comparison.</p>;
  }

  const confidence = confidenceFromSignal({
    hasReading,
    voicedRatio: Math.min(referencePitch?.voicedRatio ?? 0, learnerPitch?.voicedRatio ?? 0),
    alignmentConfidence: peaks?.confidence,
    origin: "heuristic"
  });
  const observations = buildTimingObservations({
    referenceDuration: referencePitch?.durationSeconds ?? durationHintSeconds,
    learnerDuration: learnerPitch?.durationSeconds ?? durationHintSeconds,
    referencePitch,
    learnerPitch,
    confidence
  });

  return (
    <div className="analysis-panel">
      <div className="button-row">
        {(["original", "onset-aligned", "time-normalized"] as AlignmentMode[]).map((value) => (
          <button
            key={value}
            className={mode === value ? "primary compact" : "secondary compact"}
            type="button"
            onClick={() => setMode(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="muted">
        {mode === "time-normalized"
          ? "Time-normalized view compares contour shape. It does not mean your timing was correct."
          : mode === "onset-aligned"
            ? "Onset-aligned view lines up detected speech starts."
            : "Original timing preserves real speed and pause differences."}
      </p>
      {busy && <p className="muted">Analyzing locally…</p>}
      {error && <p className="notice error">{error}</p>}
      {peaks && (
        <>
          <PeakWaveform peaks={peaks.referencePeaks} label="Reference waveform" />
          <PeakWaveform peaks={peaks.learnerPeaks} label="Learner waveform" />
          <p className="muted">
            Offset {peaks.offsetSeconds.toFixed(2)}s · duration ratio {peaks.durationRatio.toFixed(2)} · confidence{" "}
            {peaks.confidence}
          </p>
        </>
      )}
      <div className="button-row">
        <button className={pitchMode === "semitones" ? "primary compact" : "secondary compact"} type="button" onClick={() => setPitchMode("semitones")}>
          Speaker-normalized
        </button>
        <button className={pitchMode === "hz" ? "primary compact" : "secondary compact"} type="button" onClick={() => setPitchMode("hz")}>
          Hertz
        </button>
      </div>
      <PitchCanvas pitch={referencePitch} label="Reference pitch" mode={pitchMode} />
      <PitchCanvas pitch={learnerPitch} label="Learner pitch" mode={pitchMode} />
      <div className="observation-list">
        {observations.map((item) => (
          <article className="notice" key={item.id}>
            <strong>{item.confidence} confidence:</strong> {item.message}
            {item.detail && <p className="muted">{item.detail}</p>}
          </article>
        ))}
      </div>
      {(referenceUrl.error || learnerUrl.error) && (
        <p className="notice error">{referenceUrl.error || learnerUrl.error}</p>
      )}
    </div>
  );
}
