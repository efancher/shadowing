from __future__ import annotations

import json
from pathlib import Path

from shadowmine.models import ProjectSentence, ProjectSource


def resolve_project_dir(path: str | Path, base: Path | None = None) -> Path:
    candidate = Path(path)
    if not candidate.is_absolute() and base is not None:
        candidate = (base / candidate).resolve()
    else:
        candidate = candidate.resolve()
    if candidate.name == "source.json":
        candidate = candidate.parent
    if not candidate.exists():
        raise FileNotFoundError(f"Project directory not found: {candidate}")
    if not (candidate / "source.json").exists():
        raise FileNotFoundError(f"Not a shadowmine project (missing source.json): {candidate}")
    return candidate


def load_source(project_dir: Path) -> ProjectSource:
    return ProjectSource.model_validate_json((project_dir / "source.json").read_text(encoding="utf-8"))


def save_source(project_dir: Path, source: ProjectSource) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "source.json").write_text(
        json.dumps(source.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def load_sentences(project_dir: Path) -> list[ProjectSentence]:
    path = project_dir / "sentences.json"
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [ProjectSentence.model_validate(item) for item in raw]


def save_sentences(project_dir: Path, sentences: list[ProjectSentence]) -> None:
    payload = [item.model_dump(mode="json") for item in sentences]
    (project_dir / "sentences.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def source_audio_path(project_dir: Path) -> Path:
    for name in ("source_audio.m4a", "source_audio.mp3", "source_audio.webm", "source_audio.wav"):
        path = project_dir / name
        if path.exists():
            return path
    raise FileNotFoundError(f"No source audio found under {project_dir}")


def ensure_project_dirs(project_dir: Path) -> None:
    (project_dir / "subtitles").mkdir(parents=True, exist_ok=True)
    (project_dir / "clips").mkdir(parents=True, exist_ok=True)
