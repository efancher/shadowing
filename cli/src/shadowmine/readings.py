from __future__ import annotations

import re
from functools import lru_cache
from typing import Callable, Optional

# CJK ideographs (incl. extension A), compatibility ideographs, and the
# common iteration / repetition marks used with kanji.
_KANJI_RE = re.compile(r"[\u3400-\u9fff\uf900-\ufaff々〆〤ヶ]")


def has_kanji(text: str) -> bool:
    return bool(_KANJI_RE.search(text))


@lru_cache(maxsize=1)
def _load_engine() -> Optional[tuple[object, Callable[[str], str]]]:
    """Return (tagger, kata2hira) or None when the reading engine is missing.

    Uses fugashi + unidic-lite for context-aware readings. Both are optional
    dependencies, so any import/initialization failure degrades to "no reading"
    rather than raising.
    """
    try:
        import fugashi
        import jaconv
    except ImportError:
        return None
    try:
        tagger = fugashi.Tagger()
    except Exception:
        return None
    return tagger, jaconv.kata2hira


def reading_engine_available() -> bool:
    return _load_engine() is not None


def generate_reading(text: str) -> Optional[str]:
    """Return a hiragana reading for ``text`` as a hint for unfamiliar kanji.

    Only kanji-bearing tokens are converted; existing kana, punctuation,
    digits, and latin text are preserved as written. Readings come from UniDic
    and are best-effort hints, not verified furigana. Returns None when the
    text needs no reading (kana only) or the engine is unavailable.
    """
    text = text.strip()
    if not text or not has_kanji(text):
        return None
    engine = _load_engine()
    if engine is None:
        return None
    tagger, kata2hira = engine

    parts: list[str] = []
    for word in tagger(text):
        surface = word.surface
        if not has_kanji(surface):
            parts.append(surface)
            continue
        kana = getattr(word.feature, "kana", None) or getattr(word.feature, "pron", None)
        parts.append(kata2hira(kana) if kana else surface)

    reading = "".join(parts).strip()
    if not reading or reading == text:
        return None
    return reading
