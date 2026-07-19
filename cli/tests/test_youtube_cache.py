from __future__ import annotations

from pathlib import Path

import shadowmine.youtube as youtube_module
from shadowmine.models import ProjectSource
from shadowmine.project import ensure_project_dirs, save_source
from shadowmine.youtube import (
    download_subtitles,
    fetch_audio,
    find_cached_source_audio,
)


def _write_source(project_dir: Path, video_id: str = "video123456") -> ProjectSource:
    ensure_project_dirs(project_dir)
    source = ProjectSource(
        id=f"source-{video_id}",
        url=f"https://www.youtube.com/watch?v={video_id}",
        videoId=video_id,
        title="Fixture video",
    )
    save_source(project_dir, source)
    return source


def test_find_cached_source_audio_rejects_tiny_files(tmp_path: Path) -> None:
    project_dir = tmp_path / "video123456"
    ensure_project_dirs(project_dir)
    tiny = project_dir / "source_audio.m4a"
    tiny.write_bytes(b"x" * 32)
    assert find_cached_source_audio(project_dir) is None

    usable = project_dir / "source_audio.m4a"
    usable.write_bytes(b"x" * 2048)
    assert find_cached_source_audio(project_dir) == usable


def test_fetch_audio_reuses_cached_file_without_network(monkeypatch, tmp_path: Path) -> None:
    video_id = "video123456"
    project_dir = tmp_path / video_id
    _write_source(project_dir, video_id)
    (project_dir / "source_audio.m4a").write_bytes(b"x" * 2048)

    def fail_inspect(url: str) -> dict:
        raise AssertionError("inspect_url should not run on cache hit")

    monkeypatch.setattr(youtube_module, "inspect_url", fail_inspect)
    monkeypatch.setattr(
        youtube_module,
        "_ydl",
        lambda opts=None: (_ for _ in ()).throw(AssertionError("yt-dlp should not run")),
    )

    result = fetch_audio(
        f"https://www.youtube.com/watch?v={video_id}",
        tmp_path,
    )

    assert result.reused is True
    assert result.project_dir == project_dir


def test_fetch_audio_refresh_redownloads(monkeypatch, tmp_path: Path) -> None:
    video_id = "video123456"
    project_dir = tmp_path / video_id
    source = _write_source(project_dir, video_id)
    (project_dir / "source_audio.m4a").write_bytes(b"x" * 2048)
    calls: list[str] = []

    monkeypatch.setattr(
        youtube_module,
        "inspect_url",
        lambda url: {
            "id": video_id,
            "title": source.title,
            "webpage_url": source.url,
            "duration": 10,
        },
    )

    class FakeYdl:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def download(self, urls):
            calls.append("download")
            (project_dir / "source_audio.m4a").write_bytes(b"y" * 2048)

    monkeypatch.setattr(youtube_module, "_ydl", lambda opts=None: FakeYdl())

    result = fetch_audio(source.url, tmp_path, refresh=True)

    assert result.reused is False
    assert calls == ["download"]
    assert (project_dir / "source_audio.m4a").read_bytes().startswith(b"y")


def test_download_subtitles_reuses_cached_vtt(monkeypatch, tmp_path: Path) -> None:
    project_dir = tmp_path / "video123456"
    source = _write_source(project_dir)
    vtt = project_dir / "subtitles" / "video123456.ja.vtt"
    vtt.write_text(
        """WEBVTT

00:00:01.000 --> 00:00:02.000
こんにちは
""",
        encoding="utf-8",
    )

    monkeypatch.setattr(
        youtube_module,
        "_ydl",
        lambda opts=None: (_ for _ in ()).throw(AssertionError("yt-dlp should not run")),
    )

    result = download_subtitles(source.url, project_dir)

    assert result.reused is True
    assert result.paths == [vtt]


def test_download_subtitles_refresh_redownloads(monkeypatch, tmp_path: Path) -> None:
    project_dir = tmp_path / "video123456"
    source = _write_source(project_dir)
    vtt = project_dir / "subtitles" / "video123456.ja.vtt"
    vtt.write_text(
        """WEBVTT

00:00:01.000 --> 00:00:02.000
こんにちは
""",
        encoding="utf-8",
    )
    calls: list[str] = []

    class FakeYdl:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def download(self, urls):
            calls.append("download")
            vtt.write_text(
                """WEBVTT

00:00:01.000 --> 00:00:02.500
更新された字幕
""",
                encoding="utf-8",
            )

    monkeypatch.setattr(youtube_module, "_ydl", lambda opts=None: FakeYdl())

    result = download_subtitles(source.url, project_dir, refresh=True)

    assert result.reused is False
    assert calls == ["download"]
    assert "更新" in vtt.read_text(encoding="utf-8")
