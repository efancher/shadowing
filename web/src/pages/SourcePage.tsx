import { useLiveQuery } from "dexie-react-hooks";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "../components/Layout";
import { db } from "../db/schema";
import { formatClock } from "../services";

export function SourcePage() {
  const { sourceId = "" } = useParams();

  const data = useLiveQuery(async () => {
    const [source, sentences] = await Promise.all([
      db.sources.get(sourceId),
      db.sentences.where("sourceId").equals(sourceId).reverse().sortBy("createdAt")
    ]);
    return { source, sentences };
  }, [sourceId]);

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
      </div>
      {source.url && (
        <a className="source-link" href={source.url} target="_blank" rel="noreferrer">
          Open original source <span aria-hidden="true">↗</span>
        </a>
      )}
      <p className="muted">
        Sentences and reference clips come from a <code>.shadowing.zip</code> package built with the desktop CLI.
        Open a sentence to listen, record, and compare.
      </p>

      <section className="section">
        <div className="section-heading">
          <h2>Sentences</h2>
          <span>{sentences.length}</span>
        </div>
        {sentences.length === 0 ? (
          <EmptyState title="No sentences yet">
            Import a shadowing package from the library or Settings.
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
                  <span>
                    {formatClock(sentence.startSeconds ?? 0)}–{formatClock(sentence.endSeconds ?? 0)}
                  </span>
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
