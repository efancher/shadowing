from __future__ import annotations

import platform
import shutil
import sys
from dataclasses import dataclass

from rich.console import Console


@dataclass(frozen=True)
class DependencyReport:
    python_ok: bool
    ffmpeg_ok: bool
    ffprobe_ok: bool
    ytdlp_ok: bool
    python_version: str
    messages: list[str]

    @property
    def ok(self) -> bool:
        return self.python_ok and self.ffmpeg_ok and self.ffprobe_ok and self.ytdlp_ok


def _install_hint(tool: str) -> str:
    system = platform.system().lower()
    if tool in {"ffmpeg", "ffprobe"}:
        if system == "darwin":
            return "Install with Homebrew: brew install ffmpeg"
        if system == "windows":
            return "Install with winget: winget install Gyan.FFmpeg (or scoop install ffmpeg)"
        return "Install with apt: sudo apt install ffmpeg"
    if tool == "yt-dlp":
        return "Install Python deps: pip install -e . (from the cli/ directory)"
    if tool == "python":
        return "Install Python 3.11 or newer from https://www.python.org/downloads/"
    return f"Install {tool}"


def check_dependencies() -> DependencyReport:
    messages: list[str] = []
    python_ok = sys.version_info >= (3, 11)
    if not python_ok:
        messages.append(f"Python 3.11+ required (found {sys.version.split()[0]}). {_install_hint('python')}")

    ffmpeg_ok = shutil.which("ffmpeg") is not None
    if not ffmpeg_ok:
        messages.append(f"ffmpeg not found on PATH. {_install_hint('ffmpeg')}")

    ffprobe_ok = shutil.which("ffprobe") is not None
    if not ffprobe_ok:
        messages.append(f"ffprobe not found on PATH. {_install_hint('ffprobe')}")

    try:
        import yt_dlp  # noqa: F401

        ytdlp_ok = True
    except ImportError:
        ytdlp_ok = False
        messages.append(f"yt-dlp Python package missing. {_install_hint('yt-dlp')}")

    return DependencyReport(
        python_ok=python_ok,
        ffmpeg_ok=ffmpeg_ok,
        ffprobe_ok=ffprobe_ok,
        ytdlp_ok=ytdlp_ok,
        python_version=".".join(str(part) for part in sys.version_info[:3]),
        messages=messages,
    )


def require_dependencies(console: Console | None = None) -> None:
    report = check_dependencies()
    out = console or Console(stderr=True)
    if report.ok:
        return
    out.print("[bold red]Missing dependencies[/bold red]")
    for message in report.messages:
        out.print(f"• {message}")
    raise SystemExit(1)
