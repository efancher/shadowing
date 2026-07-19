# shadowmine

`shadowmine` prepares short Japanese reference clips on a desktop computer and
exports them as a `.shadowing.zip` package. Import that package into the
Japanese Shadowing Lab web app to listen, record, and compare.

The CLI handles the desktop-only work:

1. Inspect a YouTube source.
2. Download its audio and subtitles.
3. Review subtitle cues and select useful sentences.
4. Create padded AAC/M4A clips.
5. Export and validate a portable package.

The CLI does not bypass DRM, login requirements, age restrictions, or other
access controls. You are responsible for complying with YouTube's terms,
copyright law, and the rights attached to the source material.

## Requirements

- Python 3.11 or newer
- `ffmpeg` and `ffprobe` on `PATH`
- Internet access for YouTube inspection, audio, and subtitle downloads

Install FFmpeg:

```bash
# macOS with Homebrew
brew install ffmpeg

# Windows with winget
winget install Gyan.FFmpeg

# Windows with Scoop
scoop install ffmpeg

# Debian / Ubuntu
sudo apt install ffmpeg
```

## Install the CLI

Run these commands from the repository's `cli/` directory:

```bash
python3.12 -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
python -m pip install -e .
```

The editable install provides the `shadowmine` command and installs Typer,
Rich, Pydantic, jsonschema, yt-dlp, and the kana reading engine
(`fugashi` + `unidic-lite`).

Confirm that everything is available:

```bash
shadowmine doctor
shadowmine version
shadowmine --help
```

`doctor` prints an install hint and exits nonzero when Python, FFmpeg, FFprobe,
or yt-dlp is missing. Kana readings are optional: when that engine is missing,
clips still save, just without furigana.

## Quick start

Replace the URL below with a video you may lawfully download:

```bash
URL="https://www.youtube.com/watch?v=VIDEO_ID"

# Run the normal guided workflow.
shadowmine create "$URL"
```

`create` runs the complete path:

1. Downloads the source audio.
2. Downloads and cleans Japanese subtitles.
3. Opens the interactive cue browser so you can keep, edit, or skip lines.
4. Exports a `.shadowing.zip` after you finish reviewing cues.
5. Validates the finished package.

To accept every cleaned Japanese cue without any mining prompts:

```bash
shadowmine create "$URL" -y
```

When English subtitles are available, `shadowmine` downloads them too and
matches them to Japanese cues by timestamp overlap. The matched translation
is stored in each sentence's English field. Cues without a usable English
match remain blank.

By default, each saved sentence also gets a hiragana `reading` generated from
the Japanese text (useful when kanji is unfamiliar). Pass `--no-kana` to skip
that. Readings are dictionary-based hints from UniDic, not verified furigana.

Repeated runs reuse on-disk source audio and subtitle files when they already
look valid, so you avoid another YouTube download (and intermittent 403s). Pass
`--refresh` to force a fresh download:

```bash
shadowmine create "$URL" -y --refresh
```

The command prints the project and package paths. Transfer the resulting
`.shadowing.zip` to your phone or tablet and choose **Import package** in the
web app's Library or Settings page.

Use `--projects` to choose the project location or `--output` to choose the
package location:

```bash
shadowmine create "$URL" \
  --projects "/path/to/shadowing-projects" \
  --output "/path/to/my-lesson.shadowing.zip"
```

### Step-by-step alternative

The individual commands remain available when you want to inspect each stage,
resume an existing project, adjust clips manually, or troubleshoot:

```bash
# Preview metadata without downloading the media.
shadowmine inspect "$URL"

# Download audio to projects/<videoId>/.
shadowmine fetch "$URL"

# Download Japanese subtitles into the same project.
shadowmine subtitles "projects/VIDEO_ID"

# Review subtitle cues and save selected clips.
shadowmine mine "projects/VIDEO_ID"

# Build a package after saving at least one sentence.
shadowmine export "projects/VIDEO_ID"

# Validate the generated package.
shadowmine validate "projects/VIDEO_ID/VIDEO_ID.shadowing.zip"
```

## Import mined sentences into the web app

### 1. Export the mined project

Mining writes individual clips and metadata into the project directory, but
the web app imports a package—not the project directory or `sentences.json` by
itself.

After `shadowmine mine` or `shadowmine clip` has saved at least one sentence,
run:

