import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorNotice, EmptyState } from "../components/Layout";
import { db } from "../db/schema";
import { SentenceService } from "../services";
import type { TranscriptStatus } from "../types";

const sentenceService = new SentenceService();

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? Number(text) : undefined;
}

function formatTime(seconds?: number) {
  if (seconds === undefined) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${remainder}`;
}

export function SourcePage() {
  const { sourceId = "" } = useParams();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string>();
  const data = useLiveQuery(async () => {
    const [source, sentences] = await Promise.all([
      db.sources.get(sourceId),
      db.sentences.where("sourceId").equals(sourceId).reverse().sortBy("createdAt")
    ]);
    return { source, sentences };
  }, [sourceId]);

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

  if (!data) return <div className="page"><p className="muted">Loading source…</p></div>;
  if (!data.source) {
    return (
      <div className="page">
        <EmptyState title="Source not found">It may have been removed from this device.</EmptyState>
        <Link className="text-link" to="/">Return to library</Link>
      </div>
    );
  }

  const { source, sentences } = data;
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

      {showForm && (
        <form className="card form-card" onSubmit={handleSubmit}>
          <h2>Save a sentence</h2>
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
          <ErrorNotice message={error} />
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
                  <span>{formatTime(sentence.startSeconds)}–{formatTime(sentence.endSeconds)}</span>
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
