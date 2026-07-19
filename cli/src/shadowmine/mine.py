from __future__ import annotations

from pathlib import Path

from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.table import Table

from shadowmine.clip import add_clip
from shadowmine.models import Cue
from shadowmine.subtitles import load_project_cues


def _format_ms(ms: int) -> str:
    total_seconds = ms / 1000
    minutes = int(total_seconds // 60)
    seconds = total_seconds % 60
    return f"{minutes}:{seconds:05.2f}"


def run_mine_loop(project_dir: Path, console: Console | None = None) -> int:
    out = console or Console()
    cues = load_project_cues(project_dir)
    if not cues:
        out.print("[yellow]No subtitle cues found. Run `shadowmine subtitles` first.[/yellow]")
        return 1

    auto_count = sum(1 for cue in cues if cue.isAuto)
    if auto_count:
        out.print(
            f"[yellow]Loaded {len(cues)} cues ({auto_count} from auto captions). "
            "Treat text as unverified drafts.[/yellow]"
        )
    else:
        out.print(f"Loaded {len(cues)} cues.")

    index = 0
    saved = 0
    while 0 <= index < len(cues):
        cue = cues[index]
        table = Table(title=f"Cue {index + 1}/{len(cues)}", show_header=False)
        table.add_row("Time", f"{_format_ms(cue.startMs)} → {_format_ms(cue.endMs)}")
        table.add_row("Auto", "yes" if cue.isAuto else "no")
        table.add_row("Text", cue.text)
        out.print(table)
        action = Prompt.ask(
            "Action",
            choices=["keep", "edit", "skip", "prev", "quit"],
            default="skip",
        )
        if action == "quit":
            break
        if action == "prev":
            index = max(0, index - 1)
            continue
        if action == "skip":
            index += 1
            continue

        japanese = cue.text
        if action == "edit":
            japanese = Prompt.ask("Japanese", default=cue.text)
        english = Prompt.ask("English (optional)", default="")
        if not Confirm.ask("Clip and save this sentence?", default=True):
            index += 1
            continue
        sentence = add_clip(
            project_dir,
            start_seconds=cue.startMs / 1000,
            end_seconds=cue.endMs / 1000,
            japanese=japanese,
            english=english or None,
            transcript_status="manually-corrected" if action == "edit" else ("auto-caption" if cue.isAuto else "unverified"),
        )
        out.print(f"[green]Saved[/green] {sentence.id} → {sentence.clipPath}")
        saved += 1
        index += 1

    out.print(f"Done. Saved {saved} sentence(s).")
    return 0


def cues_as_table(cues: list[Cue]) -> Table:
    table = Table("Index", "Start", "End", "Auto", "Text")
    for cue in cues:
        table.add_row(
            str(cue.index + 1),
            _format_ms(cue.startMs),
            _format_ms(cue.endMs),
            "yes" if cue.isAuto else "no",
            cue.text,
        )
    return table