```bash
shadowmine export "projects/VIDEO_ID"
shadowmine validate "projects/VIDEO_ID/VIDEO_ID.shadowing.zip"
```

The file to transfer is:

```text
projects/VIDEO_ID/VIDEO_ID.shadowing.zip
```

It contains the source details, mined sentence text and timestamps, and each
short reference-audio clip. It does not contain the full downloaded source
audio.

### 2. Move the package to the practice device

Use any file-transfer method that preserves the `.shadowing.zip` file:

- AirDrop it from a Mac to an iPhone or iPad and save it in Files.
- Put it in iCloud Drive, Google Drive, Dropbox, or another synced folder.
- Email or message it to yourself if the package is small enough.
- Import it directly from the desktop if you practice in a desktop browser.

Do not unzip the package before importing it.

### 3. Open the web app

Open the hosted practice app:

<https://efancher.github.io/shadowing/>

For local web development instead:

```bash
cd ../web
npm ci
npm run dev
```

Open the URL printed by Vite. The hosted and local versions use separate
browser storage because they have different origins.

### 4. Import from the Library

The Library gives the clearest import choices:

1. Select **Import package** at the top of the Library.
2. Choose the `.shadowing.zip` file from the device's file picker.
3. Review the source title, channel, sentence count, and audio-clip count.
4. Choose an import mode:
   - **Merge** adds a new source without deleting anything already stored.
   - **Refresh source** appears when the same source was imported before. It
     updates its sentences and clips while preserving attempts whose sentence
     IDs still exist.
   - **Keep both** assigns new IDs and imports a second copy.
   - **Replace library** deletes the current on-device library—including
     learner recordings and practice history—before importing this package.
5. After import, the app opens the source and lists its mined sentences.

Use **Replace library** only when you intentionally want to discard all
existing on-device data. Export a full media backup from Settings first if the
current recordings matter.

You can also import from **Settings → Import shadowing package**. That entry
point uses confirmation dialogs to choose merge, keep-both, or replacement;
the Library presents the choices explicitly and is generally easier to use.

### 5. Practice the imported sentences

1. Open the imported source in the Library.
2. Select a sentence.
3. Play the packaged reference clip.
4. Record your attempt and use the comparison controls to alternate between
   the reference and your recording.
5. Repeat or review prior attempts as needed.

Imported packages and learner recordings are stored in the browser's
IndexedDB on that device. They are not uploaded to a server. On iPhone or
iPad, consider installing the app with **Safari → Share → Add to Home Screen**,
requesting persistent storage in Settings, and exporting periodic full media
backups.

### Updating an existing mined source

You can return to the desktop project, mine more sentences, and export again:

```bash
shadowmine mine "projects/VIDEO_ID"
shadowmine export "projects/VIDEO_ID"
shadowmine validate "projects/VIDEO_ID/VIDEO_ID.shadowing.zip"
```

Transfer the new package and choose **Refresh source** in the Library. Existing
practice attempts are retained when their sentence IDs are still present.
Removing or manually changing sentence IDs in `sentences.json` can prevent
that association, so normally let `shadowmine` manage the IDs.

## Project directory

Unless `--projects` is supplied, `fetch` and URL-based `subtitles` commands use
a `projects/` directory under the current working directory:

```text
projects/<videoId>/
├── source.json          # source title, channel, URL, duration, and video ID
├── source_audio.m4a     # downloaded source audio
├── subtitles/           # downloaded WebVTT subtitle tracks
├── sentences.json       # selected sentences and clip metadata
├── clips/               # short AAC/M4A reference clips
└── <videoId>.shadowing.zip
```

Project commands accept either the project directory or, where documented,
its `source.json` file. Using the explicit project directory is the clearest
option.

To keep projects somewhere else:

```bash
shadowmine fetch "$URL" --projects "/path/to/shadowing-projects"
shadowmine subtitles "/path/to/shadowing-projects/VIDEO_ID"
shadowmine mine "/path/to/shadowing-projects/VIDEO_ID"
```

## Commands

### `shadowmine create <url>`

Runs the recommended guided workflow from a YouTube URL to a validated
package:

```bash
shadowmine create "https://www.youtube.com/watch?v=VIDEO_ID"
```

