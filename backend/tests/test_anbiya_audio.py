"""Surah 21 uses the exact, full Assabile recording through the remote range proxy."""

import json
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from islamtrove.api.continuous import load_verified_alignment
from islamtrove.api.stream import ANBIYA_AUDIO_URL, approved_stream_url
from islamtrove.main import create_app

DATA = Path(__file__).resolve().parents[1] / "src/islamtrove/data"
SHA = "2c10e77e5f62c2f7039ce18de0e07251c0dad3098afba390c8fa246bdef2d8d6"
ETAG = '"5c76dfc0-1ad89bd"'
SIZE = 28_150_205


def test_anbiya_preserves_full_source_aligned_timings_and_sha() -> None:
    metadata = json.loads((DATA / "alignments/021.json").read_text())
    timeline = load_verified_alignment(21)
    assert timeline is not None
    assert metadata["audioUrl"] == timeline["audioUrl"] == ANBIYA_AUDIO_URL
    assert metadata["audioSha256"] == SHA
    assert metadata["audioBytes"] == SIZE
    assert metadata["method"] == "offline-global-DTW-four-speech-features"
    assert metadata["validationStatus"] == "experimental-cross-recording"
    assert metadata["reviewRequired"] is True
    assert len(timeline["timings"]) == 112
    assert [t["ayah"] for t in timeline["timings"]] == list(range(1, 113))
    assert timeline["timings"][0]["fromMs"] == 0
    assert timeline["endMs"] == 3_517_989
    assert timeline["timings"][1]["fromMs"] == 23_772
    assert timeline["timings"][-1]["toMs"] == timeline["endMs"]
    assert all(
        x["toMs"] == y["fromMs"]
        for x, y in zip(timeline["timings"], timeline["timings"][1:], strict=False)
    )


def test_anbiya_uses_local_timeline_metadata_without_qul_calls() -> None:
    def no_network(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Unexpected metadata request: {request.url}")

    with TestClient(create_app(transport=httpx.MockTransport(no_network))) as client:
        result = client.get("/api/quran/surahs/21/continuous-recitation")
        assert result.status_code == 200
        assert result.json() == load_verified_alignment(21)


def test_assabile_proxy_only_allows_the_exact_verified_url() -> None:
    assert approved_stream_url(ANBIYA_AUDIO_URL)
    for invalid in (
        ANBIYA_AUDIO_URL.replace("2c10e77e5f62", "deadbeefdead"),
        ANBIYA_AUDIO_URL.replace("media.assabile.com", "evil.example"),
        ANBIYA_AUDIO_URL.replace("https:", "http:"),
        ANBIYA_AUDIO_URL + "&redirect=https://127.0.0.1/",
        "https://media.assabile.com/arbitrary.mp3",
    ):
        assert not approved_stream_url(invalid)


def test_assabile_remote_proxy_supports_head_and_range() -> None:
    upstream_calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        upstream_calls.append((request.method, request.headers.get("range")))
        assert str(request.url) == ANBIYA_AUDIO_URL
        headers = {"Content-Type": "audio/mpeg", "ETag": ETAG}
        if request.method == "HEAD":
            return httpx.Response(200, headers={**headers, "Content-Length": str(SIZE)})
        assert request.headers["range"] == "bytes=100-127"
        return httpx.Response(
            206, content=b"test" * 7,
            headers={**headers, "Content-Range": f"bytes 100-127/{SIZE}"},
        )

    with TestClient(create_app(transport=httpx.MockTransport(upstream))) as client:
        head = client.head("/api/quran/stream", params={"url": ANBIYA_AUDIO_URL})
        assert head.status_code == 200
        assert head.headers["content-length"] == str(SIZE)
        response = client.get(
            "/api/quran/stream",
            params={"url": ANBIYA_AUDIO_URL},
            headers={"Range": "bytes=100-127"},
        )
        assert response.status_code == 206
        assert response.headers["content-range"] == f"bytes 100-127/{SIZE}"
        assert response.content == b"test" * 7
        assert upstream_calls == [("HEAD", None), ("GET", "bytes=100-127")]


def test_changed_assabile_file_is_rejected_instead_of_misaligned_playback() -> None:
    def wrong_etag(request: httpx.Request) -> httpx.Response:
        if request.method == "HEAD":
            return httpx.Response(200, headers={
                "Content-Type": "audio/mpeg",
                "Content-Length": str(SIZE), "ETag": '"changed"',
            })
        return httpx.Response(206, content=b"x", headers={
            "Content-Type": "audio/mpeg",
            "Content-Range": f"bytes 0-0/{SIZE}", "ETag": '"changed"',
        })

    with TestClient(create_app(transport=httpx.MockTransport(wrong_etag))) as client:
        head = client.head("/api/quran/stream", params={"url": ANBIYA_AUDIO_URL})
        assert head.status_code == 502
        chunk = client.get(
            "/api/quran/stream", params={"url": ANBIYA_AUDIO_URL},
            headers={"Range": "bytes=0-0"},
        )
        assert chunk.status_code == 502
