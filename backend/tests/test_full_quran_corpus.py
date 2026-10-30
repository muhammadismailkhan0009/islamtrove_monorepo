"""The offline generated corpus must cover the complete canonical Quran."""

import json
from pathlib import Path

from islamtrove.api.continuous import load_verified_alignment

DATA = Path(__file__).resolve().parents[1] / "src/islamtrove/data"


def test_quran_local_alignment_covers_all_114_surahs_and_6236_ayahs() -> None:
    counts = json.loads((DATA / "surah_ayah_counts.json").read_text())
    assert len(counts) == 114 and sum(counts.values()) == 6236
    sources = list((DATA / "alignments").glob("[0-9][0-9][0-9].json"))
    assert len(sources) == 114
    total = 0
    provisional = 0
    for surah in range(1, 115):
        record = load_verified_alignment(surah)
        assert record is not None, f"No local playback timeline for Surah {surah}"
        assert len(record["timings"]) == counts[str(surah)]
        assert record["timings"][0]["fromMs"] == 0
        assert record["timings"][-1]["toMs"] == record["endMs"]
        raw = json.loads((DATA / "alignments" / f"{surah:03d}.json").read_text())
        assert raw["surahId"] == surah
        assert raw["audioUrl"] == record["audioUrl"]
        assert len(raw["audioSha256"]) == 64
        assert raw["audioBytes"] > 0
        assert raw["endMs"] <= raw["audioDurationMs"]
        if raw["validationStatus"] in ("experimental-cross-recording", "qul-published"):
            assert isinstance(raw["reviewAyahs"], list)
            if raw["validationStatus"] == "experimental-cross-recording":
                assert raw["reviewRequired"] is True
            provisional += 1
        else:
            assert raw["validationStatus"] in ("manually-reviewed", "automatically-verified")
        total += len(record["timings"])
    assert total == 6236
    assert provisional > 0  # Never silently label a new batch as all human-verified


def test_al_kahf_and_ar_rahman_manual_reviews_survive_corpus_generation() -> None:
    manual = json.loads((Path(__file__).resolve().parents[1] / "review-data/055.json").read_text())
    rahman = json.loads((DATA / "alignments/055.json").read_text())
    assert manual["audioSha256"] == rahman["audioSha256"]
    assert {7, 15, 21, 22, 23, 24, 25, 26, 27, 40, 78}.issubset(set(map(int, manual["reviews"])))
    kahf = load_verified_alignment(18)
    assert kahf is not None
    assert 1_088_000 <= kahf["timings"][24]["fromMs"] <= 1_089_000
