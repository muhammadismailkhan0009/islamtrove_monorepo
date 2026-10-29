"""Shared test fixtures use HTTPX MockTransport: no external calls or Docker needed."""

from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from islamtrove.main import create_app


def _surah(number: int) -> dict[str, object]:
    count = 7 if number == 1 else 4 if number == 112 else 3
    return {
        "number": number,
        "name": "الفاتحة" if number == 1 else "سورة",
        "englishName": "Al-Fatiha" if number == 1 else f"Surah {number}",
        "englishNameTranslation": "The Opening" if number == 1 else f"Chapter {number}",
        "numberOfAyahs": count,
        "revelationType": "Meccan",
    }


def _reply(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/v1/surah":
        data = [_surah(i) for i in range(1, 115)]
    elif path.startswith("/v1/surah/"):
        parts = path.split("/")
        surah_id, edition = int(parts[3]), parts[4]
        surah = _surah(surah_id)
        count = surah["numberOfAyahs"]
        assert isinstance(count, int)
        data = {
            "number": surah_id,
            "numberOfAyahs": count,
            "ayahs": [
                {
                    "numberInSurah": i,
                    "audio": f"https://cdn.islamic.network/quran/audio/128/{edition}/{i}.mp3",
                }
                for i in range(1, count + 1)
            ],
        }
    else:
        return httpx.Response(404, json={"message": "not found"})
    return httpx.Response(200, json={"code": 200, "status": "OK", "data": data})


@pytest.fixture
def provider_reply() -> Callable[[httpx.Request], httpx.Response]:
    return _reply


@pytest.fixture
def client(provider_reply: Callable[[httpx.Request], httpx.Response]):
    with TestClient(create_app(transport=httpx.MockTransport(provider_reply))) as test_client:
        yield test_client
