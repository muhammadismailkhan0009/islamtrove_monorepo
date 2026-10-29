"""The audio bridge must reject SSRF attempts and only deliver trusted MP3s."""

import httpx
from fastapi.testclient import TestClient

from islamtrove.api.media import permitted_audio_url
from islamtrove.main import create_app

_VALID = "https://anlayarakkuranokuyorum.com/audio/de/001001.mp3"


def test_media_url_allowlist() -> None:
    assert permitted_audio_url(_VALID)
    assert permitted_audio_url(
        "https://everyayah.com/data/Minshawy_Mujawwad_192kbps/PageMp3s/Page001.mp3"
    )
    assert permitted_audio_url("https://everyayah.com/data/Minshawy_Mujawwad_192kbps/001001.mp3")
    assert permitted_audio_url("https://cdn.islamic.network/quran/audio/192/en.walk/1.mp3")
    for invalid in (
        "http://anlayarakkuranokuyorum.com/audio/de/001001.mp3",
        "https://127.0.0.1/private",
        "https://anlayarakkuranokuyorum.com.evil.example/audio/de/001001.mp3",
        "https://anlayarakkuranokuyorum.com/admin",
        "https://anlayarakkuranokuyorum.com/audio/de/001001.mp3?redirect=1",
        "https://everyayah.com/data/Minshawy_Mujawwad_64kbps/001001.mp3",
        "https://cdn.islamic.network/quran/audio/192/ar.alafasy/1.mp3",
    ):
        assert not permitted_audio_url(invalid), invalid


def test_media_endpoint_returns_bytes_and_caching_header() -> None:
    seen: list[str] = []

    def provider(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(
            200, content=b"fake mp3 content", headers={"Content-Type": "audio/mpeg"}
        )

    with TestClient(create_app(transport=httpx.MockTransport(provider))) as client:
        response = client.get("/api/quran/media", params={"url": _VALID})
        assert response.status_code == 200
        assert response.content == b"fake mp3 content"
        assert response.headers["content-type"].startswith("audio/mpeg")
        assert response.headers["cache-control"].startswith("public")
        assert seen == [_VALID]


def test_media_endpoint_blocks_untrusted_urls_before_external_request() -> None:
    def provider(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("Untrusted media URL reached external network")

    with TestClient(create_app(transport=httpx.MockTransport(provider))) as client:
        for invalid in ("http://localhost/admin", "https://evil.invalid/test.mp3"):
            response = client.get("/api/quran/media", params={"url": invalid})
            assert response.status_code == 400


def test_media_endpoint_rejects_redirects_and_non_audio() -> None:
    def redirect(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})

    def html(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"hello", headers={"Content-Type": "text/html"})

    for handler in (redirect, html):
        with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
            response = client.get("/api/quran/media", params={"url": _VALID})
            assert response.status_code == 502
