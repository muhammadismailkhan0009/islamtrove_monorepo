"""HTTPX adapter for Al Quran Cloud metadata and verse-by-verse audio."""

from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, HttpUrl, TypeAdapter, ValidationError

from islamtrove.domain.models import AyahAudio, Surah
from islamtrove.ports.quran_source import ProviderDataError, ProviderUnavailable


class _RemoteSurah(BaseModel):
    number: int
    name: str
    englishName: str
    englishNameTranslation: str
    numberOfAyahs: int
    revelationType: str


class _RemoteAyah(BaseModel):
    numberInSurah: int
    audio: HttpUrl


class _RemoteAudioSurah(BaseModel):
    number: int
    numberOfAyahs: int
    ayahs: list[_RemoteAyah]


class _Envelope(BaseModel):
    code: int
    status: str
    data: object


_REMOTE_SURAHS = TypeAdapter(list[_RemoteSurah])
_ALLOWED_CDN_HOSTS = frozenset({"cdn.islamic.network", "cdn.alislam.ru"})


class AlQuranCloudSource:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def _request(self, path: str) -> object:
        try:
            response = await self._client.get(path)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderUnavailable("Quran audio provider is temporarily unavailable") from exc

        try:
            envelope = _Envelope.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise ProviderDataError("Quran provider returned an invalid response") from exc
        if envelope.code != 200 or envelope.status != "OK":
            raise ProviderDataError("Quran provider reported an unexpected response")
        return envelope.data

    async def list_surahs(self) -> list[Surah]:
        data = await self._request("/surah")
        try:
            items = _REMOTE_SURAHS.validate_python(data)
            result = [
                Surah(
                    id=item.number,
                    name=item.englishName,
                    meaning=item.englishNameTranslation,
                    arabicName=item.name,
                    revelation=item.revelationType,
                    ayahCount=item.numberOfAyahs,
                )
                for item in items
            ]
        except (ValueError, ValidationError) as exc:
            raise ProviderDataError("Quran catalog contains invalid Surah data") from exc
        if len(result) != 114 or [item.id for item in result] != list(range(1, 115)):
            raise ProviderDataError("Quran catalog is incomplete or out of order")
        return result

    async def list_ayah_audio(self, surah_id: int, edition_id: str) -> list[AyahAudio]:
        # Edition IDs come from an explicit server-side allowlist, never arbitrary URLs.
        data = await self._request(f"/surah/{surah_id}/{edition_id}")
        try:
            surah = _RemoteAudioSurah.model_validate(data)
        except (ValueError, ValidationError) as exc:
            raise ProviderDataError("Quran audio response has invalid structure") from exc

        if surah.number != surah_id or len(surah.ayahs) != surah.numberOfAyahs:
            raise ProviderDataError("Quran audio is incomplete or belongs to a different Surah")
        if not 1 <= surah.numberOfAyahs <= 286:
            raise ProviderDataError("Quran audio Ayah count is invalid")

        result: list[AyahAudio] = []
        for expected, ayah in enumerate(surah.ayahs, start=1):
            url = str(ayah.audio)
            parsed = urlparse(url)
            if ayah.numberInSurah != expected:
                raise ProviderDataError("Quran audio Ayahs are missing or out of order")
            if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_CDN_HOSTS:
                raise ProviderDataError("Quran audio URL points to an untrusted host")
            result.append(AyahAudio(ayah=expected, url=ayah.audio))
        return result
