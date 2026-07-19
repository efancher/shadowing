from __future__ import annotations

from io import StringIO
from pathlib import Path
from types import SimpleNamespace

from rich.console import Console

import shadowmine.mine as mine_module
from shadowmine.models import Cue


def test_mine_enter_uses_keep_blank_english_and_save_defaults(
    monkeypatch,
    tmp_path: Path,
) -> None:
    prompts: list[tuple[str, str | None]] = []
    saved: list[dict[str, object]] = []

    monkeypatch.setattr(
        mine_module,
        "load_project_cues",
        lambda project: [
            Cue(
                index=0,
                startMs=1000,
                endMs=2500,
                text="こんにちは。",
                isAuto=True,
            )
        ],
    )

    def answer(prompt: str, **kwargs: object) -> str:
        default = kwargs.get("default")
        prompts.append((prompt, default if isinstance(default, str) else None))
        return default if isinstance(default, str) else ""

    monkeypatch.setattr(mine_module.Prompt, "ask", answer)
    monkeypatch.setattr(
        mine_module.Confirm,
        "ask",
        lambda prompt, **kwargs: kwargs.get("default") is True,
    )

    def save_clip(project: Path, **kwargs: object) -> SimpleNamespace:
        saved.append(kwargs)
        return SimpleNamespace(id="sentence-001", clipPath="clips/sentence-001.m4a")

    monkeypatch.setattr(mine_module, "add_clip", save_clip)

    code = mine_module.run_mine_loop(
        tmp_path,
        Console(file=StringIO()),
    )

    assert code == 0
    assert prompts == [("Action", "keep"), ("English (optional)", "")]
    assert saved == [
        {
            "start_seconds": 1.0,
            "end_seconds": 2.5,
            "japanese": "こんにちは。",
            "english": None,
            "transcript_status": "auto-caption",
        }
    ]


def test_mine_all_uses_english_and_skips_existing_boundaries(
    monkeypatch,
    tmp_path: Path,
) -> None:
    cues = [
        Cue(index=0, startMs=1000, endMs=2000, text="こんにちは。", isAuto=True),
        Cue(index=1, startMs=2000, endMs=3000, text="元気ですか。", isAuto=True),
    ]
    saved: list[dict[str, object]] = []

    monkeypatch.setattr(mine_module, "load_project_cues", lambda project: cues)
    monkeypatch.setattr(
        mine_module,
        "load_parallel_text",
        lambda project, primary: {0: "Hello.", 1: "How are you?"},
    )
    monkeypatch.setattr(
        mine_module,
        "load_sentences",
        lambda project: [
            SimpleNamespace(
                subtitleStartMs=1000,
                subtitleEndMs=2000,
                startMs=850,
                endMs=2250,
            )
        ],
    )

    def save_clip(project: Path, **kwargs: object) -> SimpleNamespace:
        saved.append(kwargs)
        return SimpleNamespace(id="sentence-002", clipPath="clips/sentence-002.m4a")

    monkeypatch.setattr(mine_module, "add_clip", save_clip)

    count = mine_module.mine_all_cues(
        tmp_path,
        Console(file=StringIO()),
    )

    assert count == 1
    assert saved == [
        {
            "start_seconds": 2.0,
            "end_seconds": 3.0,
            "japanese": "元気ですか。",
            "english": "How are you?",
            "transcript_status": "auto-caption",
        }
    ]
