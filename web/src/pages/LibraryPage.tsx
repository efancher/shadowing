import { useMemo, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../db/schema";
import { ErrorNotice, EmptyState } from "../components/Layout";
import { TransferService, type PackageImportMode, type PackageImportSummary } from "../services";
import type { SourceType } from "../types";

const transferService = new TransferService();

type SortMode = "updated" | "practiced" | "title";

export function LibraryPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<File>();
  const [summary, setSummary] = useState<PackageImportSummary>();
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

  async function handlePackagePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const next = await transferService.inspectShadowingPackage(file);
      setPendingFile(file);
      setSummary(next);
    } catch (reason) {
      setPendingFile(undefined);
      setSummary(undefined);
      setError(reason instanceof Error ? reason.message : "Could not read package.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(mode: PackageImportMode) {
    if (!pendingFile) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await transferService.importShadowingPackage(pendingFile, mode);
      setNotice(
        `Imported “${result.sourceTitle}” with ${result.sentenceCount} sentences and ${result.audioCount} clips.`
      );
      setPendingFile(undefined);
      setSummary(undefined);
      navigate(`/sources/${result.sourceId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import package.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your study material</p>
          <h1>Sentence library</h1>
        </div>
        <label className={`primary compact file-button${busy ? " disabled" : ""}`}>
          Import package
          <input
            type="file"
            accept=".zip,.shadowing.zip,application/zip"
            disabled={busy}
            onChange={(event) => void handlePackagePick(event)}
          />
        </label>
      </div>

      <section className="card form-card">
        <h2>Desktop CLI → practice</h2>
        <p className="muted">
          Mine and clip on your computer with <code>shadowmine</code>, then import a{" "}
          <code>.shadowing.zip</code> here to listen, record, and compare on this device.
        </p>
        <ErrorNotice message={error} />
        {notice && <p className="notice" role="status">{notice}</p>}
        {summary && (
          <div className="import-summary">
            <p>
              <strong>{summary.title}</strong>
              {summary.channel ? ` · ${summary.channel}` : ""}
            </p>
            <p className="muted">
              {summary.sentenceCount} sentences · {summary.audioCount} audio clips
              {summary.hasConflict ? " · conflicts with existing IDs" : ""}
            </p>
            <div className="button-row">
              <button
                className="primary"
                type="button"
                disabled={busy || (summary.hasConflict && !summary.canRefresh)}
                onClick={() => void confirmImport("merge")}
              >
                {summary.canRefresh ? "Refresh source" : "Merge"}
              </button>
              <button className="secondary" type="button" disabled={busy} onClick={() => void confirmImport("keep-both")}>
                Keep both
              </button>
              <button className="danger-text" type="button" disabled={busy} onClick={() => void confirmImport("replace")}>
                Replace library
              </button>
              <button type="button" disabled={busy} onClick={() => { setPendingFile(undefined); setSummary(undefined); }}>
                Cancel
              </button>
            </div>
            {summary.hasConflict && !summary.canRefresh && (
              <p className="muted">Merge is blocked because IDs already exist. Use Keep both or Replace.</p>
            )}
            {summary.canRefresh && (
              <p className="muted">This source is already in your library. Refresh updates clips and keeps matching attempts.</p>
            )}
          </div>
        )}
      </section>

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

      {!library ? (
        <p className="muted">Loading library…</p>
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching sources">
          Import a <code>.shadowing.zip</code> package to start practicing.
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
