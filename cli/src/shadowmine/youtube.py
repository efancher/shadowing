from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from shadowmine.models import ProjectSource
from shadowmine.project import ensure_project_dirs, save_source


YOUTUBE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")


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


def fetch_audio(url: str, projects_root: Path) -> Path:
    projects_root.mkdir(parents=True, exist_ok=True)
    info = inspect_url(url)
    source = info_to_source(info)
    project_dir = projects_root / source.videoId
    ensure_project_dirs(project_dir)
    save_source(project_dir, source)

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
    return project_dir


def download_subtitles(url: str, project_dir: Path, langs: list[str] | None = None) -> list[Path]:
    ensure_project_dirs(project_dir)
    languages = langs or ["ja", "ja-orig"]
    opts = {
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": languages,
        "subtitlesformat": "vtt",
        "outtmpl": str(project_dir / "subtitles" / "%(id)s.%(ext)s"),
    }
    with _ydl(opts) as ydl:
        ydl.download([url])

    # Normalize filenames into subtitles/
    written = sorted((project_dir / "subtitles").glob("*.vtt"))
    return written
