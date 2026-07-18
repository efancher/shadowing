import { useEffect, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { ErrorNotice } from "../components/Layout";
import { TransferService } from "../services";

const transferService = new TransferService();

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsPage() {
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [estimatedUsage, setEstimatedUsage] = useState<{ usage?: number; quota?: number }>();
  const [persisted, setPersisted] = useState<boolean>();
  const summary = useLiveQuery(() => transferService.storageSummary(), [
    db.sources,
    db.sentences,
    db.audioAssets,
    db.attempts,
    db.referenceAudio,
    db.sourceMedia
  ]);

  useEffect(() => {
    navigator.storage?.estimate().then(setEstimatedUsage).catch(() => undefined);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => undefined);
  }, [summary]);

  async function exportMetadata() {
    setError(undefined);
    try {
      const data = await transferService.exportMetadata();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pronunciation-lab-metadata-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not export metadata.");
    }
  }

  async function exportZip() {
    setError(undefined);
    setNotice("Building media archive… large libraries may take a moment and use temporary memory.");
    try {
      const blob = await transferService.exportMediaArchive();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pronunciation-lab-media-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice("Media archive downloaded. Keep it somewhere safe; Safari may clear on-device storage.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not export media archive.");
      setNotice(undefined);
    }
  }

  async function importMetadata(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(undefined);
    setNotice(undefined);
    try {
      const value: unknown = JSON.parse(await file.text());
      const replace = window.confirm(
        "Choose OK to replace this library. Choose Cancel to merge without overwriting existing IDs."
      );
      if (replace && !window.confirm("Replace all local data, including recordings, with this metadata backup?")) {
        event.target.value = "";
        return;
      }
      await transferService.importMetadata(value, replace ? "replace" : "merge");
      setNotice("Metadata imported successfully. Media is not included in metadata backups.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import metadata.");
    } finally {
      event.target.value = "";
    }
  }

  async function importZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(undefined);
    setNotice(undefined);
    try {
      const replace = window.confirm(
        "Choose OK to replace this library with the archive. Choose Cancel to merge."
      );
      if (replace && !window.confirm("This will delete existing local data before restoring the archive.")) {
        event.target.value = "";
        return;
      }
      await transferService.importMediaArchive(file, replace ? "replace" : "merge");
      setNotice("Media archive restored.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import media archive.");
    } finally {
      event.target.value = "";
    }
  }

  async function requestPersist() {
    try {
      const granted = await navigator.storage?.persist?.();
      setPersisted(Boolean(granted));
      setNotice(granted ? "Persistent storage requested successfully." : "Browser did not grant persistent storage.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not request persistent storage.");
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">On-device data</p>
          <h1>Storage & backup</h1>
        </div>
      </div>

      <section className="card settings-card">
        <h2>Library storage</h2>
        {!summary ? (
          <p className="muted">Calculating…</p>
        ) : (
          <>
            <dl className="storage-grid">
              <div><dt>Sources</dt><dd>{summary.sources}</dd></div>
              <div><dt>Sentences</dt><dd>{summary.sentences}</dd></div>
              <div><dt>Reference clips</dt><dd>{summary.referenceClips}</dd></div>
              <div><dt>Learner attempts</dt><dd>{summary.attempts}</dd></div>
              <div><dt>Reference bytes</dt><dd>{formatBytes(summary.referenceBytes)}</dd></div>
              <div><dt>Attempt bytes</dt><dd>{formatBytes(summary.attemptBytes)}</dd></div>
              <div><dt>Source media</dt><dd>{formatBytes(summary.sourceMediaBytes)}</dd></div>
              <div><dt>Total media</dt><dd>{formatBytes(summary.mediaBytes)}</dd></div>
            </dl>
            {summary.largest.length > 0 && (
              <div>
                <h3>Largest items</h3>
                <ul>
                  {summary.largest.map((item) => (
                    <li key={item.id}>{item.label} · {formatBytes(item.bytes)}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {estimatedUsage?.quota !== undefined && (
          <p className="muted">
            Browser-reported usage {estimatedUsage.usage === undefined ? "—" : formatBytes(estimatedUsage.usage)} / quota{" "}
            {formatBytes(estimatedUsage.quota)}.
            {persisted !== undefined && ` Persistent storage: ${persisted ? "yes" : "no"}.`}
          </p>
        )}
        <button className="secondary" type="button" onClick={() => void requestPersist()}>
          Request persistent storage
        </button>
      </section>

      <section className="card settings-card">
        <h2>Metadata backup</h2>
        <p>
          Export sources, sentences, timestamps, and practice counts as versioned JSON.
          <strong> Audio files are not included.</strong>
        </p>
        <div className="button-row">
          <button className="primary" onClick={() => void exportMetadata()}>Export metadata JSON</button>
          <label className="secondary file-button">
            Import metadata
            <input type="file" accept="application/json,.json" onChange={importMetadata} />
          </label>
        </div>
      </section>

      <section className="card settings-card">
        <h2>Full media archive</h2>
        <p>
          Export a ZIP containing metadata plus reference clips, learner recordings, and uploaded source media.
          Large archives can strain iPhone memory—export when the library is still manageable.
        </p>
        <div className="button-row">
          <button className="primary" onClick={() => void exportZip()}>Export media ZIP</button>
          <label className="secondary file-button">
            Import media ZIP
            <input type="file" accept="application/zip,.zip" onChange={importZip} />
          </label>
        </div>
        <ErrorNotice message={error} />
        {notice && <p className="notice success" role="status">{notice}</p>}
      </section>

      <section className="card settings-card">
        <h2>iPhone & iPad storage</h2>
        <p>
          Safari storage is best-effort and can be removed by the system. Install this app from
          Safari using <strong>Share → Add to Home Screen</strong>, practice regularly, and export backups.
        </p>
        <p className="muted">Recordings never leave this device unless you explicitly export them.</p>
      </section>
    </div>
  );
}
