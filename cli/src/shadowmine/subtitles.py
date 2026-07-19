from __future__ import annotations

import re
from pathlib import Path

from shadowmine.models import Cue

TIMESTAMP_RE = re.compile(
    r"(?P<h>\d{1,2}):(?P<m>\d{2}):(?P<s>\d{2})[.,](?P<ms>\d{1,3})"
)
ARROW_RE = re.compile(r"\s-->\s")


def _timestamp_to_ms(value: str) -> int:
    match = TIMESTAMP_RE.fullmatch(value.strip())
    if not match:
        raise ValueError(f"Invalid timestamp: {value}")
    hours = int(match.group("h"))
    minutes = int(match.group("m"))
    seconds = int(match.group("s"))
    ms = int(match.group("ms").ljust(3, "0")[:3])
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms


def _clean_text(text: str) -> str:
    # Strip simple WebVTT tags
    cleaned = re.sub(r"<[^>]+>", "", text)
    cleaned = cleaned.replace("&nbsp;", " ").replace("&amp;", "&")
    return " ".join(cleaned.split()).strip()


def parse_webvtt(content: str, *, is_auto: bool = False) -> list[Cue]:
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cues: list[Cue] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line or line.startswith("WEBVTT") or line.startswith("NOTE") or line.startswith("STYLE"):
            continue
        if "-->" not in line:
            # optional cue identifier
            if i < len(lines) and "-->" in lines[i]:
                line = lines[i].strip()
                i += 1
            else:
                continue
        parts = ARROW_RE.split(line)
        if len(parts) < 2:
            continue
        start_raw = parts[0].split()[0]
        end_raw = parts[1].split()[0]
        text_lines: list[str] = []
        while i < len(lines) and lines[i].strip():
            text_lines.append(lines[i])
            i += 1
        text = _clean_text("\n".join(text_lines))
        if not text:
            continue
        cues.append(
            Cue(
                index=len(cues),
                startMs=_timestamp_to_ms(start_raw),
                endMs=_timestamp_to_ms(end_raw),
                text=text,
                isAuto=is_auto,
            )
        )
    return cues


def parse_srt(content: str, *, is_auto: bool = False) -> list[Cue]:
    blocks = re.split(r"\n\s*\n", content.replace("\r\n", "\n").replace("\r", "\n").strip())
    cues: list[Cue] = []
    for block in blocks:
        lines = [line for line in block.split("\n") if line.strip() != ""]
        if len(lines) < 2:
            continue
        timing_line = lines[0] if "-->" in lines[0] else lines[1]
        if "-->" not in timing_line:
            continue
        start_raw, end_raw = [part.strip() for part in timing_line.split("-->")]
        end_raw = end_raw.split()[0]
        text_lines = lines[1:] if "-->" in lines[0] else lines[2:]
        text = _clean_text("\n".join(text_lines))
        if not text:
            continue
        cues.append(
            Cue(
                index=len(cues),
                startMs=_timestamp_to_ms(start_raw.replace(",", ".")),
                endMs=_timestamp_to_ms(end_raw.replace(",", ".")),
                text=text,
                isAuto=is_auto,
            )
        )
    return cues


def parse_subtitle_file(path: Path) -> list[Cue]:
    content = path.read_text(encoding="utf-8", errors="replace")
    name = path.name.lower()
    is_auto = "auto" in name or ".ja.vtt" in name and "orig" not in name
    # yt-dlp auto files often look like id.ja.vtt vs id.ja-orig.vtt; treat non-orig as auto when both exist.
    if name.endswith(".srt"):
        return parse_srt(content, is_auto=is_auto)
    return parse_webvtt(content, is_auto=is_auto)


def dedupe_rolling_captions(cues: list[Cue]) -> list[Cue]:
    """Conservative dedup for auto captions that grow by appending tokens."""
    if not cues:
        return []
    result: list[Cue] = []
    for cue in cues:
        if not result:
            result.append(cue)
            continue
        previous = result[-1]
        prev_text = previous.text
        curr_text = cue.text
        # Same text with overlapping/adjacent timing → keep later end
        if curr_text == prev_text:
            result[-1] = previous.model_copy(update={"endMs": max(previous.endMs, cue.endMs)})
            continue
        # Rolling growth: current starts with previous text
        if curr_text.startswith(prev_text) and len(curr_text) > len(prev_text):
            # Replace previous with expanded cue, preserving earliest start
            result[-1] = cue.model_copy(update={"startMs": previous.startMs, "index": previous.index})
            continue
        # Previous was a prefix fragment that ended when next full line arrived
        if prev_text and curr_text.startswith(prev_text[: max(1, len(prev_text) // 2)]) and cue.startMs <= previous.endMs + 500:
            # Prefer longer stable line
            if len(curr_text) >= len(prev_text):
                result[-1] = cue.model_copy(update={"startMs": min(previous.startMs, cue.startMs), "index": previous.index})
                continue
        result.append(cue.model_copy(update={"index": len(result)}))
    # Reindex
    return [cue.model_copy(update={"index": index}) for index, cue in enumerate(result)]


def load_project_cues(project_dir: Path) -> list[Cue]:
    subtitle_dir = project_dir / "subtitles"
    if not subtitle_dir.exists():
        return []
    files = sorted(subtitle_dir.glob("*.vtt")) + sorted(subtitle_dir.glob("*.srt"))
    if not files:
        return []
    # Prefer non-auto / orig tracks when present
    preferred = [path for path in files if "orig" in path.name.lower() or "manual" in path.name.lower()]
    chosen = preferred[0] if preferred else files[0]
    cues = parse_subtitle_file(chosen)
    if chosen.name.lower().find("orig") == -1:
        cues = [cue.model_copy(update={"isAuto": True}) for cue in cues]
        cues = dedupe_rolling_captions(cues)
    return cues
