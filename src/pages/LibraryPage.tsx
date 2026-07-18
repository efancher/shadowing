import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../db/schema";
import { ErrorNotice, EmptyState } from "../components/Layout";
import { SentenceService } from "../services";
import type { SourceType } from "../types";

const sentenceService = new SentenceService();

export function LibraryPage() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string>();
  const library = useLiveQuery(async () => {
    const [sources, sentences, references, attempts] = await Promise.all([
      db.sources.orderBy("updatedAt").reverse().toArray(),
      db.sentences.toArray(),
      db.referenceAudio.toArray(),
      db.attempts.toArray()
    ]);
    return sources.map((source) => {
      const sourceSentences = sentences.filter((sentence) => sentence.sourceId === source.id);
      const sentenceIds = new Set(sourceSentences.map(({ id }) => id));
      const sourceAttempts = attempts.filter((attempt) => sentenceIds.has(attempt.sentenceId));
      return {
        source,
        sentenceCount: sourceSentences.length,
        referenceCount: references.filter((reference) => sentenceIds.has(reference.sentenceId)).length,
        attemptCount: sourceAttempts.length,
        lastPracticed: sourceAttempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt
      };
    });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const source = await sentenceService.createSource({
        title: String(data.get("title")),
        type: String(data.get("type")) as SourceType,
        url: String(data.get("url")),
        channelOrCreator: String(data.get("creator"))
      });
      navigate(`/sources/${source.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save source.");
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your study material</p>
          <h1>Sentence library</h1>
        </div>
        <button className="primary compact" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Cancel" : "New source"}
        </button>
      </div>

      {showForm && (
        <form className="card form-card" onSubmit={handleSubmit}>
          <h2>Add a source</h2>
          <label>
            Title
            <input name="title" required placeholder="Video, episode, podcast…" />
          </label>
          <div className="form-grid">
            <label>
              Type
              <select name="type" defaultValue="youtube">
                <option value="youtube">YouTube</option>
                <option value="uploaded-video">Uploaded video</option>
                <option value="uploaded-audio">Uploaded audio</option>
                <option value="podcast">Podcast</option>
                <option value="manual">Manual study set</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Creator
              <input name="creator" placeholder="Channel or speaker" />
            </label>
          </div>
          <label>
            URL <span className="optional">optional</span>
            <input name="url" type="url" inputMode="url" placeholder="https://…" />
          </label>
          <ErrorNotice message={error} />
          <button className="primary" type="submit">Create source</button>
        </form>
      )}

      {!library ? (
        <p className="muted">Loading library…</p>
      ) : library.length === 0 ? (
        <EmptyState title="Save your first source">
          Start with a video, podcast, or manual study set, then mine a short sentence.
        </EmptyState>
      ) : (
        <div className="card-grid">
          {library.map(({ source, sentenceCount, referenceCount, attemptCount, lastPracticed }) => (
            <Link className="card source-card" to={`/sources/${source.id}`} key={source.id}>
              <div className="card-topline">
                <span className="pill">{source.type.replace("-", " ")}</span>
                <span className="chevron" aria-hidden="true">›</span>
              </div>
              <h2>{source.title}</h2>
              {source.channelOrCreator && <p className="muted">{source.channelOrCreator}</p>}
              <dl className="stats-row">
                <div><dt>Sentences</dt><dd>{sentenceCount}</dd></div>
                <div><dt>References</dt><dd>{referenceCount}</dd></div>
                <div><dt>Attempts</dt><dd>{attemptCount}</dd></div>
              </dl>
              <p className="last-practiced">
                {lastPracticed
                  ? `Last practiced ${new Date(lastPracticed).toLocaleDateString()}`
                  : "Not practiced yet"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
