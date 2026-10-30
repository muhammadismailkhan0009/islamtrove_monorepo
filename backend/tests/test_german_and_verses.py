"""German per-Ayah audio and the reading text API."""

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import HttpUrl

from islamtrove.infrastructure.german_audio import GermanAudioSource
from islamtrove.main import create_app


class FakeSource:
    async def list_surahs(self):
        from islamtrove.domain.models import Surah

        return [
            Surah(
                id=id,
                name="Test",
                meaning="Test",
                arabicName="سورة",
                revelation="Meccan",
                ayahCount=286 if id == 2 else 3,
            )
            for id in (1, 2)
        ]

    async def list_ayah_audio(self, surah_id, edition_id):
        from islamtrove.domain.models import AyahAudio

        assert edition_id == "ar.minshawimujawwad"
        return [
            AyahAudio(ayah=ayah, url=HttpUrl(f"https://everyayah.com/{surah_id:03d}{ayah:03d}.mp3"))
            for ayah in range(1, 287 if surah_id == 2 else 4)
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
async def test_german_al_baqarah_omits_only_unavailable_recordings() -> None:
    source = GermanAudioSource(FakeSource())
    available = await source.list_ayah_audio(2, "de.bubenheim.nail")
    assert len(available) == 282
    assert [item.ayah for item in available] == list(range(1, 283))
    assert str(available[-1].url).endswith("/002282.mp3")


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


def test_al_baqarah_german_manifest_is_usable_with_explicit_omissions(
    client: TestClient,
) -> None:
    response = client.get(
        "/api/quran/surahs/2/audio",
        params={"reciter": "ar.minshawimujawwad", "translation": "German"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["recitation"]) == 286
    assert len(payload["translationAudio"]) == 282
    assert payload["unavailableTranslationAyahs"] == [283, 284, 285, 286]
    assert payload["translationAudio"][-1]["ayah"] == 282
    assert payload["translationAudio"][-1]["url"].endswith("/002282.mp3")


def test_translation_endpoint_returns_german_without_any_arabic_media_dependency(
    client: TestClient,
) -> None:
    response = client.get("/api/quran/surahs/2/translation-audio", params={"language": "German"})
    assert response.status_code == 200
    manifest = response.json()
    assert manifest["surahId"] == 2
    assert manifest["language"]["name"] == "German"
    assert len(manifest["audio"]) == 282
    assert manifest["unavailableAyahs"] == [283, 284, 285, 286]
    assert "recitation" not in manifest


@pytest.mark.asyncio
async def test_german_manifest_does_not_call_arabic_audio_provider() -> None:
    from islamtrove.application.quran_service import QuranService
    from islamtrove.domain.models import Surah

    class LanguageOnlySource:
        async def list_surahs(self):
            return [
                Surah(
                    id=2,
                    name="Al-Baqarah",
                    meaning="The Cow",
                    arabicName="البقرة",
                    revelation="Medinan",
                    ayahCount=286,
                )
            ]

        async def list_ayah_audio(self, surah_id: int, edition_id: str):
            raise AssertionError(
                f"Arabic and audio manifests must not be requested: {surah_id}/{edition_id}"
            )

    service = QuranService(GermanAudioSource(LanguageOnlySource()))
    result = await service.translation_audio(2, "German")
    assert len(result.audio) == 282
    assert result.unavailableAyahs == [283, 284, 285, 286]


def _arabic_response(surah: int = 1, count: int = 3) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "code": 200,
            "data": {
                "number": surah,
                "numberOfAyahs": count,
                "ayahs": [
                    {"numberInSurah": index, "text": f"Uthmani Arabic {index}"}
                    for index in range(1, count + 1)
                ],
            },
        },
    )


