"""German per-Ayah audio and the reading text API."""

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import HttpUrl

from islamtrove.infrastructure.german_audio import GermanAudioSource
from islamtrove.main import create_app
from islamtrove.ports.quran_source import ProviderDataError


class FakeSource:
    async def list_surahs(self):
        return []

    async def list_ayah_audio(self, surah_id, edition_id):
        from islamtrove.domain.models import AyahAudio

        assert edition_id == "ar.minshawimujawwad"
        return [
            AyahAudio(ayah=ayah, url=HttpUrl(f"https://everyayah.com/{surah_id:03d}{ayah:03d}.mp3"))
            for ayah in range(1, 4)
        ]


@pytest.mark.asyncio
async def test_german_audio_files_are_correctly_indexed() -> None:
    source = GermanAudioSource(FakeSource())
    result = await source.list_ayah_audio(1, "de.bubenheim.nail")
    assert [a.ayah for a in result] == [1, 2, 3]
    assert [str(a.url) for a in result] == [
        "https://anlayarakkuranokuyorum.com/audio/de/001001.mp3",
        "https://anlayarakkuranokuyorum.com/audio/de/001002.mp3",
        "https://anlayarakkuranokuyorum.com/audio/de/001003.mp3",
    ]


@pytest.mark.asyncio
async def test_missing_al_baqarah_german_audio_is_explicit() -> None:
    source = GermanAudioSource(FakeSource())
    with pytest.raises(ProviderDataError, match="283"):
        await source.list_ayah_audio(2, "de.bubenheim.nail")


def test_german_audio_api_includes_minshawi_and_narrated_verse_urls(client: TestClient) -> None:
    response = client.get(
        "/api/quran/surahs/1/audio",
        params={
            "reciter": "Muhammad Siddiq Al-Minshawi (Mujawwad)",
            "translation": "German",
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["reciter"]["id"] == "ar.minshawimujawwad"
    assert result["translation"]["id"] == "de.bubenheim.nail"
    assert len(result["translationAudio"]) == 7
    assert result["recitation"][0]["url"].endswith("/001001.mp3")
    assert result["translationAudio"][0]["url"].endswith("/audio/de/001001.mp3")
    assert result["translationAudio"][6]["url"].endswith("/audio/de/001007.mp3")


def test_incomplete_german_surah_returns_failure_instead_of_skipping(client: TestClient) -> None:
    response = client.get(
        "/api/quran/surahs/2/audio",
        params={"reciter": "ar.minshawimujawwad", "translation": "German"},
    )
    assert response.status_code == 502


def test_production_verse_api_merges_consistent_language_text() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        calls.append(path)
        assert path.startswith("/api/v1/translation/sura/")
        edition = path.split("/")[5]
        return httpx.Response(
            200,
            json={
                "result": [
                    {
                        "aya": str(i),
                        "arabic_text": f"Arabic {i}",
                        "translation": f"{edition} {i}",
                    }
                    for i in range(1, 4)
                ]
            },
        )

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        response = client.get("/api/quran/surahs/1/verses")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3
        assert data[0]["ayah"] == 1
        assert data[0]["arabic"] == "Arabic 1"
        assert data[0]["translations"] == {
            "German": "german_bubenheim 1",
            "English": "english_rwwad 1",
            "Urdu": "urdu_junagarhi 1",
        }
        assert len(calls) == 3
        assert client.get("/api/quran/surahs/1/verses").status_code == 200
        assert len(calls) == 3  # Memory-cached text; no re-fetch.


def test_verse_api_rejects_missing_or_reordered_ayahs() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        edition = request.url.path.split("/")[5]
        return httpx.Response(
            200,
            json={
                "result": [
                    {
                        "aya": "2" if edition == "german_bubenheim" else "1",
                        "arabic_text": "Arabic",
                        "translation": "Translated",
                    }
                ]
            },
        )

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        assert client.get("/api/quran/surahs/1/verses").status_code == 502
