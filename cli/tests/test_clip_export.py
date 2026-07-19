from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import pytest

from shadowmine.clip import add_clip, compute_boundaries
from shadowmine.export_pkg import export_project, validate_package
from shadowmine.models import ProjectSource
from shadowmine.project import ensure_project_dirs, save_source
from shadowmine.youtube import extract_video_id, info_to_source


def test_compute_boundaries_pads() -> None:
    start, end, adjusted_start, adjusted_end = compute_boundaries(1000, 2000)
    assert start == 1000
    assert end == 2000
    assert adjusted_start == 850
    assert adjusted_end == 2250


def test_extract_video_id() -> None:
    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_info_to_source_from_dict() -> None:
    source = info_to_source(
        {
            "id": "dQw4w9WgXcQ",
            "title": "Example",
            "channel": "Channel",
            "duration": 120.5,
            "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }
    )
    assert source.videoId == "dQw4w9WgXcQ"
    assert source.durationMs == 120500


def _write_silent_wav(path: Path, seconds: float = 3.0, sample_rate: int = 16000) -> None:
    n = int(seconds * sample_rate)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * n)


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True)
        subprocess.run(["ffprobe", "-version"], check=True, capture_output=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg/ffprobe required")
def test_clip_export_validate_roundtrip(tmp_path: Path) -> None:
    project = tmp_path / "vid123"
    ensure_project_dirs(project)
    save_source(
        project,
        ProjectSource(
            id="source-vid123",
            type="youtube",
            url="https://www.youtube.com/watch?v=vid12345678",
            videoId="vid12345678",
            title="Fixture Video",
            channel="Fixture Channel",
            durationMs=3000,
        ),
    )
    wav = project / "source_audio.wav"
    _write_silent_wav(wav, seconds=3.0)
    # convert to m4a for realistic path
    m4a = project / "source_audio.m4a"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav), "-c:a", "aac", "-b:a", "128k", str(m4a)],
        check=True,
        capture_output=True,
    )
    wav.unlink()

    sentence = add_clip(
        project,
        start_seconds=1.0,
        end_seconds=2.0,
        japanese="テストです。",
        english="It is a test.",
        tags=["fixture"],
    )
    assert sentence.adjustedStartMs == 850
    assert sentence.adjustedEndMs == 2250
    assert (project / sentence.clipPath).exists()

    package = export_project(project, tmp_path / "out.shadowing.zip")
    document = validate_package(package)
    assert document["manifest"]["format"] == "japanese-shadowing-package"
    assert document["sentences"][0]["japanese"] == "テストです。"
    assert Path(document["sentences"][0]["audio"]["path"]).as_posix().startswith("audio/")