The first two stages are automatic. The mining stage remains interactive
because automatic captions can contain transcription errors and not every
subtitle line makes useful practice material. Press Enter through the three
prompts to use the normal defaults: `keep`, matched English (or blank when
unavailable), and save. Choose `edit`, `skip`, `prev`, or `quit` when you want
different behavior. When you leave the miner, `create` exports and validates
all sentences currently saved in the project.

Use `-y` or `--yes` to skip the interactive review and mine every cleaned cue:

```bash
shadowmine create "$URL" -y
```

This is convenient for trusted subtitle tracks, but automatic captions can
still contain transcription errors or awkward sentence boundaries. Running
the command again is safe for an existing project: cues with the same original
subtitle timestamps are skipped instead of duplicated.

Kana readings are generated by default. Disable them with `--no-kana` if you
prefer bare Japanese text:

```bash
shadowmine create "$URL" -y --no-kana
```

Audio and subtitle downloads are cached on disk. A second `create` for the same
video reuses them and only re-runs local mining/export work. Force fresh
downloads with `--refresh`:

```bash
shadowmine create "$URL" -y --refresh
```

If you quit without saving any sentences and the project has no previously
saved sentences, the command stops without creating an empty package.

Options:

```bash
# Store the working project outside the current directory.
shadowmine create "$URL" --projects "/path/to/projects"

# Write the final package to a specific location.
shadowmine create "$URL" --output "/path/to/lesson.shadowing.zip"

# Set both.
shadowmine create "$URL" \
  --projects "/path/to/projects" \
  --output "/path/to/lesson.shadowing.zip"
```

### `shadowmine doctor`

Checks the local runtime and prints OS-specific dependency guidance.

```bash
shadowmine doctor
```

### `shadowmine inspect <url>`

Reads source metadata through the yt-dlp Python API without downloading audio.
It prints the video ID, title, channel, duration, and canonical URL.

```bash
shadowmine inspect "https://www.youtube.com/watch?v=VIDEO_ID"
```

Use this first to confirm that yt-dlp can access the source.

### `shadowmine fetch <url>`

Creates a project and downloads the best available audio. FFmpeg converts the
result to M4A when needed.

```bash
shadowmine fetch "https://www.youtube.com/watch?v=VIDEO_ID"
shadowmine fetch "$URL" --projects "/path/to/projects"
```

If `source.json` and a usable `source_audio.*` already exist for that video ID,
`fetch` reuses them and skips the YouTube download. Pass `--refresh` to force a
new download and overwrite the cached audio.

### `shadowmine subtitles <url|project>`

Downloads Japanese manual or automatic subtitles as WebVTT. The command
parses the selected track and reports the resulting cue count after
conservative rolling-caption deduplication.

For the normal workflow, pass the project created by `fetch`:

```bash
shadowmine subtitles "projects/VIDEO_ID"
```

You may pass a URL instead:

```bash
shadowmine subtitles "$URL"
```

URL mode creates source metadata and subtitle files but does not download
source audio. Run `fetch` before `mine` or `clip`, because those commands need
`source_audio.m4a`.

When usable Japanese VTT files are already under `subtitles/`, the command
reuses them. Pass `--refresh` to download again.

If usable `.vtt` files already exist under `subtitles/` and parse into Japanese
cues, the download is skipped. Pass `--refresh` to fetch them again.

Automatic captions are marked as auto-generated and are never treated as
verified text. Review and correct them before relying on them.

The default subtitle download also requests English tracks. If one is
available, its cues are aligned to Japanese cues by timestamp overlap and used
as optional English glosses. English availability and quality depend on the
source.

### `shadowmine mine <project>`

Starts a line-oriented subtitle browser:

```bash
shadowmine mine "projects/VIDEO_ID"
```

For each cue, the CLI shows its timestamps, caption type, and Japanese text.
The fastest normal path is to press Enter three times:

1. **Action:** `keep`
2. **English:** matched subtitle text, or blank when unavailable
3. **Clip and save:** yes

Type a different response only when needed. Available actions are:

- `keep` — save the cue text as shown.
- `edit` — correct the Japanese text before saving.
- `skip` — move to the next cue without saving.
- `prev` — return to the previous cue.
- `quit` — stop and keep everything already saved.

For `keep` and `edit`, you can add an optional English gloss and confirm the
clip. Each saved cue is appended to `sentences.json` and written to `clips/`.
When the reading engine is available, a hiragana reading is stored alongside
the Japanese text and shown after each save.

