from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from shadowmine import __version__
from shadowmine.clip import add_clip, compute_boundaries
from shadowmine.deps import check_dependencies, require_dependencies
from shadowmine.export_pkg import export_project, validate_package
from shadowmine.mine import run_mine_loop
from shadowmine.project import ensure_project_dirs, load_source, resolve_project_dir, save_source
from shadowmine.subtitles import load_project_cues
from shadowmine.youtube import download_subtitles, fetch_audio, info_to_source, inspect_url

app = typer.Typer(
    name="shadowmine",
    help="Mine Japanese shadowing clips and export .shadowing.zip packages.",
    no_args_is_help=True,
)
console = Console()


def _default_projects() -> Path:
    return Path.cwd() / "projects"


@app.command("doctor")
def doctor_cmd() -> None:
    """Print dependency status and install hints."""
    report = check_dependencies()
    table = Table("Check", "Status")
    table.add_row("Python >= 3.11", "ok" if report.python_ok else "missing")
    table.add_row("ffmpeg", "ok" if report.ffmpeg_ok else "missing")
    table.add_row("ffprobe", "ok" if report.ffprobe_ok else "missing")
    table.add_row("yt-dlp", "ok" if report.ytdlp_ok else "missing")
    console.print(table)
    console.print(f"Python {report.python_version}")
    for message in report.messages:
        console.print(f"[red]• {message}[/red]")
    raise typer.Exit(code=0 if report.ok else 1)


@app.command("inspect")
def inspect_cmd(url: str = typer.Argument(..., help="YouTube URL or video id")) -> None:
    """Show title/channel/duration without downloading media."""
    require_dependencies(console)
    info = inspect_url(url)
    source = info_to_source(info)
    table = Table(title="Inspect", show_header=False)
    table.add_row("Video ID", source.videoId)
    table.add_row("Title", source.title)
    table.add_row("Channel", source.channel or "—")
    table.add_row("Duration ms", str(source.durationMs or "—"))
    table.add_row("URL", source.url)
    console.print(table)


@app.command("fetch")
def fetch_cmd(
    url: str = typer.Argument(..., help="YouTube URL or video id"),
    projects: Optional[Path] = typer.Option(None, "--projects", help="Projects root directory"),
) -> None:
    """Download best audio into projects/<videoId>/."""
    require_dependencies(console)
    project_dir = fetch_audio(url, projects or _default_projects())
    source = load_source(project_dir)
    console.print(f"[green]Fetched[/green] {source.title}")
    console.print(f"Project: {project_dir}")


@app.command("subtitles")
def subtitles_cmd(
    target: str = typer.Argument(..., help="YouTube URL or existing project directory"),
    projects: Optional[Path] = typer.Option(None, "--projects", help="Projects root directory"),
) -> None:
    """Download subtitles for a project or URL."""
    require_dependencies(console)
    projects_root = projects or _default_projects()
    path = Path(target)
    if path.exists() and ((path / "source.json").exists() or path.name == "source.json"):
        project_dir = resolve_project_dir(path)
    else:
        info = inspect_url(target)
        source = info_to_source(info)
        project_dir = projects_root / source.videoId
        ensure_project_dirs(project_dir)
        if not (project_dir / "source.json").exists():
            save_source(project_dir, source)

    source = load_source(project_dir)
    download_subtitles(source.url, project_dir)
    cues = load_project_cues(project_dir)
    console.print(f"Wrote subtitles under {project_dir / 'subtitles'} ({len(cues)} cues after parse/dedup).")


@app.command("mine")
def mine_cmd(project: Path = typer.Argument(..., help="Project directory")) -> None:
    """Interactive line-oriented cue browser that clips selected lines."""
    require_dependencies(console)
    project_dir = resolve_project_dir(project)
    code = run_mine_loop(project_dir, console)
    raise typer.Exit(code=code)


@app.command("clip")
def clip_cmd(
    project: Path = typer.Option(..., "--project", help="Project directory"),
    start: float = typer.Option(..., "--start", help="Start seconds (subtitle/source clock)"),
    end: float = typer.Option(..., "--end", help="End seconds"),
    japanese: str = typer.Option(..., "--japanese", help="Japanese sentence text"),
    english: Optional[str] = typer.Option(None, "--english", help="Optional English gloss"),
    reading: Optional[str] = typer.Option(None, "--reading", help="Optional reading"),
    tag: Optional[list[str]] = typer.Option(None, "--tag", help="Repeatable tag"),
    start_pad_ms: int = typer.Option(150, "--start-pad-ms"),
    end_pad_ms: int = typer.Option(250, "--end-pad-ms"),
) -> None:
    """Noninteractive clip from project source audio into sentences.json."""
    require_dependencies(console)
    project_dir = resolve_project_dir(project)
    _, _, adjusted_start, adjusted_end = compute_boundaries(
        int(round(start * 1000)),
        int(round(end * 1000)),
        start_pad_ms=start_pad_ms,
        end_pad_ms=end_pad_ms,
    )
    sentence = add_clip(
        project_dir,
        start_seconds=start,
        end_seconds=end,
        japanese=japanese,
        english=english,
        reading=reading,
        tags=tag or [],
        start_pad_ms=start_pad_ms,
        end_pad_ms=end_pad_ms,
    )
    console.print(
        f"[green]Clipped[/green] {sentence.id} "
        f"({adjusted_start}–{adjusted_end} ms) → {sentence.clipPath}"
    )


@app.command("export")
def export_cmd(
    project: Path = typer.Argument(..., help="Project directory"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Output .shadowing.zip path"),
) -> None:
    """Export a japanese-shadowing-package v1 zip."""
    require_dependencies(console)
    project_dir = resolve_project_dir(project)
    out = export_project(project_dir, output)
    console.print(f"[green]Exported[/green] {out}")


@app.command("validate")
def validate_cmd(package: Path = typer.Argument(..., help="Path to .shadowing.zip")) -> None:
    """Validate a package against the shared JSON Schema and ZIP path rules."""
    document = validate_package(package)
    console.print(
        f"[green]Valid[/green] {document['source']['title']} · "
        f"{len(document['sentences'])} sentences · format={document['manifest']['format']} "
        f"v{document['manifest']['version']}"
    )


@app.command("version")
def version_cmd() -> None:
    console.print(__version__)


def main() -> None:
    app()


if __name__ == "__main__":
    main()
