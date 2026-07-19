from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from shadowmine.models import ProjectSource
from shadowmine.project import ensure_project_dirs, save_source, source_audio_path


YOUTUBE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
# Tiny/corrupt leftovers should not count as a reusable cache hit.
_MIN_CACHED_AUDIO_BYTES = 1024


@dataclass(frozen=True)
class FetchResult:
    project_dir: Path
    reused: bool


@dataclass(frozen=True)
class SubtitleResult:
    paths: list[Path]
    reused: bool


def extract_video_id(url_or_id: str) -> str | None:
    value = url_or_id.strip()
    if YOUTUBE_ID_RE.fullmatch(value):
        return value
    # Common patterns without full URL parsing failures
    patterns = [
        r"(?:v=|/embed/|/shorts/|/live/|youtu\.be/)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, value)
        if match:
            return match.group(1)
    return None


def _ydl(opts: dict[str, Any] | None = None):
    from yt_dlp import YoutubeDL

    base = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
    }
    if opts:
        base.update(opts)
    return YoutubeDL(base)


def inspect_url(url: str) -> dict[str, Any]:
    with _ydl({"skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False)
        return ydl.sanitize_info(info)


def info_to_source(info: dict[str, Any]) -> ProjectSource:
    video_id = str(info.get("id") or "")
    if not video_id:
        raise ValueError("yt-dlp info dict is missing id")
    duration = info.get("duration")
    duration_ms = int(float(duration) * 1000) if duration is not None else None
    return ProjectSource(
        id=f"source-{video_id}",
        type="youtube",
        url=str(info.get("webpage_url") or info.get("original_url") or f"https://www.youtube.com/watch?v={video_id}"),
        videoId=video_id,
        title=str(info.get("title") or video_id),
        channel=info.get("channel") or info.get("uploader"),
        durationMs=duration_ms,
        webpageUrl=info.get("webpage_url"),
    )


def find_cached_source_audio(project_dir: Path) -> Path | None:
    try:
        path = source_audio_path(project_dir)
    except FileNotFoundError:
        return None
    if path.stat().st_size < _MIN_CACHED_AUDIO_BYTES:
        return None
    return path


def _subtitle_vtt_paths(project_dir: Path) -> list[Path]:
    return sorted((project_dir / "subtitles").glob("*.vtt"))


def cached_subtitles_usable(project_dir: Path) -> bool:
    """True when on-disk subtitle files already yield Japanese mining cues."""
    if not _subtitle_vtt_paths(project_dir):
        return False
    from shadowmine.subtitles import load_project_cues

    return bool(load_project_cues(project_dir))


def fetch_audio(
    url: str, projects_root: Path, *, refresh: bool = False
) -> FetchResult:
    """Download source audio, or reuse a valid on-disk copy unless refresh=True."""
    projects_root.mkdir(parents=True, exist_ok=True)

    video_id = extract_video_id(url)
    if video_id and not refresh:
        project_dir = projects_root / video_id
        if (project_dir / "source.json").exists() and find_cached_source_audio(project_dir):
            return FetchResult(project_dir=project_dir, reused=True)

    info = inspect_url(url)
    source = info_to_source(info)
    project_dir = projects_root / source.videoId
    ensure_project_dirs(project_dir)
    save_source(project_dir, source)

    if not refresh and find_cached_source_audio(project_dir):
        return FetchResult(project_dir=project_dir, reused=True)

    outtmpl = str(project_dir / "source_audio.%(ext)s")
    opts = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "m4a",
                "preferredquality": "192",
            }
        ],
        "overwrites": True,
    }
    with _ydl(opts) as ydl:
        ydl.download([url])

    audio = project_dir / "source_audio.m4a"
    if not audio.exists():
        # Fallback: whatever extension yt-dlp left
        matches = sorted(project_dir.glob("source_audio.*"))
        if not matches:
            raise FileNotFoundError("Download finished but source_audio.* was not created")
        audio = matches[0]
    return FetchResult(project_dir=project_dir, reused=False)


def download_subtitles(
    url: str,
    project_dir: Path,
    langs: list[str] | None = None,
    *,
    refresh: bool = False,
) -> SubtitleResult:
    ensure_project_dirs(project_dir)
    if not refresh and cached_subtitles_usable(project_dir):
        return SubtitleResult(paths=_subtitle_vtt_paths(project_dir), reused=True)

    # Fetch Japanese for mining and English for an optional timestamp-aligned
    # gloss. Missing tracks are allowed; yt-dlp writes whichever are available.
    languages = langs or ["ja", "ja-orig", "en", "en-orig"]
    opts = {
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": languages,
        "subtitlesformat": "vtt",
        "outtmpl": str(project_dir / "subtitles" / "%(id)s.%(ext)s"),
        "overwrites": True,
    }
    with _ydl(opts) as ydl:
        ydl.download([url])

    written = _subtitle_vtt_paths(project_dir)
    return SubtitleResult(paths=written, reused=False)
