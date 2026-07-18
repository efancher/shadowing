import { Link } from "react-router-dom";

const sections = [
  ["quick-start", "Quick start"],
  ["sources", "Sources and mining"],
  ["reference", "Reference audio"],
  ["practice", "Recording and practice"],
  ["analysis", "Understanding analysis"],
  ["backup", "Storage and backup"],
  ["ios", "iPhone and iPad"],
  ["troubleshooting", "Troubleshooting"]
] as const;

export function HelpPage() {
  return (
    <div className="page help-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Guide and troubleshooting</p>
          <h1>Help</h1>
          <p className="subtitle">
            From finding a sentence to comparing and improving your pronunciation.
          </p>
        </div>
      </div>

      <aside className="card help-toc" aria-label="Help topics">
        <h2>On this page</h2>
        <nav>
          {sections.map(([id, label]) => (
            <a href={`#${id}`} key={id}>{label}</a>
          ))}
        </nav>
      </aside>

      <section className="card help-section" id="quick-start">
        <p className="eyebrow">Start here</p>
        <h2>Quick start</h2>
        <ol className="help-steps">
          <li>
            <strong>Create a source.</strong>
            <span>Open the Library, choose New source, then add a title and optional URL.</span>
          </li>
          <li>
            <strong>Mine a short sentence.</strong>
            <span>Enter the Japanese text and timestamps, or use the YouTube/subtitle tools.</span>
          </li>
          <li>
            <strong>Add local reference audio.</strong>
            <span>Upload a short clip, or extract one from local media you lawfully possess.</span>
          </li>
          <li>
            <strong>Record yourself.</strong>
            <span>Open the sentence, tap Record, speak, stop, replay, and save the attempt.</span>
          </li>
          <li>
            <strong>Compare and repeat.</strong>
            <span>Alternate playback, inspect timing and pitch, write a note, then try again.</span>
          </li>
        </ol>
        <Link className="primary" to="/">Open the Library</Link>
      </section>

      <section className="card help-section" id="sources">
        <p className="eyebrow">Step 1</p>
        <h2>Sources and sentence mining</h2>

        <h3>Manual sources</h3>
        <p>
          Use a manual source for sentences that do not belong to one video or episode. You can
          still attach reference audio to every sentence.
        </p>

        <h3>YouTube sources</h3>
        <p>
          Paste a normal YouTube, youtu.be, Shorts, or embed URL. The source page provides an
          embedded player, current time, start/end controls, fine adjustments, and selection
          replay.
        </p>
        <div className="notice warning">
          YouTube supplies playback and timestamps only. Browsers cannot expose embedded YouTube
          audio for waveform or pitch analysis. Add a lawful local reference clip for analysis.
        </div>

        <h3>Subtitle import</h3>
        <p>
          Import a WebVTT (<code>.vtt</code>) or SRT (<code>.srt</code>) file from the source page.
          Select one or more cues and save them as a sentence. Subtitle boundaries often do not
          match grammatical sentence boundaries, so edit the result afterward.
        </p>

        <h3>Transcript status</h3>
        <dl className="help-definitions">
          <div><dt>Unverified</dt><dd>Text has not been checked against the audio.</dd></div>
          <div><dt>Machine generated</dt><dd>Text came from captions, recognition, or another automatic tool.</dd></div>
          <div><dt>Manually corrected</dt><dd>You edited an automatic draft.</dd></div>
          <div><dt>Verified</dt><dd>You carefully checked the text against the source.</dd></div>
        </dl>
      </section>

      <section className="card help-section" id="reference">
        <p className="eyebrow">Step 2</p>
        <h2>Reference audio and clipping</h2>
        <p>
          Each sentence can have one local reference clip. Short, clean speech without music
          produces the most useful comparison.
        </p>

        <h3>Upload a short clip</h3>
        <p>
          On the sentence page, choose Add local reference clip. Common browser-supported audio
          formats include WAV, MP3, M4A/AAC, and WebM.
        </p>

        <h3>Extract from longer media</h3>
        <ol>
          <li>Upload local audio or video on the source page.</li>
          <li>Select the destination sentence.</li>
          <li>Drag the waveform region or edit the start/end fields.</li>
          <li>Use the ±0.01, ±0.05, ±0.10, and ±0.50 controls for exact boundaries.</li>
          <li>Replay the selection, then save it as the sentence reference.</li>
        </ol>
        <p>
          Clips are saved as mono WAV for predictable local analysis. On phones, discard the
          longer original after extraction to save storage.
        </p>

        <div className="notice warning">
          Long files are decoded in browser memory. If Safari reloads or reports an error, use a
          shorter or smaller file and close other tabs.
        </div>
      </section>

      <section className="card help-section" id="practice">
        <p className="eyebrow">Step 3</p>
        <h2>Recording and practice</h2>

        <h3>Microphone calibration</h3>
        <p>
          Choose Calibrate mic and follow the prompt. The app checks approximate volume,
          clipping, and background noise. It gives guidance but never rejects an imperfect
          recording.
        </p>

        <h3>Recording attempts</h3>
        <ul>
          <li>Tap Record directly; microphone permission must start from a user gesture.</li>
          <li>Recordings stop automatically at 30 seconds.</li>
          <li>Replay before saving, add a note, or retry without saving.</li>
          <li>Mark attempts Better, Same, Worse, or Unsure based on your own listening.</li>
          <li>Favorite an attempt you want to use as a personal benchmark.</li>
        </ul>

        <h3>Playback and shadowing</h3>
        <p>
          Change playback speed, hide the transcript for audio-only practice, or alternate the
          reference and learner recordings. Slower playback is useful for hearing timing, but
          always return to 100% before judging natural rhythm.
        </p>

        <h3>Chunk practice</h3>
        <p>
          Divide text with vertical bars, for example:
        </p>
        <p className="help-example" lang="ja">今日は | どこへ | 行くんですか</p>
        <p>
          Practice one chunk until it is comfortable, join adjacent chunks, and finally return to
          the full sentence.
        </p>
      </section>

      <section className="card help-section" id="analysis">
        <p className="eyebrow">Read carefully</p>
        <h2>Understanding the analysis</h2>
        <div className="notice warning">
          Automatic feedback is descriptive and approximate. It is not a pronunciation score,
          accent diagnosis, or substitute for a teacher.
        </div>

        <h3>Comparison timing modes</h3>
        <dl className="help-definitions">
          <div>
            <dt>Original</dt>
            <dd>Preserves both real durations, pauses, and speaking speeds.</dd>
          </div>
          <div>
            <dt>Onset aligned</dt>
            <dd>Lines up the detected start of speech so early timing is easier to compare.</dd>
          </div>
          <div>
            <dt>Time normalized</dt>
            <dd>Scales duration for contour-shape comparison. It does not mean timing was correct.</dd>
          </div>
        </dl>

        <h3>Pitch views</h3>
        <dl className="help-definitions">
          <div>
            <dt>Speaker normalized</dt>
            <dd>
              Shows semitone movement around each speaker&apos;s median. Use this by default because
              speakers naturally have different absolute pitch.
            </dd>
          </div>
          <div>
            <dt>Hertz</dt>
            <dd>Shows raw estimated fundamental frequency for debugging and advanced inspection.</dd>
          </div>
          <div>
            <dt>Missing lines</dt>
            <dd>
              Silence and unvoiced consonants have no stable pitch. They are omitted rather than
              incorrectly drawn as zero.
            </dd>
          </div>
        </dl>

        <h3>Mora timing guide</h3>
        <p>
          The app seeds mora markers from the reading. Small kana join the preceding kana; っ and
          ん remain their own morae. Add a reading and manually correct marker positions when the
          estimate is wrong, especially for kanji.
        </p>

        <h3>Confidence labels</h3>
        <ul>
          <li><strong>High:</strong> good signal and manually corrected timing information.</li>
          <li><strong>Medium:</strong> useful pattern, but verify it by listening.</li>
          <li><strong>Low:</strong> weak audio, missing reading, or uncertain alignment; treat it only as a prompt.</li>
        </ul>

        <h3>Japanese-specific observations</h3>
        <p>
          Long-vowel, small-っ, ん, pause, and pitch-drop messages point to possible regions for
          closer listening. They do not claim that one articulation is mandatory or that an error
          definitely occurred.
        </p>
      </section>

      <section className="card help-section" id="backup">
        <p className="eyebrow">Protect your work</p>
        <h2>Storage and backup</h2>
        <p>
          All data lives in this browser&apos;s IndexedDB. Clearing website data, using private
          browsing, browser eviction, or uninstalling the Home Screen app can remove it.
        </p>

        <h3>Metadata JSON</h3>
        <p>
          Small export containing sources, sentences, timestamps, and practice counts. It does
          <strong> not</strong> include audio.
        </p>

        <h3>Full media ZIP</h3>
        <p>
          Complete archive containing metadata, reference clips, learner recordings, subtitles,
          and retained source media. Use this for real backups and device migration.
        </p>

        <h3>Restore choices</h3>
        <ul>
          <li><strong>Merge:</strong> keeps existing data and rejects conflicting IDs.</li>
          <li><strong>Replace:</strong> deletes current local data, then restores the archive.</li>
        </ul>
        <p>
          Keep backups in Files, iCloud Drive, or another location outside Safari. Large ZIP
          exports temporarily use extra memory.
        </p>
        <Link className="primary" to="/settings">Open Storage &amp; Backup</Link>
      </section>

      <section className="card help-section" id="ios">
        <p className="eyebrow">Safari guidance</p>
        <h2>iPhone and iPad</h2>
        <ol>
          <li>Open the deployed site in Safari.</li>
          <li>Tap Share, then Add to Home Screen.</li>
          <li>Launch the installed app and allow microphone access when recording.</li>
          <li>Open Storage &amp; Backup and request persistent storage.</li>
          <li>Export a full media ZIP regularly.</li>
        </ol>
        <p>
          Audio playback and recording must begin from a tap. Backgrounding the app may interrupt
          playback, analysis, or recording; return to the app and restart the action.
        </p>
      </section>

      <section className="card help-section" id="troubleshooting">
        <p className="eyebrow">Common problems</p>
        <h2>Troubleshooting</h2>

        <details>
          <summary>The microphone does not start</summary>
          <p>
            Use HTTPS or localhost, tap Record directly, and allow microphone access. On iPhone,
            check Settings → Apps → Safari → Microphone and the site&apos;s page settings.
          </p>
        </details>
        <details>
          <summary>The recording is silent or very quiet</summary>
          <p>
            Run calibration, move closer, disconnect unexpected Bluetooth devices, and verify the
            active input route. Retry after returning from the background.
          </p>
        </details>
        <details>
          <summary>Pitch analysis is empty or unstable</summary>
          <p>
            Use clean speech without music, reduce noise, avoid very short clips, and check both
            recordings. Unvoiced Japanese segments correctly have no pitch line.
          </p>
        </details>
        <details>
          <summary>A media file will not load</summary>
          <p>
            Browser codec support varies. Try WAV, MP3, AAC/M4A, or a smaller MP4/MOV that Safari
            can play. The app intentionally does not bundle ffmpeg.wasm.
          </p>
        </details>
        <details>
          <summary>YouTube playback does not start</summary>
          <p>
            Check the network, content embedding permissions, and tap the player. Age-restricted,
            private, or embedding-disabled videos may need to be opened on YouTube instead.
          </p>
        </details>
        <details>
          <summary>Saved data disappeared</summary>
          <p>
            Browser storage is best-effort. Restore the latest full media ZIP, install to the Home
            Screen, request persistent storage, and keep regular external backups.
          </p>
        </details>
        <details>
          <summary>The app shows an older version</summary>
          <p>
            Close all app tabs/windows and reopen it while online so the service worker can
            update. If necessary, clear the site cache only after exporting a full backup.
          </p>
        </details>
      </section>

      <section className="card help-section">
        <h2>Privacy and limitations</h2>
        <p>
          There is no account or audio-analysis server. Recordings remain on this device unless
          you explicitly export them. YouTube playback naturally contacts YouTube.
        </p>
        <p>
          The most important comparison remains your own listening: hear, isolate, record,
          compare, adjust, and repeat.
        </p>
      </section>
    </div>
  );
}
