import { Link } from "react-router-dom";

export function HelpPage() {
  return (
    <div className="page help-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">How it works</p>
          <h1>CLI mine → import → practice</h1>
        </div>
      </div>

      <section className="card form-card">
        <h2>Two-part workflow</h2>
        <ol className="help-steps">
          <li>
            On a desktop computer, use <code>shadowmine</code> to fetch a video you may lawfully download,
            mine Japanese subtitle lines, clip short reference audio, and export a{" "}
            <code>.shadowing.zip</code> package.
          </li>
          <li>
            On this device, open the <Link to="/">library</Link> or{" "}
            <Link to="/settings">Settings</Link> and import the package.
          </li>
          <li>
            Open a sentence to listen to the reference clip, record your attempt, and compare playback.
          </li>
        </ol>
        <p className="muted">
          This web app does not embed YouTube, download media, or trim long source files in the browser.
          Acquisition and clipping stay on the desktop CLI.
        </p>
      </section>

      <section className="card form-card">
        <h2>Desktop CLI sketch</h2>
        <pre className="code-block">{`shadowmine inspect <url>
shadowmine fetch <url>
shadowmine subtitles <project>
shadowmine mine <project>
shadowmine clip --project ... --start ... --end ... --japanese "..."
shadowmine export <project>
shadowmine validate package.shadowing.zip`}</pre>
        <p className="muted">
          You are responsible for complying with YouTube’s terms and copyright law for any downloads.
          The tool does not bypass DRM or age gates.
        </p>
      </section>

      <section className="card form-card">
        <h2>Practice tips</h2>
        <ul>
          <li>Prefer short clips (a few seconds) so packages stay small on iPhone.</li>
          <li>Treat auto captions as drafts; correct Japanese text in the CLI before export when you can.</li>
          <li>Use Settings to export a full media ZIP backup of your local library and recordings.</li>
          <li>Install via Safari → Share → Add to Home Screen for a more persistent on-device store.</li>
        </ul>
      </section>

      <section className="card form-card">
        <h2>Legacy backups</h2>
        <p className="muted">
          Older <code>japanese-pronunciation-lab</code> metadata JSON (v1) and media ZIP (v2) backups remain
          importable for one release. New study material should come from{" "}
          <code>japanese-shadowing-package</code> v1 packages.
        </p>
      </section>
    </div>
  );
}
