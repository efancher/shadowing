"""Shared validation tests for japanese-shadowing-package v1."""

from __future__ import annotations

import json
import zipfile
from copy import deepcopy
from pathlib import Path

import pytest

try:
    import jsonschema
except ImportError:  # pragma: no cover
    jsonschema = None

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "schemas" / "shadowing-package.schema.json"
EXAMPLE_ZIP = REPO_ROOT / "examples" / "example.shadowing.zip"
FIXTURE_DIR = REPO_ROOT / "schemas" / "fixtures" / "example-package"


def _load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _valid_document() -> dict:
    return {
        "manifest": json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8")),
        "source": json.loads((FIXTURE_DIR / "source.json").read_text(encoding="utf-8")),
        "sentences": json.loads((FIXTURE_DIR / "sentences.json").read_text(encoding="utf-8")),
        "subtitlePath": "subtitles/ja.vtt",
    }


def _assert_zip_paths_safe(names: list[str]) -> None:
    for name in names:
        normalized = name.replace("\\", "/")
        if normalized.startswith("/") or ".." in normalized.split("/"):
            raise ValueError(f"unsafe zip path: {name}")


@pytest.mark.skipif(jsonschema is None, reason="jsonschema not installed")
def test_valid_fixture_document_passes_schema() -> None:
    jsonschema.validate(instance=_valid_document(), schema=_load_schema())


@pytest.mark.skipif(jsonschema is None, reason="jsonschema not installed")
def test_example_zip_round_trip() -> None:
    with zipfile.ZipFile(EXAMPLE_ZIP) as zf:
        names = zf.namelist()
        _assert_zip_paths_safe(names)
        assert "manifest.json" in names
        assert "source.json" in names
        assert "sentences.json" in names
        assert "audio/sentence-001.wav" in names
        document = {
            "manifest": json.loads(zf.read("manifest.json")),
            "source": json.loads(zf.read("source.json")),
            "sentences": json.loads(zf.read("sentences.json")),
        }
        for sentence in document["sentences"]:
            audio_path = sentence["audio"]["path"]
            assert audio_path in names
        jsonschema.validate(instance=document, schema=_load_schema())


@pytest.mark.skipif(jsonschema is None, reason="jsonschema not installed")
def test_missing_audio_reference_is_detectable() -> None:
    document = _valid_document()
    document["sentences"][0]["audio"]["path"] = "audio/missing.wav"
    jsonschema.validate(instance=document, schema=_load_schema())
    with zipfile.ZipFile(EXAMPLE_ZIP) as zf:
        names = set(zf.namelist())
    assert document["sentences"][0]["audio"]["path"] not in names


@pytest.mark.skipif(jsonschema is None, reason="jsonschema not installed")
def test_path_traversal_rejected() -> None:
    with pytest.raises(ValueError, match="unsafe"):
        _assert_zip_paths_safe(["audio/../../etc/passwd"])


@pytest.mark.skipif(jsonschema is None, reason="jsonschema not installed")
def test_bad_timestamps_fail_schema() -> None:
    document = deepcopy(_valid_document())
    document["sentences"][0]["endMs"] = 0
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=document, schema=_load_schema())


@pytest.mark.skipif(jsonschema is None, reason="jsonschema not installed")
def test_unknown_version_fails_schema() -> None:
    document = deepcopy(_valid_document())
    document["manifest"]["version"] = 99
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=document, schema=_load_schema())


@pytest.mark.skipif(jsonschema is None, reason="jsonschema not installed")
def test_unknown_format_fails_schema() -> None:
    document = deepcopy(_valid_document())
    document["manifest"]["format"] = "japanese-pronunciation-lab"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=document, schema=_load_schema())
