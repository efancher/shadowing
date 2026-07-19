from __future__ import annotations

import pytest

from shadowmine.readings import generate_reading, has_kanji, reading_engine_available

pytestmark = pytest.mark.skipif(
    not reading_engine_available(),
    reason="fugashi + unidic-lite reading engine is not installed",
)


def test_has_kanji_detects_ideographs():
    assert has_kanji("今日は")
    assert not has_kanji("そうなの?")
    assert not has_kanji("ABC 123")


def test_generate_reading_uses_context_aware_readings():
    # UniDic reads 今日 as きょう (not こんにちは) and 歳 as さい.
    assert generate_reading("今日はどこへ行くんですか。") == "きょうはどこへいくんですか。"
    assert generate_reading("22歳だよ。") == "22さいだよ。"


def test_generate_reading_skips_kana_only_text():
    assert generate_reading("そうなの?") is None
    assert generate_reading("") is None


def test_generate_reading_preserves_non_kanji_tokens():
    reading = generate_reading("私はABCを見た。")
    assert reading is not None
    assert "ABC" in reading
    assert "。" in reading


def test_backfill_readings_fills_only_missing(tmp_path):
    from shadowmine.mine import backfill_readings
    from shadowmine.models import ProjectSentence
    from shadowmine.project import load_sentences, save_sentences

    def sentence(id_: str, japanese: str, reading: str | None) -> ProjectSentence:
        return ProjectSentence(
            id=id_,
            japanese=japanese,
            reading=reading,
            startMs=0,
            endMs=1000,
            clipPath=f"clips/{id_}.m4a",
            audioDurationMs=1000,
            mimeType="audio/mp4",
        )

    save_sentences(
        tmp_path,
        [
            sentence("s1", "今日は晴れです。", None),
            sentence("s2", "22歳だよ。", "existing"),
            sentence("s3", "そうなの?", None),
        ],
    )

    updated = backfill_readings(tmp_path)

    assert updated == 1
    by_id = {s.id: s for s in load_sentences(tmp_path)}
    assert by_id["s1"].reading == "きょうははれです。"
    assert by_id["s2"].reading == "existing"
    assert by_id["s3"].reading is None