By default, clips receive 150 ms of leading padding, 250 ms of trailing
padding, and short fades. A cue kept directly from automatic captions remains
labeled `auto-caption`; editing it labels it `manually-corrected`.

To accept every cleaned cue without prompts:

```bash
shadowmine mine "projects/VIDEO_ID" -y
```

Bulk mining uses aligned English subtitles when available, generates kana
readings by default, and skips cues that were already saved from the same
original timestamps. Pass `--no-kana` to omit readings.

Sentences saved before kana support get readings backfilled automatically the
next time you run `mine` or `create` on the project, so re-running `mine -y`
followed by `export` upgrades an existing project without re-clipping audio.

### `shadowmine clip`

Creates one clip noninteractively. Times are seconds on the original source
clock.

```bash
shadowmine clip \
  --project "projects/VIDEO_ID" \
  --start 83.42 \
  --end 85.81 \
  --japanese "今日はどこへ行くんですか。" \
  --english "Where are you going today?" \
  --tag question \
  --tag conversation
```

A hiragana reading is generated automatically from the Japanese text. Pass
`--reading` to override it, or `--no-kana` to leave the reading blank:

```bash
shadowmine clip \
  --project "projects/VIDEO_ID" \
  --start 83.42 \
  --end 85.81 \
  --japanese "今日はどこへ行くんですか。" \
  --reading "きょうはどこへいくんですか。"
```

Adjust padding when a subtitle boundary cuts off speech or captures too much
silence:

```bash
shadowmine clip \
  --project "projects/VIDEO_ID" \
  --start 83.42 \
  --end 85.81 \
  --start-pad-ms 250 \
  --end-pad-ms 400 \
  --japanese "今日はどこへ行くんですか。"
```

The stored metadata keeps the original subtitle boundaries and the final
adjusted clip boundaries.

### `shadowmine export <project>`

Packages the project after at least one sentence has been clipped:

```bash
shadowmine export "projects/VIDEO_ID"
```

The default output is:

```text
projects/VIDEO_ID/VIDEO_ID.shadowing.zip
```

Choose another output location with `--output` or `-o`:

```bash
shadowmine export "projects/VIDEO_ID" \
  --output "/path/to/my-lesson.shadowing.zip"
```

The archive uses `japanese-shadowing-package` version 1 and contains:

```text
manifest.json
source.json
sentences.json
audio/sentence-001.m4a
subtitles/<track>.vtt     # when available
```

The export is checked against the shared JSON Schema before it is written.

### `shadowmine validate <package>`

Checks the package version, JSON Schema, ZIP path safety, timestamps, and
referenced audio files:

```bash
shadowmine validate "projects/VIDEO_ID/VIDEO_ID.shadowing.zip"
```

A successful validation prints the source title, sentence count, format, and
version. Run this before transferring a package when you have manually edited
project JSON.

## Updating yt-dlp

YouTube changes frequently. If inspection or downloads begin failing, update
yt-dlp in the active virtual environment:

```bash
python -m pip install --upgrade yt-dlp
```

An authentication, age-wall, DRM, or permissions error is not something
`shadowmine` attempts to bypass.

## Troubleshooting

### `shadowmine: command not found`

Activate the virtual environment and reinstall from `cli/`:

```bash
source .venv/bin/activate
python -m pip install -e .
```

### FFmpeg or FFprobe is missing

Install FFmpeg for your OS, open a new terminal, and run:

```bash
shadowmine doctor
ffmpeg -version
ffprobe -version
```

### No subtitle cues were found

The source may not have Japanese subtitles, yt-dlp may have selected a
different language, or YouTube may have changed its subtitle response. Inspect
the project's `subtitles/` directory and retry `shadowmine subtitles`.

### `mine` reports that source audio is missing

Running `subtitles` with a URL does not fetch audio. Run:

```bash
shadowmine fetch "$URL"
shadowmine mine "projects/VIDEO_ID"
```

### Automatic captions look repetitive

The parser conservatively collapses rolling captions, but automatic captions
can still be noisy or incorrectly segmented. Use `edit` in the mining loop and
listen to each exported reference clip in the web app.

## Development

Install test dependencies and run the suite:

```bash
python -m pip install -e ".[dev]"
pytest
```

Media round-trip tests require FFmpeg and FFprobe. Schema tests resolve the
repository root from their own file location and do not depend on a particular
checkout path.
