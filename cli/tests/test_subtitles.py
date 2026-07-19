from shadowmine.subtitles import dedupe_rolling_captions, parse_srt, parse_webvtt
from shadowmine.models import Cue


def test_parse_webvtt_basic() -> None:
    content = """WEBVTT

1
00:01:23.420 --> 00:01:25.810
今日はどこへ行くんですか。
"""
    cues = parse_webvtt(content)
    assert len(cues) == 1
    assert cues[0].startMs == 83420
    assert cues[0].endMs == 85810
    assert "今日" in cues[0].text


def test_parse_srt_basic() -> None:
    content = """1
00:00:01,000 --> 00:00:02,500
こんにちは

2
00:00:02,500 --> 00:00:04,000
世界
"""
    cues = parse_srt(content)
    assert len(cues) == 2
    assert cues[0].text == "こんにちは"


def test_dedupe_rolling_captions() -> None:
    cues = [
        Cue(index=0, startMs=0, endMs=1000, text="今日は", isAuto=True),
        Cue(index=1, startMs=200, endMs=1500, text="今日はどこへ", isAuto=True),
        Cue(index=2, startMs=400, endMs=2000, text="今日はどこへ行くんですか。", isAuto=True),
        Cue(index=3, startMs=2500, endMs=3000, text="わかりました。", isAuto=True),
    ]
    deduped = dedupe_rolling_captions(cues)
    assert len(deduped) == 2
    assert deduped[0].text == "今日はどこへ行くんですか。"
    assert deduped[0].startMs == 0
    assert deduped[1].text == "わかりました。"
