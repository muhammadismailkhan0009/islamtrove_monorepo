"""QUL continuous Minshawi Mujawwad recitation with authoritative Ayah boundaries."""

from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

import islamtrove.api.continuous as continuous
from islamtrove.api.continuous import validate_qul
from islamtrove.main import create_app


def sample_payload(surah: int = 112) -> dict:
    return {
        "audio": {
            "url": (
                f"https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/{surah:03d}.mp3"
            ),
            "duration": 103,  # Longer recording: not the Ayah playback limit.
        },
        "segments": {
            f"{surah}:1": {"time_from": 0, "time_to": 4490},
            f"{surah}:2": {"time_from": 4490, "time_to": 8380},
            f"{surah}:3": {"time_from": 8380, "time_to": 20760},
            f"{surah}:4": {"time_from": 20760, "time_to": 27730},
        },
    }


def test_timestamps_not_mp3_duration_are_playback_source_of_truth() -> None:
    result = validate_qul(112, sample_payload())
    assert result["endMs"] == 27730
    assert result["timings"][0] == {"ayah": 1, "fromMs": 0, "toMs": 4490}
    assert result["timings"][3] == {"ayah": 4, "fromMs": 20760, "toMs": 27730}
    assert len(result["timings"]) == 4


def test_fatihah_uses_matching_page_recording_but_preserves_qul_boundaries() -> None:
    payload = sample_payload(1)
    times = [0, 13320, 26380, 44380, 70320, 85240, 96110, 130960]
    payload["segments"] = {
        f"1:{ayah}": {"time_from": times[ayah - 1], "time_to": times[ayah]} for ayah in range(1, 8)
    }
    result = validate_qul(1, payload)
    assert result["audioUrl"].endswith("/PageMp3s/Page001.mp3")
    assert result["endMs"] == 130960
    assert result["timings"][-1]["toMs"] == 130960


def test_invalid_qul_boundaries_are_rejected() -> None:
    from pytest import raises

    payload = sample_payload()
    payload["segments"]["112:2"]["time_from"] = 3000
    with raises(ValueError):
        validate_qul(112, payload)

    payload = sample_payload()
    del payload["segments"]["112:3"]
    with raises(ValueError):
        validate_qul(112, payload)

    payload = sample_payload()
    payload["audio"]["url"] = "https://evil.example/audio.mp3"
    with raises(ValueError):
        validate_qul(112, payload)


def test_continuous_route_uses_qul_times_and_same_origin_bridge(
    provider_reply, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(continuous, "_ALIGNMENT_DIRECTORY", tmp_path)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "qul.tarteel.ai":
            assert request.url.path == "/api/v1/audio/surah_segments/8"
            assert request.url.params["surah"] == "112"
            return httpx.Response(200, json=sample_payload())
        return provider_reply(request)

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        response = client.get("/api/quran/surahs/112/continuous-recitation")
        assert response.status_code == 200
        assert response.json()["endMs"] == 27730
        assert len(response.json()["timings"]) == 4
        assert response.json()["audioUrl"].endswith("/112.mp3")


def test_continuous_route_does_not_accept_incomplete_surah(
    provider_reply, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(continuous, "_ALIGNMENT_DIRECTORY", tmp_path)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "qul.tarteel.ai":
            payload = sample_payload()
            del payload["segments"]["112:4"]
            return httpx.Response(200, json=payload)
        return provider_reply(request)

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        assert client.get("/api/quran/surahs/112/continuous-recitation").status_code == 502
