from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path

from shadowmine.constants import DEFAULT_END_PAD_MS, DEFAULT_FADE_MS, DEFAULT_START_PAD_MS
from shadowmine.models import ProjectSentence
from shadowmine.project import (
    ensure_project_dirs,
    load_sentences,
    save_sentences,
    source_audio_path,
)
from shadowmine.readings import generate_reading


def probe_duration_ms(path: Path) -> int:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    duration = float(payload["format"]["duration"])
    return max(1, int(round(duration * 1000)))


def compute_boundaries(
    start_ms: int,
    end_ms: int,
    *,
    start_pad_ms: int = DEFAULT_START_PAD_MS,
    end_pad_ms: int = DEFAULT_END_PAD_MS,
    media_duration_ms: int | None = None,
) -> tuple[int, int, int, int]:
    if end_ms <= start_ms:
        raise ValueError("end must be after start")
    adjusted_start = max(0, start_ms - start_pad_ms)
    adjusted_end = end_ms + end_pad_ms
    if media_duration_ms is not None:
        adjusted_end = min(adjusted_end, media_duration_ms)
    if adjusted_end <= adjusted_start:
        raise ValueError("adjusted clip range is empty")
    return start_ms, end_ms, adjusted_start, adjusted_end


def clip_audio(
    source_path: Path,
    output_path: Path,
    *,
    start_ms: int,
    end_ms: int,
    fade_ms: int = DEFAULT_FADE_MS,
) -> int:
    duration_ms = end_ms - start_ms
    if duration_ms <= 0:
        raise ValueError("clip duration must be positive")
    start_s = start_ms / 1000
    duration_s = duration_ms / 1000
    fade_s = min(fade_ms / 1000, duration_s / 4) if fade_ms > 0 else 0
    af_parts: list[str] = []
    if fade_s > 0:
        af_parts.append(f"afade=t=in:st=0:d={fade_s:.3f}")
        af_parts.append(f"afade=t=out:st={max(0.0, duration_s - fade_s):.3f}:d={fade_s:.3f}")
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_s:.3f}",
        "-t",
        f"{duration_s:.3f}",
        "-i",
        str(source_path),
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
    ]
    if af_parts:
        command.extend(["-af", ",".join(af_parts)])
    command.append(str(output_path))
    subprocess.run(command, check=True, capture_output=True, text=True)
    return probe_duration_ms(output_path)


def add_clip(
    project_dir: Path,
    *,
    start_seconds: float,
    end_seconds: float,
    japanese: str,
    english: str | None = None,
    reading: str | None = None,
    generate_kana: bool = True,
    tags: list[str] | None = None,
    start_pad_ms: int = DEFAULT_START_PAD_MS,
    end_pad_ms: int = DEFAULT_END_PAD_MS,
    transcript_status: str = "manually-corrected",
) -> ProjectSentence:
    if reading is None and generate_kana:
        reading = generate_reading(japanese)
    ensure_project_dirs(project_dir)
    source_path = source_audio_path(project_dir)
    media_duration_ms = probe_duration_ms(source_path)
    start_ms = int(round(start_seconds * 1000))
    end_ms = int(round(end_seconds * 1000))
    subtitle_start, subtitle_end, adjusted_start, adjusted_end = compute_boundaries(
        start_ms,
        end_ms,
        start_pad_ms=start_pad_ms,
        end_pad_ms=end_pad_ms,
        media_duration_ms=media_duration_ms,
    )
    sentences = load_sentences(project_dir)
    sentence_id = f"sentence-{len(sentences) + 1:03d}-{uuid.uuid4().hex[:6]}"
    clip_name = f"{sentence_id}.m4a"
    clip_path = project_dir / "clips" / clip_name
    duration_ms = clip_audio(
        source_path,
        clip_path,
        start_ms=adjusted_start,
        end_ms=adjusted_end,
    )
    sentence = ProjectSentence(
        id=sentence_id,
        japanese=japanese,
        english=english,
        reading=reading,
        startMs=adjusted_start,
        endMs=adjusted_end,
        subtitleStartMs=subtitle_start,
        subtitleEndMs=subtitle_end,
        adjustedStartMs=adjusted_start,
        adjustedEndMs=adjusted_end,
        tags=tags or [],
        transcriptStatus=transcript_status,  # type: ignore[arg-type]
        clipPath=f"clips/{clip_name}",
        audioDurationMs=duration_ms,
        mimeType="audio/mp4",
    )
    sentences.append(sentence)
    save_sentences(project_dir, sentences)
    return sentence