def test_verse_text_uses_independent_arabic_and_written_translation_sources() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        calls.append(request.url.host + path)
        if path == "/v1/surah/1/quran-uthmani":
            return _arabic_response()
        if path.startswith("/v1/surah/1/"):
            edition = path.split("/")[-1]
            return httpx.Response(
                200,
                json={
                    "code": 200,
                    "data": {
                        "number": 1,
                        "numberOfAyahs": 3,
                        "ayahs": [
                            {"numberInSurah": i, "text": f"{edition} {i}"} for i in range(1, 4)
                        ],
                    },
                },
            )
        return httpx.Response(404)

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        arabic = client.get("/api/quran/surahs/1/arabic-verses")
        assert arabic.status_code == 200
        assert len(arabic.json()) == 3
        assert arabic.json()[0]["arabic"] == "Uthmani Arabic 1"
        assert all("quranenc.com" not in call for call in calls)
        german = client.get("/api/quran/surahs/1/translation-text?language=German")
        assert german.status_code == 200
        assert german.json()["source"] == "Al Quran Cloud"
        assert german.json()["edition"] == "de.bubenheim"
        assert german.json()["attribution"] == "Bubenheim & Elyas"
        assert german.json()["verses"][0] == {"ayah": 1, "text": "de.bubenheim 1"}
        assert client.get("/api/quran/surahs/1/arabic-verses").status_code == 200
        assert len([call for call in calls if "quran-uthmani" in call]) == 1
        combined = client.get("/api/quran/surahs/1/verses")
        assert combined.status_code == 200
        assert combined.json()[0]["translations"] == {
            "German": "de.bubenheim 1",
            "English": "en.sahih 1",
            "Urdu": "ur.junagarhi 1",
        }


def test_quranenc_503_does_not_hide_arabic_verses() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/surah/1/quran-uthmani":
            return _arabic_response()
        if request.url.path.startswith("/api/v1/translation/sura/"):
            return httpx.Response(503, json={"detail": "Service unavailable"})
        return httpx.Response(404)

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        arabic = client.get("/api/quran/surahs/1/arabic-verses")
        assert arabic.status_code == 200
        assert arabic.json()[1]["arabic"] == "Uthmani Arabic 2"
        assert client.get("/api/quran/surahs/1/translation-text?language=German").status_code == 503
        combined = client.get("/api/quran/surahs/1/verses")
        assert combined.status_code == 200
        assert combined.json()[0]["translations"] == {}


def test_arabic_uses_alternate_host_if_primary_provider_returns_503() -> None:
    visited: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        visited.append(request.url.host)
        if request.url.host == "api.alquran.cloud":
            return httpx.Response(503)
        if request.url.host == "alquran.api.islamic.network":
            return _arabic_response()
        return httpx.Response(404)

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        response = client.get("/api/quran/surahs/1/arabic-verses")
        assert response.status_code == 200
        assert response.json()[0]["arabic"] == "Uthmani Arabic 1"
        assert visited == ["api.alquran.cloud", "alquran.api.islamic.network"]


def test_invalid_written_translation_does_not_corrupt_arabic_source() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/surah/1/quran-uthmani":
            return _arabic_response()
        if request.url.path.startswith("/api/v1/translation/sura/"):
            return httpx.Response(
                200,
                json={"result": [{"aya": "2", "translation": "Out of order"}]},
            )
        return httpx.Response(404)

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        assert client.get("/api/quran/surahs/1/translation-text?language=German").status_code == 503
        assert client.get("/api/quran/surahs/1/arabic-verses").status_code == 200


def test_cloud_translation_works_even_if_quranenc_is_down() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        if request.url.path == "/v1/surah/2/de.bubenheim":
            return httpx.Response(
                200,
                json={
                    "code": 200,
                    "data": {
                        "number": 2,
                        "numberOfAyahs": 3,
                        "ayahs": [
                            {"numberInSurah": i, "text": f"Bubenheim {i}"} for i in range(1, 4)
                        ],
                    },
                },
            )
        if request.url.host == "quranenc.com":
            return httpx.Response(503)
        return httpx.Response(404)

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        response = client.get("/api/quran/surahs/2/translation-text?language=German")
        assert response.status_code == 200
        assert response.json()["source"] == "Al Quran Cloud"
        assert response.json()["verses"][2] == {"ayah": 3, "text": "Bubenheim 3"}
        assert "quranenc.com" not in calls


def test_quranenc_fallback_reports_correct_english_attribution() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "quranenc.com":
            return httpx.Response(
                200,
                json={
                    "result": [{"aya": str(i), "translation": f"Rowwad {i}"} for i in range(1, 4)]
                },
            )
        return httpx.Response(503)

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        response = client.get("/api/quran/surahs/1/translation-text?language=English")
        assert response.status_code == 200
        assert response.json()["edition"] == "english_rwwad"
        assert response.json()["source"] == "QuranEnc"
        assert response.json()["attribution"] == "Rowwad Translation Center"
        assert response.json()["verses"][1]["text"] == "Rowwad 2"
