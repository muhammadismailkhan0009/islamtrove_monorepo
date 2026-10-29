import httpx
import pytest
from fastapi.testclient import TestClient

from islamtrove.main import create_app


def test_health_does_not_require_a_provider(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_catalog_matches_existing_angular_contract(client: TestClient) -> None:
    response = client.get("/api/quran/surahs")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 114
    assert payload[0] == {
        "id": 1,
        "name": "Al-Fatiha",
        "meaning": "The Opening",
        "arabicName": "الفاتحة",
        "revelation": "Meccan",
        "ayahCount": 7,
    }
    assert response.headers["cache-control"] == "public, max-age=3600"


def test_options_include_stable_ids_and_frontend_display_names(client: TestClient) -> None:
    response = client.get("/api/quran/audio-options")
    assert response.status_code == 200
    options = response.json()
    assert options["reciters"][0] == "Mishary Rashid Alafasy"
    assert options["translationLanguages"] == ["Urdu", "English", "German"]
    assert options["translationOptions"][0] == {
        "id": "ur.khan",
        "name": "Urdu",
        "attribution": "Shamshad Ali Khan",
    }


def test_audio_returns_ordered_per_ayah_urls_for_both_editions(client: TestClient) -> None:
    response = client.get(
        "/api/quran/surahs/1/audio",
        params={"reciter": "Mishary Rashid Alafasy", "translation": "Urdu"},
    )
    assert response.status_code == 200
    audio = response.json()
    assert audio["surahId"] == 1
    assert audio["reciter"]["id"] == "ar.alafasy"
    assert audio["translation"]["id"] == "ur.khan"
    assert [item["ayah"] for item in audio["recitation"]] == list(range(1, 8))
    assert [item["ayah"] for item in audio["translationAudio"]] == list(range(1, 8))
    assert audio["translationAudio"][0]["url"].endswith("/ur.khan/1.mp3")


def test_audio_can_be_recitation_only(client: TestClient) -> None:
    response = client.get("/api/quran/surahs/112/audio", params={"reciter": "ar.alafasy"})
    assert response.status_code == 200
    audio = response.json()
    assert audio["translation"] is None
    assert audio["translationAudio"] == []
    assert len(audio["recitation"]) == 4


def test_unknown_edition_is_rejected_without_querying_provider(client: TestClient) -> None:
    response = client.get("/api/quran/surahs/1/audio", params={"reciter": "not-a-reciter"})
    assert response.status_code == 422
    assert "Unknown audio selection" in response.json()["detail"]


def test_unknown_translation_is_rejected(client: TestClient) -> None:
    response = client.get("/api/quran/surahs/1/audio", params={"translation": "Arabic"})
    assert response.status_code == 422


def test_invalid_surah_id_is_rejected(client: TestClient) -> None:
    for number in (0, 115):
        response = client.get(f"/api/quran/surahs/{number}/audio")
        assert response.status_code == 422


def test_cors_for_local_design_preview(client: TestClient) -> None:
    response = client.options(
        "/api/quran/audio-options",
        headers={
            "origin": "http://127.0.0.1:43267",
            "access-control-request-method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:43267"


def test_provider_http_failure_returns_503() -> None:
    def failing(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"status": "error"})

    with TestClient(create_app(transport=httpx.MockTransport(failing))) as test_client:
        response = test_client.get("/api/quran/surahs")
        assert response.status_code == 503
        assert response.json() == {"detail": "Quran provider unavailable"}


def test_bad_provider_shape_returns_502() -> None:
    def invalid(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 200, "status": "OK", "data": []})

    with TestClient(create_app(transport=httpx.MockTransport(invalid))) as test_client:
        response = test_client.get("/api/quran/surahs")
        assert response.status_code == 502


def test_provider_cannot_return_untrusted_media_url(provider_reply) -> None:
    def malicious(request: httpx.Request) -> httpx.Response:
        response = provider_reply(request)
        value = response.json()
        if "/ar.alafasy" in request.url.path:
            value["data"]["ayahs"][0]["audio"] = "https://example.attacker.invalid/x.mp3"
        return httpx.Response(200, json=value)

    with TestClient(create_app(transport=httpx.MockTransport(malicious))) as test_client:
        response = test_client.get("/api/quran/surahs/1/audio")
        assert response.status_code == 502


def test_provider_out_of_order_audio_returns_502(provider_reply) -> None:
    def out_of_order(request: httpx.Request) -> httpx.Response:
        response = provider_reply(request)
        value = response.json()
        if "/ar.alafasy" in request.url.path:
            value["data"]["ayahs"][1]["numberInSurah"] = 3
        return httpx.Response(200, json=value)

    with TestClient(create_app(transport=httpx.MockTransport(out_of_order))) as test_client:
        response = test_client.get("/api/quran/surahs/1/audio")
        assert response.status_code == 502


def test_wrong_upstream_audio_count_returns_502(provider_reply) -> None:
    def missing(request: httpx.Request) -> httpx.Response:
        response = provider_reply(request)
        value = response.json()
        if "/ar.alafasy" in request.url.path:
            value["data"]["ayahs"].pop()
        return httpx.Response(200, json=value)

    with TestClient(create_app(transport=httpx.MockTransport(missing))) as test_client:
        response = test_client.get("/api/quran/surahs/1/audio")
        assert response.status_code == 502


@pytest.mark.parametrize(
    ("reciter_name", "edition_id"),
    [
        ("Muhammad Siddiq Al-Minshawi (Murattal)", "ar.minshawi"),
        ("Muhammad Siddiq Al-Minshawi (Mujawwad)", "ar.minshawimujawwad"),
    ],
)
def test_minshawi_recitations_are_in_options_and_resolve_per_ayah(
    client: TestClient, reciter_name: str, edition_id: str
) -> None:
    options = client.get("/api/quran/audio-options").json()
    assert reciter_name in options["reciters"]
    assert any(item["id"] == edition_id for item in options["reciterOptions"])

    result = client.get(
        "/api/quran/surahs/1/audio",
        params={"reciter": reciter_name, "translation": "Urdu"},
    )
    assert result.status_code == 200
    audio = result.json()
    assert audio["reciter"]["id"] == edition_id
    assert [ayah["ayah"] for ayah in audio["recitation"]] == list(range(1, 8))
    if edition_id == "ar.minshawimujawwad":
        assert audio["recitation"][0]["url"].endswith("/Minshawy_Mujawwad_192kbps/001001.mp3")
    else:
        assert edition_id in audio["recitation"][0]["url"]
    assert len(audio["translationAudio"]) == 7
