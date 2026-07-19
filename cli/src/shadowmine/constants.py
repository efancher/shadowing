from __future__ import annotations

from pathlib import Path

PACKAGE_FORMAT = "japanese-shadowing-package"
PACKAGE_VERSION = 1
GENERATOR_NAME = "shadowmine"

DEFAULT_START_PAD_MS = 150
DEFAULT_END_PAD_MS = 250
DEFAULT_FADE_MS = 20

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "schemas" / "shadowing-package.schema.json"
