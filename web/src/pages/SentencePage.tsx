import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useParams } from "react-router-dom";
import { AnalysisPanel } from "../components/AnalysisPanel";
import { EmptyState, ErrorNotice } from "../components/Layout";
import { db } from "../db/schema";
import { useAssetUrl } from "../hooks/useAssetUrl";
import {
  AttemptService,
  MAX_RECORDING_DURATION_MS,
  PLAYBACK_SPEEDS,
  PlaybackCoordinator,
  PracticeService,
  RecordingService,
  ReferenceAudioService,
  TimingGuideService,
  calibrateMicrophone
} from "../services";
import type { ManualRating, MoraUnit } from "../types";

const referenceService = new ReferenceAudioService();
const attemptService = new AttemptService();
const practiceService = new PracticeService();
const timingGuideService = new TimingGuideService();
const MIN_USEFUL_RECORDING_MS = 500;

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function AudioPlayer({
  assetId,
  label,
  playbackRate = 1
}: {
  assetId: string;
  label: string;
  playbackRate?: number;
}) {
  const { url, error } = useAssetUrl(assetId);
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = playbackRate;
  }, [playbackRate, url]);
  if (error) return <span className="notice error">{error}</span>;
  if (!url) return <span className="muted">Loading {label.toLowerCase()}…</span>;
  return <audio ref={ref} className="audio-player" controls preload="metadata" src={url} aria-label={label} />;
}

