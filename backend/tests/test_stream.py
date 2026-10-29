"""Regression coverage for range-based progressive streaming (not run in this handoff)."""

import httpx
from fastapi.testclient import TestClient

from islamtrove.api.stream import approved_stream_url
from islamtrove.main import create_app

_MP3 = "https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/002.mp3"


def test_stream_allowlist_rejects_arbitrary_urls() -> None:
    assert approved_stream_url(_MP3)
    assert approved_stream_url(_MP3.replace("002.mp3", "114.mp3"))
    for url in (
        "http://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/002.mp3",
        "https://127.0.0.1/quran/surah/minshawy/mujawwad/mp3/002.mp3",
        _MP3.replace("002.mp3", "115.mp3"),
        _MP3 + "?redirect=https://127.0.0.1/private",
        "https://audio-cdn.tarteel.ai/quran/surah/other/mp3/002.mp3",
    ):
        assert not approved_stream_url(url), url


def test_stream_proxy_forwards_ranges_without_downloading_whole_file() -> None:
    requests: list[tuple[str, str | None]] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.headers.get("range")))
        assert str(request.url) == _MP3
        if request.method == "HEAD":
            return httpx.Response(
                200,
                headers={
                    "Content-Type": "binary/octet-stream",
                    "Content-Length": "293331661",
                    "Accept-Ranges": "bytes",
                },
            )
        assert request.headers.get("range") == "bytes=262144-262151"
        return httpx.Response(
            206,
            content=b"abcdefgh",
            headers={
                "Content-Type": "binary/octet-stream",
                "Content-Range": "bytes 262144-262151/293331661",
            },
        )

    with TestClient(create_app(transport=httpx.MockTransport(upstream))) as client:
        response = client.get(
            "/api/quran/stream",
            params={"url": _MP3},
            headers={"Range": "bytes=262144-262151"},
        )
        assert response.status_code == 206
        assert response.content == b"abcdefgh"
        assert response.headers["content-range"] == "bytes 262144-262151/293331661"
        assert response.headers["accept-ranges"] == "bytes"
        head = client.head("/api/quran/stream", params={"url": _MP3})
        assert head.status_code == 200
        assert head.headers["content-length"] == "293331661"
        assert requests == [("GET", "bytes=262144-262151"), ("HEAD", None)]


def test_range_proxy_refuses_upstream_that_ignores_http_range() -> None:
    def upstream(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"ignored", headers={"Content-Type": "audio/mpeg"})

    with TestClient(create_app(transport=httpx.MockTransport(upstream))) as client:
        response = client.get(
            "/api/quran/stream",
            params={"url": _MP3},
            headers={"Range": "bytes=0-255"},
        )
        assert response.status_code == 502


def test_stream_rejects_unsupported_range_formats_before_upstream() -> None:
    def unexpected(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("Invalid range reached upstream")

    with TestClient(create_app(transport=httpx.MockTransport(unexpected))) as client:
        for range_value in ("bytes=-100", "bytes=0-3,8-12", "bytes=30-12"):
            response = client.get(
                "/api/quran/stream",
                params={"url": _MP3},
                headers={"Range": range_value},
            )
            assert response.status_code == 416
