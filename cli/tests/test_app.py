from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

import shadowmine.app as app_module
from shadowmine.models import Cue, ProjectSource


runner = CliRunner()


def test_create_runs_guided_workflow(monkeypatch, tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "video123456"
    package_path = project_dir / "video123456.shadowing.zip"
    source = ProjectSource(
        id="source-video123456",
        url="https://www.youtube.com/watch?v=video123456",
        videoId="video123456",
        title="Fixture video",
    )
    calls: list[str] = []

    monkeypatch.setattr(app_module, "require_dependencies", lambda console: calls.append("deps"))
    monkeypatch.setattr(
        app_module,
        "fetch_audio",
        lambda url, projects: calls.append("fetch") or project_dir,
    )
    monkeypatch.setattr(app_module, "load_source", lambda project: source)
    monkeypatch.setattr(
        app_module,
        "download_subtitles",
        lambda url, project: calls.append("subtitles"),
    )
    monkeypatch.setattr(
        app_module,
        "load_project_cues",
        lambda project: [Cue(index=0, startMs=1000, endMs=2000, text="こんにちは", isAuto=True)],
    )
    monkeypatch.setattr(
        app_module,
        "run_mine_loop",
        lambda project, console, **kwargs: calls.append("mine") or 0,
    )
    monkeypatch.setattr(app_module, "load_sentences", lambda project: [object()])
    monkeypatch.setattr(
        app_module,
        "export_project",
        lambda project, output: calls.append("export") or package_path,
    )
    monkeypatch.setattr(
        app_module,
        "validate_package",
        lambda package: calls.append("validate")
        or {"source": {"title": "Fixture video"}, "sentences": [{}]},
    )

    result = runner.invoke(
        app_module.app,
        [
            "create",
            source.url,
            "--projects",
            str(tmp_path / "projects"),
        ],
    )

    assert result.exit_code == 0, result.output
    assert calls == ["deps", "fetch", "subtitles", "mine", "export", "validate"]
    assert "[1/5]" in result.output
    assert "[5/5]" in result.output
    assert "Done." in result.output
    assert "Import" in result.output
    assert "package" in result.output


def test_create_does_not_export_when_nothing_was_saved(monkeypatch, tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "video123456"
    source = ProjectSource(
        id="source-video123456",
        url="https://www.youtube.com/watch?v=video123456",
        videoId="video123456",
        title="Fixture video",
    )

    monkeypatch.setattr(app_module, "require_dependencies", lambda console: None)
    monkeypatch.setattr(app_module, "fetch_audio", lambda url, projects: project_dir)
    monkeypatch.setattr(app_module, "load_source", lambda project: source)
    monkeypatch.setattr(app_module, "download_subtitles", lambda url, project: None)
    monkeypatch.setattr(
        app_module,
        "load_project_cues",
        lambda project: [Cue(index=0, startMs=1000, endMs=2000, text="こんにちは")],
    )
    monkeypatch.setattr(app_module, "run_mine_loop", lambda project, console, **kwargs: 0)
    monkeypatch.setattr(app_module, "load_sentences", lambda project: [])

    result = runner.invoke(app_module.app, ["create", source.url])

    assert result.exit_code == 1
    assert "No sentences were saved" in result.output


def test_create_yes_mines_every_cue_without_interactive_loop(
    monkeypatch,
    tmp_path: Path,
) -> None:
    project_dir = tmp_path / "projects" / "video123456"
    package_path = project_dir / "video123456.shadowing.zip"
    source = ProjectSource(
        id="source-video123456",
        url="https://www.youtube.com/watch?v=video123456",
        videoId="video123456",
        title="Fixture video",
    )
    calls: list[str] = []

    monkeypatch.setattr(app_module, "require_dependencies", lambda console: None)
    monkeypatch.setattr(app_module, "fetch_audio", lambda url, projects: project_dir)
    monkeypatch.setattr(app_module, "load_source", lambda project: source)
    monkeypatch.setattr(app_module, "download_subtitles", lambda url, project: None)
    monkeypatch.setattr(
        app_module,
        "load_project_cues",
        lambda project: [Cue(index=0, startMs=1000, endMs=2000, text="こんにちは")],
    )
    monkeypatch.setattr(
        app_module,
        "mine_all_cues",
        lambda project, console, **kwargs: calls.append("mine-all") or 1,
    )
    monkeypatch.setattr(
        app_module,
        "run_mine_loop",
        lambda project, console, **kwargs: (_ for _ in ()).throw(
            AssertionError("interactive miner should not run")
        ),
    )
    monkeypatch.setattr(app_module, "load_sentences", lambda project: [object()])
    monkeypatch.setattr(
        app_module,
        "export_project",
        lambda project, output: calls.append("export") or package_path,
    )
    monkeypatch.setattr(
        app_module,
        "validate_package",
        lambda package: calls.append("validate")
        or {"source": {"title": "Fixture video"}, "sentences": [{}]},
    )

    result = runner.invoke(app_module.app, ["create", source.url, "-y"])

    assert result.exit_code == 0, result.output
    assert calls == ["mine-all", "export", "validate"]
    assert "Mining all subtitle cues" in result.output