export function SentencePage() {
  const { sentenceId = "" } = useParams();
  const recordingService = useRef(new RecordingService());
  const recordingTimer = useRef<number | undefined>(undefined);
  const coordinator = useRef(new PlaybackCoordinator());
  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string>();
  const [draft, setDraft] = useState<{ blob: Blob; durationMs: number }>();
  const [draftUrl, setDraftUrl] = useState<string>();
  const [notes, setNotes] = useState("");
  const [selectedAttemptId, setSelectedAttemptId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string>();
  const [speed, setSpeed] = useState(1);
  const [hideTranscript, setHideTranscript] = useState(false);
  const [chunkDraft, setChunkDraft] = useState("");
  const [calibration, setCalibration] = useState<string[]>();
  const [morae, setMorae] = useState<MoraUnit[]>([]);

  const data = useLiveQuery(async () => {
    const sentence = await db.sentences.get(sentenceId);
    if (!sentence) return { sentence: undefined };
    const [source, reference, attempts, chunks, guide] = await Promise.all([
      db.sources.get(sentence.sourceId),
      db.referenceAudio.where("sentenceId").equals(sentenceId).first(),
      db.attempts.where("sentenceId").equals(sentenceId).toArray(),
      db.practiceChunks.where("sentenceId").equals(sentenceId).sortBy("order"),
      db.timingGuides.where("sentenceId").equals(sentenceId).first()
    ]);
    attempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { sentence, source, reference, attempts, chunks, guide };
  }, [sentenceId]);

  useEffect(() => {
    if (!draft) {
      setDraftUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(draft.blob);
    setDraftUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  useEffect(() => {
    if (!data?.sentence || !data.reference) return;
    const sentence = data.sentence;
    const duration = Math.max(1, (sentence.endSeconds ?? 2) - (sentence.startSeconds ?? 0));
    void timingGuideService.ensureForSentence(sentence, duration).then((guide) => setMorae(guide.morae));
  }, [data?.sentence, data?.reference]);

  useEffect(
    () => () => {
      if (recordingTimer.current) window.clearTimeout(recordingTimer.current);
      recordingService.current.cancel();
      coordinator.current.cancel();
    },
    []
  );

  async function finishRecording() {
    if (recordingTimer.current) window.clearTimeout(recordingTimer.current);
    try {
      const result = await recordingService.current.stop();
      setDraft(result);
    } catch (reason) {
      setRecordingError(reason instanceof Error ? reason.message : "Could not finish recording.");
    } finally {
      setRecording(false);
    }
  }

  async function startRecording() {
    setRecordingError(undefined);
    setDraft(undefined);
    try {
      await recordingService.current.start();
      setRecording(true);
      recordingTimer.current = window.setTimeout(() => void finishRecording(), MAX_RECORDING_DURATION_MS);
    } catch (reason) {
      setRecordingError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? "Microphone access was denied. Allow microphone access in Safari settings and try again."
          : reason instanceof Error
            ? reason.message
            : "Could not start recording."
      );
    }
  }

  async function saveAttempt() {
    if (!draft) return;
    setBusy(true);
    setRecordingError(undefined);
    try {
      const attempt = await attemptService.save({ sentenceId, ...draft, notes });
      setSelectedAttemptId(attempt.id);
      setDraft(undefined);
      setNotes("");
    } catch (reason) {
      setRecordingError(reason instanceof Error ? reason.message : "Could not save attempt.");
    } finally {
      setBusy(false);
    }
  }

  async function attachReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setPageError(undefined);
    try {
      await referenceService.attach(sentenceId, file);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Could not add reference audio.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function saveChunks() {
    const parts = chunkDraft
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    await practiceService.saveChunks(
      sentenceId,
      parts.map((text) => ({ text, order: 0 }))
    );
  }

  async function runCalibration() {
    setBusy(true);
    setPageError(undefined);
    try {
      const result = await calibrateMicrophone();
      setCalibration(result.guidance);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Calibration failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="page"><p className="muted">Loading sentence…</p></div>;
  if (!data.sentence || !data.source) {
    return (
      <div className="page">
        <EmptyState title="Sentence not found">It may have been removed from this device.</EmptyState>
        <Link className="text-link" to="/">Return to library</Link>
      </div>
    );
  }

  const { sentence, source, reference, attempts = [], chunks = [] } = data;
  const selectedAttempt = attempts.find(({ id }) => id === selectedAttemptId) ?? attempts[0];
  const firstAttempt = attempts[attempts.length - 1];
  const favoriteAttempt = attempts.find((attempt) => attempt.isFavorite);

  return (
    <div className="page">
      <Link className="back-link" to={`/sources/${source.id}`}>‹ {source.title}</Link>
      <section className="sentence-hero">
        <p className="eyebrow">{sentence.transcriptStatus.replace("-", " ")}</p>
        {!hideTranscript && (
          <>
            <h1 className="japanese hero-japanese" lang="ja">{sentence.japanese}</h1>
            {sentence.english && <p className="translation">{sentence.english}</p>}
          </>
        )}
        {hideTranscript && <h1>Audio-only practice</h1>}
        <div className="tag-row">
          {sentence.startSeconds !== undefined && <span className="pill">Start {sentence.startSeconds.toFixed(2)}s</span>}
          {sentence.endSeconds !== undefined && <span className="pill">End {sentence.endSeconds.toFixed(2)}s</span>}
          {sentence.tags.map((tag) => <span className="pill" key={tag}>#{tag}</span>)}
        </div>
      </section>

      <ErrorNotice message={pageError} />

      <section className="card practice-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Shadowing</p>
            <h2>Practice controls</h2>
          </div>
        </div>
        <div className="button-row">
          <button className="secondary" type="button" onClick={() => setHideTranscript((value) => !value)}>
            {hideTranscript ? "Show transcript" : "Hide transcript"}
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => void runCalibration()}>
            Calibrate mic
          </button>
          <label>
            Speed
            <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
              {PLAYBACK_SPEEDS.map((value) => (
                <option key={value} value={value}>{Math.round(value * 100)}%</option>
              ))}
            </select>
          </label>
        </div>
        {calibration && (
          <ul className="muted">
            {calibration.map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
      </section>

      <section className="card practice-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2>Reference audio</h2>
          </div>
          <span className={`status-dot ${reference ? "ready" : ""}`}>{reference ? "Ready" : "Needed"}</span>
        </div>
        {reference ? (
          <>
            <AudioPlayer assetId={reference.audioAssetId} label="Reference audio" playbackRate={speed} />
            <div className="button-row">
              <label className="secondary file-button">
                Replace clip
                <input type="file" accept="audio/*,.m4a,.aac,.mp3,.wav,.webm" onChange={attachReference} disabled={busy} />
              </label>
              <button
                className="danger-text"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this reference clip? The sentence and timestamps will remain.")) {
                    void referenceService.remove(sentenceId);
                  }
                }}
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Upload a short audio clip you lawfully possess. YouTube timestamps alone cannot be analyzed.
            </p>
            <label className="primary file-button">
              Add local reference clip
              <input type="file" accept="audio/*,.m4a,.aac,.mp3,.wav,.webm" onChange={attachReference} disabled={busy} />
            </label>
          </>
        )}
      </section>

      <section className="card practice-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2>Record mine</h2>
          </div>
          {recording && <span className="recording-badge"><i /> Recording</span>}
        </div>
        <p className="muted">Your recording stays on this device. Maximum length: 30 seconds.</p>
        <ErrorNotice message={recordingError} />
        {!hideTranscript && sentence.reading && (
          <p className="reading record-reading" lang="ja">{sentence.reading}</p>
        )}
        {recording ? (
          <button className="record-button stop" onClick={() => void finishRecording()}>
            <span aria-hidden="true">■</span> Stop recording
          </button>
        ) : (
          <button className="record-button" onClick={() => void startRecording()}>
            <span aria-hidden="true">●</span> Record
          </button>
        )}
        {draft && draftUrl && (
          <div className="draft-recording">
            <div className="draft-heading">
              <strong>New attempt</strong>
              <span>{formatDuration(draft.durationMs)}</span>
            </div>
            {draft.durationMs < MIN_USEFUL_RECORDING_MS && (
              <p className="notice warning">This recording is very short. Check that the microphone captured your voice.</p>
            )}
            <audio className="audio-player" controls src={draftUrl} aria-label="Unsaved learner recording" />
            <label>
              Notes <span className="optional">optional</span>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Focus for next time…" />
            </label>
            <div className="button-row">
              <button className="primary" disabled={busy} onClick={() => void saveAttempt()}>
                Save attempt
              </button>
              <button className="secondary" disabled={busy} onClick={() => setDraft(undefined)}>
                Retry without saving
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card practice-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Step 3</p>
            <h2>Listen and compare</h2>
          </div>
        </div>
        {attempts.length > 1 && (
          <label>
            Attempt to compare
            <select value={selectedAttempt?.id ?? ""} onChange={(event) => setSelectedAttemptId(event.target.value)}>
              {attempts.map((attempt, index) => (
                <option value={attempt.id} key={attempt.id}>
                  {index === 0 ? "Most recent" : new Date(attempt.createdAt).toLocaleString()} · {formatDuration(attempt.durationMs)}
                  {attempt.isFavorite ? " ★" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {reference && selectedAttempt && (
          <div className="button-row">
            <button
              className="primary"
              type="button"
              onClick={() => {
                const referenceAudio = document.querySelector<HTMLAudioElement>('audio[aria-label="Reference audio"]');
                const learnerAudio = document.querySelector<HTMLAudioElement>('audio[aria-label="Learner attempt"]');
                if (referenceAudio && learnerAudio) void coordinator.current.alternate(referenceAudio, learnerAudio);
              }}
            >
              Alternate reference → mine
            </button>
            <button className="secondary" type="button" onClick={() => coordinator.current.cancel()}>
              Stop
            </button>
          </div>
        )}
        {reference && <AudioPlayer assetId={reference.audioAssetId} label="Reference audio" playbackRate={speed} />}
        {selectedAttempt && <AudioPlayer assetId={selectedAttempt.audioAssetId} label="Learner attempt" playbackRate={speed} />}
        <AnalysisPanel
          referenceAssetId={reference?.audioAssetId}
          learnerAssetId={selectedAttempt?.audioAssetId}
          hasReading={Boolean(sentence.reading)}
          durationHintSeconds={Math.max(1, (sentence.endSeconds ?? 2) - (sentence.startSeconds ?? 0))}
        />
      </section>

      <section className="card practice-card">
        <h2>Chunk practice</h2>
        <p className="muted">Separate chunks with |. Example: 今日は | どこへ | 行くんですか</p>
        <label>
          Chunks
          <input
            value={chunkDraft || chunks.map((chunk) => chunk.text).join(" | ")}
            onChange={(event) => setChunkDraft(event.target.value)}
            placeholder="今日は | どこへ | 行くんですか"
          />
        </label>
        <button className="secondary" type="button" onClick={() => void saveChunks()}>
          Save chunks
        </button>
        {chunks.length > 0 && (
          <div className="tag-row">
            {chunks.map((chunk) => (
              <span className="pill" key={chunk.id}>{chunk.text}</span>
            ))}
          </div>
        )}
      </section>

      <section className="card practice-card">
        <h2>Mora timing guide</h2>
        <p className="muted">Editable estimates only. Adjust markers when the automatic seeding is wrong.</p>
        <div className="mora-row">
          {morae.map((mora, index) => (
            <label key={`${mora.label}-${index}`} className="mora-chip">
              <span lang="ja">{mora.label}</span>
              <input
                type="number"
                step="0.01"
                value={mora.startSeconds.toFixed(2)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setMorae((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, startSeconds: value } : item
                    )
                  );
                }}
              />
            </label>
          ))}
        </div>
        <button
          className="secondary"
          type="button"
          onClick={() =>
            void timingGuideService.save({
              id: data.guide?.id ?? crypto.randomUUID(),
              sentenceId,
              readingSnapshot: sentence.reading,
              textSnapshot: sentence.reading || sentence.japanese,
              morae,
              origin: "manual",
              confidence: "high",
              revision: data.guide?.revision ?? 1,
              updatedAt: new Date().toISOString()
            })
          }
        >
          Save mora markers
        </button>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Practice history</h2>
          <span>{attempts.length}</span>
        </div>
        {(firstAttempt || favoriteAttempt) && selectedAttempt && (
          <p className="muted">
            Comparing against {favoriteAttempt ? "favorite" : "most recent"} attempt.
            First attempt: {firstAttempt ? formatDuration(firstAttempt.durationMs) : "—"}.
          </p>
        )}
        {attempts.length === 0 ? (
          <p className="muted">Saved attempts will appear here.</p>
        ) : (
          <div className="attempt-list">
            {attempts.map((attempt, index) => (
              <article className="card attempt-card" key={attempt.id}>
                <div className="attempt-heading">
                  <div>
                    <strong>{index === 0 ? "Most recent attempt" : new Date(attempt.createdAt).toLocaleString()}</strong>
                    <span>{formatDuration(attempt.durationMs)}{attempt.isFavorite ? " · favorite" : ""}</span>
                  </div>
                  <button
                    className="danger-text"
                    onClick={() => {
                      if (window.confirm("Delete this learner attempt?")) void attemptService.remove(attempt.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
                {attempt.notes && <p>{attempt.notes}</p>}
                <div className="button-row">
                  {(["better", "same", "worse", "unsure"] as ManualRating[]).map((rating) => (
                    <button
                      key={rating}
                      className={attempt.manualRating === rating ? "primary compact" : "secondary compact"}
                      type="button"
                      onClick={() => void attemptService.updateEvaluation(attempt.id, { manualRating: rating })}
                    >
                      {rating}
                    </button>
                  ))}
                  <button
                    className="secondary compact"
                    type="button"
                    onClick={() => void attemptService.updateEvaluation(attempt.id, { isFavorite: !attempt.isFavorite })}
                  >
                    {attempt.isFavorite ? "Unfavorite" : "Favorite"}
                  </button>
                </div>
                <AudioPlayer assetId={attempt.audioAssetId} label="Learner attempt" playbackRate={speed} />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
