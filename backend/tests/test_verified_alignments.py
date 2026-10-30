"""Regression tests for offline waveform-aligned Minshawi Mujawwad metadata."""

import copy
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

import islamtrove.api.continuous as continuous
from islamtrove.api.continuous import load_verified_alignment
from islamtrove.main import create_app

AL_KAHF_DATA = Path(__file__).resolve().parents[1] / "src/islamtrove/data/alignments/018.json"


def test_al_kahf_alignment_is_complete_monotonic_and_source_specific() -> None:
    result = load_verified_alignment(18)
    assert result is not None
    assert result["surahId"] == 18
    assert result["audioUrl"].endswith("/018.mp3")
    assert len(result["timings"]) == 110
    assert [item["ayah"] for item in result["timings"]] == list(range(1, 111))
    assert result["timings"][0]["fromMs"] == 0
    assert result["timings"][-1]["toMs"] == result["endMs"]
    assert 4_023_000 <= result["endMs"] <= 4_025_800
    assert all(
        first["toMs"] == second["fromMs"]
        for first, second in zip(result["timings"], result["timings"][1:], strict=False)
    )
    metadata = json.loads(AL_KAHF_DATA.read_text())
    assert len(metadata["audioSha256"]) == 64
    assert len(metadata["confidenceByAyah"]) == 110
    assert min(metadata["confidenceByAyah"]) >= 0.37


def test_al_kahf_24_to_25_respects_added_recitation_and_correct_end() -> None:
    timeline = load_verified_alignment(18)
    assert timeline is not None
    ayah24 = timeline["timings"][23]
    ayah25 = timeline["timings"][24]
    assert 948_000 <= ayah24["fromMs"] <= 949_000
    assert 1_088_000 <= ayah25["fromMs"] <= 1_089_000
    assert ayah24["toMs"] == ayah25["fromMs"]
    assert ayah24["toMs"] - ayah24["fromMs"] > 130_000
    assert timeline["endMs"] > 4_000_000


def test_api_uses_local_verified_alignment_without_upstream_qul_calls() -> None:
    def no_network(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"No upstream metadata requested: {request.url}")

    with TestClient(create_app(transport=httpx.MockTransport(no_network))) as client:
        response = client.get("/api/quran/surahs/18/continuous-recitation")
        assert response.status_code == 200
        assert response.json() == load_verified_alignment(18)
        assert client.get("/api/quran/surahs/18/continuous-recitation").status_code == 200


def test_new_provisional_alignment_is_locally_available() -> None:
    aligned = load_verified_alignment(112)
    assert aligned is not None
    assert len(aligned["timings"]) == 4
    assert aligned["audioUrl"].endswith("/112.mp3")
    metadata = json.loads((AL_KAHF_DATA.parent / "112.json").read_text())
    assert metadata["validationStatus"] == "experimental-cross-recording"
    assert metadata["reviewRequired"] is True
    assert {r["ayah"] for r in metadata["reviewAyahs"]} == set(range(1, 5))


def test_missing_alignment_uses_fallback_for_other_surahs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(continuous, "_ALIGNMENT_DIRECTORY", tmp_path)
    assert load_verified_alignment(112) is None


def test_clean_pilot_surahs_are_available_locally() -> None:
    first = load_verified_alignment(1)
    final = load_verified_alignment(114)
    assert first is not None and len(first["timings"]) == 7
    assert final is not None and len(final["timings"]) == 6


def test_candidate_cannot_be_activated_by_misplacing_its_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Create an unapproved candidate from tracked source data, not an
    # ignored offline-generation artifact that will be absent in clean CI.
    candidate = json.loads((AL_KAHF_DATA.parent / "112.json").read_text())
    candidate["validationStatus"] = "candidate"
    (tmp_path / "112.json").write_text(json.dumps(candidate))
    monkeypatch.setattr(continuous, "_ALIGNMENT_DIRECTORY", tmp_path)
    with pytest.raises(ValueError, match="Invalid local alignment metadata"):
        load_verified_alignment(112)


def test_corrupted_alignment_cannot_silently_fall_back_to_wrong_qul(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    source = json.loads(AL_KAHF_DATA.read_text())
    corrupted = copy.deepcopy(source)
    corrupted["timings"][24]["fromMs"] = 985_480
    (tmp_path / "018.json").write_text(json.dumps(corrupted))
    monkeypatch.setattr(continuous, "_ALIGNMENT_DIRECTORY", tmp_path)
    with pytest.raises(ValueError, match="Invalid verified alignment at 18:25"):
        load_verified_alignment(18)


def test_ar_rahman_uses_the_original_qul_recording_with_provisional_timings() -> None:
    timeline = load_verified_alignment(55)
    assert timeline is not None
    assert timeline["surahId"] == 55
    assert timeline["audioUrl"] == (
        "https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/055.mp3"
    )
    assert len(timeline["timings"]) == 78
    assert 1_262_000 <= timeline["endMs"] <= 1_263_000
    assert 41_000 <= timeline["timings"][6]["fromMs"] <= 46_000
    assert 1_240_000 <= timeline["timings"][-1]["fromMs"] <= 1_252_000
    assert all(
        left["toMs"] == right["fromMs"]
        for left, right in zip(timeline["timings"], timeline["timings"][1:], strict=False)
    )
    manifest = json.loads((AL_KAHF_DATA.parent / "055.json").read_text(encoding="utf-8"))
    assert manifest["validationStatus"] == "experimental-cross-recording"
    assert manifest["reviewRequired"] is True
    assert manifest["reviewAyahs"]
    assert len(manifest["featureAgreementSecondsByAyah"]) == 78
    assert len(manifest["audioSha256"]) == 64


def test_ar_rahman_manifest_is_static_without_provider_access() -> None:
    def no_network(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Unexpected QUL metadata provider request: {request.url}")

    with TestClient(create_app(transport=httpx.MockTransport(no_network))) as client:
        response = client.get("/api/quran/surahs/55/continuous-recitation")
        assert response.status_code == 200
        assert response.json() == load_verified_alignment(55)
        assert response.json()["audioUrl"].endswith("/055.mp3")
        assert client.get("/api/quran/verified-audio/055.mp3").status_code == 404


def test_experimental_alignment_requires_exact_surah_and_recording_url(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    manifest = json.loads((AL_KAHF_DATA.parent / "055.json").read_text())
    manifest["audioUrl"] = "https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/054.mp3"
    (tmp_path / "055.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(continuous, "_ALIGNMENT_DIRECTORY", tmp_path)
    with pytest.raises(ValueError, match="Invalid local alignment metadata"):
        load_verified_alignment(55)


def test_ar_rahman_missing_provisional_metadata_fails_closed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(continuous, "_ALIGNMENT_DIRECTORY", tmp_path)
    with TestClient(
        create_app(transport=httpx.MockTransport(lambda request: httpx.Response(500)))
    ) as client:
        response = client.get("/api/quran/surahs/55/continuous-recitation")
        assert response.status_code == 503
        assert response.json()["detail"] == "Recording-matched local timeline is missing"
