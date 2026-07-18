import { useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../db/schema";
import { ErrorNotice, EmptyState } from "../components/Layout";
import { SentenceService } from "../services";
import type { SourceType } from "../types";

const sentenceService = new SentenceService();

type SortMode = "updated" | "practiced" | "title";

export function LibraryPage() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SourceType | "all">("all");
  const [onlyWithReference, setOnlyWithReference] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("updated");

  const library = useLiveQuery(async () => {
    const [sources, sentences, references, attempts] = await Promise.all([
      db.sources.toArray(),
      db.sentences.toArray(),
      db.referenceAudio.toArray(),
      db.attempts.toArray()
    ]);
    return sources.map((source) => {
      const sourceSentences = sentences.filter((sentence) => sentence.sourceId === source.id);
      const sentenceIds = new Set(sourceSentences.map(({ id }) => id));
      const sourceAttempts = attempts.filter((attempt) => sentenceIds.has(attempt.sentenceId));
      const lastPracticed = sourceAttempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt;
      return {
        source,
        sentenceCount: sourceSentences.length,
        referenceCount: references.filter((reference) => sentenceIds.has(reference.sentenceId)).length,
        attemptCount: sourceAttempts.length,
        lastPracticed,
        tags: Array.from(new Set(sourceSentences.flatMap((sentence) => sentence.tags)))
      };
    });
  }, []);

  const filtered = useMemo(() => {
    if (!library) return [];
    const needle = query.trim().toLowerCase();
    let rows = library.filter((row) => {
      if (typeFilter !== "all" && row.source.type !== typeFilter) return false;
      if (onlyWithReference && row.referenceCount === 0) return false;
      if (needsReview && row.attemptCount > 0 && row.referenceCount > 0) {
        // needs review = has material but no recent practice in 7 days or never practiced
      }
      if (needsReview) {
        const stale =
          !row.lastPracticed ||
          Date.now() - new Date(row.lastPracticed).getTime() > 7 * 24 * 60 * 60 * 1000;
        if (!stale) return false;
      }
      if (!needle) return true;
      return (
        row.source.title.toLowerCase().includes(needle) ||
        row.source.channelOrCreator?.toLowerCase().includes(needle) ||
        row.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
    rows = rows.slice().sort((a, b) => {
      if (sortMode === "title") return a.source.title.localeCompare(b.source.title);
      if (sortMode === "practiced") {
        return (b.lastPracticed ?? "").localeCompare(a.lastPracticed ?? "");
      }
      return b.source.updatedAt.localeCompare(a.source.updatedAt);
    });
    return rows;
  }, [library, query, typeFilter, onlyWithReference, needsReview, sortMode]);

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

      <section className="card form-card filters-card">
        <div className="form-grid">
          <label>
            Search
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, creator, tag…" />
          </label>
          <label>
            Sort
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="updated">Recently updated</option>
              <option value="practiced">Recently practiced</option>
              <option value="title">Title</option>
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>
            Source type
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as SourceType | "all")}>
              <option value="all">All</option>
              <option value="youtube">YouTube</option>
              <option value="uploaded-audio">Uploaded audio</option>
              <option value="uploaded-video">Uploaded video</option>
              <option value="podcast">Podcast</option>
              <option value="manual">Manual</option>
              <option value="other">Other</option>
            </select>
          </label>
          <div className="filter-toggles">
            <label className="checkbox-row">
              <input type="checkbox" checked={onlyWithReference} onChange={(event) => setOnlyWithReference(event.target.checked)} />
              Has reference audio
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={needsReview} onChange={(event) => setNeedsReview(event.target.checked)} />
              Needs review
            </label>
          </div>
        </div>
      </section>

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
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching sources">
          Adjust filters or save your first source to begin mining sentences.
        </EmptyState>
      ) : (
        <div className="card-grid">
          {filtered.map(({ source, sentenceCount, referenceCount, attemptCount, lastPracticed }) => (
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
