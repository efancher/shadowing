from __future__ import annotations

import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import jsonschema

from shadowmine import __version__
from shadowmine.constants import GENERATOR_NAME, PACKAGE_FORMAT, PACKAGE_VERSION, SCHEMA_PATH
from shadowmine.models import PackageAudio, PackageManifest, PackageSentence, PackageSource
from shadowmine.project import load_sentences, load_source


def _load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def build_package_document(project_dir: Path) -> tuple[dict, dict[str, Path]]:
    source = load_source(project_dir)
    sentences = load_sentences(project_dir)
    if not sentences:
        raise ValueError("Project has no sentences to export. Run clip/mine first.")

    package_source = PackageSource(
        id=source.id,
        type=source.type,
        url=source.url,
        videoId=source.videoId,
        title=source.title,
        channel=source.channel,
        durationMs=source.durationMs,
    )
    package_sentences: list[PackageSentence] = []
    audio_files: dict[str, Path] = {}
    for index, sentence in enumerate(sentences, start=1):
        audio_name = f"sentence-{index:03d}.m4a"
        package_path = f"audio/{audio_name}"
        clip_path = project_dir / sentence.clipPath
        if not clip_path.exists():
            raise FileNotFoundError(f"Missing clip file: {clip_path}")
        audio_files[package_path] = clip_path
        package_sentences.append(
            PackageSentence(
                id=sentence.id,
                japanese=sentence.japanese,
                reading=sentence.reading,
                english=sentence.english,
                startMs=sentence.startMs,
                endMs=sentence.endMs,
                subtitleStartMs=sentence.subtitleStartMs,
                subtitleEndMs=sentence.subtitleEndMs,
                adjustedStartMs=sentence.adjustedStartMs,
                adjustedEndMs=sentence.adjustedEndMs,
                speaker=sentence.speaker,
                tags=sentence.tags,
                notes=sentence.notes,
                transcriptStatus=sentence.transcriptStatus,
                audio=PackageAudio(
                    path=package_path,
                    mimeType=sentence.mimeType,
                    durationMs=sentence.audioDurationMs,
                ),
            )
        )

    subtitle_path = None
    for candidate in sorted((project_dir / "subtitles").glob("*.vtt")):
        subtitle_path = f"subtitles/{candidate.name}"
        audio_files[subtitle_path] = candidate
        break

    document = {
        "manifest": PackageManifest(
            format=PACKAGE_FORMAT,  # type: ignore[arg-type]
            version=PACKAGE_VERSION,  # type: ignore[arg-type]
            createdAt=datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            generator={"name": GENERATOR_NAME, "version": __version__},
        ).model_dump(mode="json"),
        "source": package_source.model_dump(mode="json"),
        "sentences": [item.model_dump(mode="json") for item in package_sentences],
    }
    if subtitle_path:
        document["subtitlePath"] = subtitle_path
    return document, audio_files


def export_project(project_dir: Path, output_path: Path | None = None) -> Path:
    document, files = build_package_document(project_dir)
    jsonschema.validate(instance=document, schema=_load_schema())

    source = load_source(project_dir)
    out = output_path or (project_dir / f"{source.videoId}.shadowing.zip")
    out.parent.mkdir(parents=True, exist_ok=True)

    staging = project_dir / ".export_staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    try:
        (staging / "manifest.json").write_text(
            json.dumps(document["manifest"], indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (staging / "source.json").write_text(
            json.dumps(document["source"], indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (staging / "sentences.json").write_text(
            json.dumps(document["sentences"], indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        for relative, path in files.items():
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)

        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(staging.rglob("*")):
                if path.is_file():
                    zf.write(path, path.relative_to(staging).as_posix())
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return out


def validate_package(path: Path) -> dict:
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        for name in names:
            normalized = name.replace("\\", "/")
            if normalized.startswith("/") or ".." in normalized.split("/"):
                raise ValueError(f"Unsafe path in package: {name}")
        required = ("manifest.json", "source.json", "sentences.json")
        for name in required:
            if name not in names:
                raise ValueError(f"Package missing {name}")
        document = {
            "manifest": json.loads(zf.read("manifest.json")),
            "source": json.loads(zf.read("source.json")),
            "sentences": json.loads(zf.read("sentences.json")),
        }
        if "subtitlePath" in document["manifest"]:
            pass
        subtitle_path = None
        # optional top-level key may live only in combined docs; check sentences audio
        for sentence in document["sentences"]:
            audio_path = sentence["audio"]["path"]
            if audio_path not in names:
                raise ValueError(f"Missing audio file {audio_path}")
        for name in names:
            if name.startswith("subtitles/") and name.endswith(".vtt"):
                subtitle_path = name
                break
        if subtitle_path:
            document["subtitlePath"] = subtitle_path
        jsonschema.validate(instance=document, schema=_load_schema())
        return document
