import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorNotice, EmptyState } from "../components/Layout";
import { MediaClipEditor } from "../components/MediaClipEditor";
import { YouTubeMiner } from "../components/YouTubeMiner";
import { db } from "../db/schema";
import {
  ClipExportService,
  MediaImportService,
  SentenceService,
  SubtitleService,
  formatClock,
  mergeCueTexts
} from "../services";
import type { TranscriptStatus } from "../types";

const sentenceService = new SentenceService();
const mediaImport = new MediaImportService();
const clipExport = new ClipExportService();
const subtitleService = new SubtitleService();

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? Number(text) : undefined;
}

export function SourcePage() {
  const { sourceId = "" } = useParams();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [minerJapanese, setMinerJapanese] = useState("");
  const [minerReading, setMinerReading] = useState("");
  const [minerEnglish, setMinerEnglish] = useState("");
  const [selectedCueIds, setSelectedCueIds] = useState<string[]>([]);
  const [mediaUrl, setMediaUrl] = useState<string>();
  const [clipSentenceId, setClipSentenceId] = useState<string>();

  const data = useLiveQuery(async () => {
    const [source, sentences, media, tracks, cues] = await Promise.all([
      db.sources.get(sourceId),
      db.sentences.where("sourceId").equals(sourceId).reverse().sortBy("createdAt"),
      db.sourceMedia.where("sourceId").equals(sourceId).first(),
      db.subtitleTracks.where("sourceId").equals(sourceId).toArray(),
      db.subtitleCues.where("sourceId").equals(sourceId).sortBy("startMs")
    ]);
    return { source, sentences, media, track: tracks[0], cues };
  }, [sourceId]);

  const selectedCues = useMemo(
    () => data?.cues.filter((cue) => selectedCueIds.includes(cue.id)) ?? [],
    [data?.cues, selectedCueIds]
  );

  useEffect(() => {
    if (!data?.media) {
      setMediaUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return undefined;
      });
      return;
    }
    const url = URL.createObjectURL(data.media.blob);
    setMediaUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return url;
    });
    return () => URL.revokeObjectURL(url);
  }, [data?.media]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const sentence = await sentenceService.createSentence({
        sourceId,
        japanese: String(form.get("japanese")),
        reading: String(form.get("reading")),
        english: String(form.get("english")),
        startSeconds: optionalNumber(form.get("startSeconds")),
        endSeconds: optionalNumber(form.get("endSeconds")),
        speakerLabel: String(form.get("speakerLabel")),
        tags: String(form.get("tags")).split(","),
        transcriptStatus: String(form.get("transcriptStatus")) as TranscriptStatus
      });
      navigate(`/sentences/${sentence.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save sentence.");
    }
  }

  async function saveMinedSentence(startSeconds: number, endSeconds: number) {
    setBusy(true);
    setError(undefined);
    try {
      const sentence = await sentenceService.createSentence({
        sourceId,
        japanese: minerJapanese,
        reading: minerReading,
        english: minerEnglish,
        startSeconds,
        endSeconds,
        transcriptStatus: "manually-corrected"
      });
      navigate(`/sentences/${sentence.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save mined sentence.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      await mediaImport.attachSourceMedia(sourceId, file);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import media.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function importSubtitles(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      await subtitleService.importFile(sourceId, file);
      setSelectedCueIds([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import subtitles.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function saveSelectedCues() {
    if (selectedCues.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      const startSeconds = selectedCues[0].startMs / 1000;
      const endSeconds = selectedCues[selectedCues.length - 1].endMs / 1000;
      const sentence = await sentenceService.createSentence({
        sourceId,
        japanese: mergeCueTexts(selectedCues.map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs, text: cue.text }))),
        startSeconds,
        endSeconds,
        transcriptStatus: "machine-generated"
      });
      navigate(`/sentences/${sentence.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save subtitle sentence.");
    } finally {
      setBusy(false);
    }
  }

  async function saveClip(startSeconds: number, endSeconds: number) {
    if (!data?.media || !clipSentenceId) return;
    setBusy(true);
    setError(undefined);
    try {
      const discard = window.confirm("Discard the long original media after extracting this clip? (Recommended on iPhone.)");
      await clipExport.saveClipAsReference({
        sentenceId: clipSentenceId,
        media: data.media,
        startSeconds,
        endSeconds,
        originalFileName: data.media.originalFileName,
        discardSourceMediaId: discard ? data.media.id : undefined
      });
      navigate(`/sentences/${clipSentenceId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save clip.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="page"><p className="muted">Loading source…</p></div>;
  if (!data.source) {
    return (
      <div className="page">
        <EmptyState title="Source not found">It may have been removed from this device.</EmptyState>
        <Link className="text-link" to="/">Return to library</Link>
      </div>
    );
  }

  const { source, sentences, media, cues } = data;

  return (
    <div className="page">
      <Link className="back-link" to="/">‹ Library</Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{source.type.replace("-", " ")}</p>
          <h1>{source.title}</h1>
          {source.channelOrCreator && <p className="subtitle">{source.channelOrCreator}</p>}
        </div>
        <button className="primary compact" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Cancel" : "Mine sentence"}
        </button>
      </div>
      {source.url && (
        <a className="source-link" href={source.url} target="_blank" rel="noreferrer">
          Open original source <span aria-hidden="true">↗</span>
        </a>
      )}
      <ErrorNotice message={error} />

      {source.externalId && (
        <YouTubeMiner
          videoId={source.externalId}
          japanese={minerJapanese}
          reading={minerReading}
          english={minerEnglish}
          onJapaneseChange={setMinerJapanese}
          onReadingChange={setMinerReading}
          onEnglishChange={setMinerEnglish}
          onSave={saveMinedSentence}
          busy={busy}
        />
      )}

      <section className="card form-card">
        <h2>Local media</h2>
        <p className="muted">Upload audio/video you lawfully possess, then clip a short reference for analysis.</p>
        <div className="button-row">
          <label className="primary file-button">
            Upload media
            <input type="file" accept="audio/*,video/*,.mp3,.m4a,.wav,.aac,.webm,.mp4,.mov" onChange={uploadMedia} disabled={busy} />
          </label>
          {media && (
            <button className="danger-text" type="button" disabled={busy} onClick={() => void mediaImport.removeSourceMedia(sourceId)}>
              Remove original media
            </button>
          )}
        </div>
        {media && mediaUrl && (
          <>
            <p className="muted">
              {media.originalFileName ?? "Uploaded media"} · {(media.byteLength / (1024 * 1024)).toFixed(1)} MB ·{" "}
              {formatClock(media.durationMs / 1000)}
            </p>
            <label>
              Save clip to sentence
              <select value={clipSentenceId ?? ""} onChange={(event) => setClipSentenceId(event.target.value || undefined)}>
                <option value="">Select a sentence…</option>
                {sentences.map((sentence) => (
                  <option key={sentence.id} value={sentence.id}>
                    {sentence.japanese}
                  </option>
                ))}
              </select>
            </label>
            {clipSentenceId ? (
              <MediaClipEditor
                url={mediaUrl}
                mimeType={media.mimeType}
                initialStart={sentences.find((sentence) => sentence.id === clipSentenceId)?.startSeconds}
                initialEnd={sentences.find((sentence) => sentence.id === clipSentenceId)?.endSeconds}
                onSave={saveClip}
                busy={busy}
              />
            ) : (
              <p className="muted">Create or select a sentence before extracting a clip.</p>
            )}
          </>
        )}
      </section>

      <section className="card form-card">
        <h2>Subtitle import</h2>
        <p className="muted">Import WebVTT or SRT, select cues, then edit the resulting Japanese sentence.</p>
        <label className="secondary file-button">
          Import VTT/SRT
          <input type="file" accept=".vtt,.srt,text/vtt,application/x-subrip" onChange={importSubtitles} disabled={busy} />
        </label>
        {cues.length > 0 && (
          <>
            <div className="cue-list">
              {cues.map((cue) => {
                const selected = selectedCueIds.includes(cue.id);
                return (
                  <button
                    key={cue.id}
                    type="button"
                    className={selected ? "cue-item selected" : "cue-item"}
                    onClick={() =>
                      setSelectedCueIds((current) =>
                        selected ? current.filter((id) => id !== cue.id) : [...current, cue.id].sort(
                          (a, b) => (cues.find((item) => item.id === a)?.startMs ?? 0) - (cues.find((item) => item.id === b)?.startMs ?? 0)
                        )
                      )
                    }
                  >
                    <span>{formatClock(cue.startMs / 1000)}–{formatClock(cue.endMs / 1000)}</span>
                    <strong lang="ja">{cue.text}</strong>
                  </button>
                );
              })}
            </div>
            <button className="primary" type="button" disabled={selectedCues.length === 0 || busy} onClick={() => void saveSelectedCues()}>
              Save selected cues as sentence
            </button>
          </>
        )}
      </section>

      {showForm && (
        <form className="card form-card" onSubmit={handleSubmit}>
          <h2>Save a sentence manually</h2>
          <label>
            Japanese sentence
            <textarea name="japanese" required rows={3} lang="ja" placeholder="今日はどこへ行くんですか。" />
          </label>
          <label>
            Reading <span className="optional">optional</span>
            <input name="reading" lang="ja" />
          </label>
          <label>
            English <span className="optional">optional</span>
            <input name="english" />
          </label>
          <div className="form-grid">
            <label>
              Start (seconds)
              <input name="startSeconds" type="number" min="0" step="0.01" inputMode="decimal" />
            </label>
            <label>
              End (seconds)
              <input name="endSeconds" type="number" min="0" step="0.01" inputMode="decimal" />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Speaker
              <input name="speakerLabel" />
            </label>
            <label>
              Transcript status
              <select name="transcriptStatus" defaultValue="unverified">
                <option value="unverified">Unverified</option>
                <option value="machine-generated">Machine generated</option>
                <option value="manually-corrected">Manually corrected</option>
                <option value="verified">Verified</option>
              </select>
            </label>
          </div>
          <label>
            Tags <span className="optional">comma-separated</span>
            <input name="tags" placeholder="travel, question" />
          </label>
          <button className="primary" type="submit">Save sentence</button>
        </form>
      )}

      <section className="section">
        <div className="section-heading">
          <h2>Saved sentences</h2>
          <span>{sentences.length}</span>
        </div>
        {sentences.length === 0 ? (
          <EmptyState title="No sentences yet">
            Save a useful short line with its start and end timestamps.
          </EmptyState>
        ) : (
          <div className="sentence-list">
            {sentences.map((sentence) => (
              <Link className="card sentence-card" to={`/sentences/${sentence.id}`} key={sentence.id}>
                <div>
                  <p className="japanese" lang="ja">{sentence.japanese}</p>
                  {sentence.english && <p className="muted">{sentence.english}</p>}
                </div>
                <div className="sentence-meta">
                  <span>{formatClock(sentence.startSeconds ?? 0)}–{formatClock(sentence.endSeconds ?? 0)}</span>
                  {sentence.referenceAudioId && <span className="pill success">reference</span>}
                  <span className="chevron" aria-hidden="true">›</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
