"""Independent Arabic Quran text and resilient written translations.

Primary written text: Al Quran Cloud's explicitly attributed editions.
Fallback: Al Quran Cloud's alternate host, then QuranEnc.
Spoken translations and recitation remain completely independent.
"""

import asyncio
from typing import TypedDict

import httpx

from islamtrove.ports.quran_source import ProviderDataError, ProviderUnavailable

_PRIMARY_EDITIONS = {
    "German": ("de.bubenheim", "Bubenheim & Elyas"),
    "English": ("en.sahih", "Saheeh International"),
    "Urdu": ("ur.jalandhry", "Fateh Muhammad Jalandhari"),
}
_QURANENC_EDITIONS = {
    "German": ("german_bubenheim", "Bubenheim & Elyas"),
    "English": ("english_rwwad", "Rowwad Translation Center"),
}


class WrittenTranslation(TypedDict):
    language: str
    source: str
    edition: str
    attribution: str
    verses: list[dict[str, object]]


def validate_arabic_payload(surah_id: int, payload: object) -> list[dict[str, object]]:
    if not isinstance(payload, dict) or payload.get("code") != 200:
        raise ProviderDataError("Arabic Quran text provider returned an invalid envelope")
    data = payload.get("data")
    if not isinstance(data, dict) or data.get("number") != surah_id:
        raise ProviderDataError("Arabic Quran text belongs to another Surah")
    ayahs = data.get("ayahs")
    count = data.get("numberOfAyahs")
    if (
        not isinstance(count, int)
        or not 1 <= count <= 286
        or not isinstance(ayahs, list)
        or len(ayahs) != count
    ):
        raise ProviderDataError("Arabic Quran verses are incomplete")
    result: list[dict[str, object]] = []
    for index, ayah in enumerate(ayahs, start=1):
        if (
            not isinstance(ayah, dict)
            or ayah.get("numberInSurah") != index
            or not isinstance(ayah.get("text"), str)
            or not ayah["text"].strip()
        ):
            raise ProviderDataError(f"Arabic Quran verse {surah_id}:{index} is invalid")
        result.append({"ayah": index, "arabic": ayah["text"]})
    return result


def validate_cloud_translation(
    surah_id: int, payload: object, expected_edition: str
) -> list[dict[str, object]]:
    """Validate independent Al Quran Cloud translated edition per Surah."""
    if not isinstance(payload, dict) or payload.get("code") != 200:
        raise ProviderDataError("Al Quran Cloud translation returned an invalid envelope")
    data = payload.get("data")
    if not isinstance(data, dict) or data.get("number") != surah_id:
        raise ProviderDataError("Al Quran Cloud translation belongs to another Surah")
    # Protect attribution: an upstream edition mismatch must never be labeled
    # with the requested translator's name.
    edition = data.get("edition")
    if edition is not None and (
        not isinstance(edition, dict) or edition.get("identifier") != expected_edition
    ):
        raise ProviderDataError("Al Quran Cloud returned a different translation edition")
    ayahs, count = data.get("ayahs"), data.get("numberOfAyahs")
    if (
        not isinstance(count, int)
        or not 1 <= count <= 286
        or not isinstance(ayahs, list)
        or len(ayahs) != count
    ):
        raise ProviderDataError("Al Quran Cloud translation is incomplete")
    verses: list[dict[str, object]] = []
    for index, ayah in enumerate(ayahs, start=1):
        if (
            not isinstance(ayah, dict)
            or ayah.get("numberInSurah") != index
            or not isinstance(ayah.get("text"), str)
            or not ayah["text"].strip()
        ):
            raise ProviderDataError(f"Al Quran Cloud translation Ayah {index} is invalid")
        verses.append({"ayah": index, "text": ayah["text"]})
    return verses


def validate_translation_payload(language: str, payload: object) -> list[dict[str, object]]:
    """QuranEnc fallback uses its own Ayah numbering contract."""
    if not isinstance(payload, dict):
        raise ProviderDataError(f"QuranEnc {language} response is invalid")
    verses = payload.get("result")
    if not isinstance(verses, list) or not 1 <= len(verses) <= 286:
        raise ProviderDataError(f"QuranEnc {language} translation is incomplete")
    result: list[dict[str, object]] = []
    for index, ayah in enumerate(verses, start=1):
        if (
            not isinstance(ayah, dict)
            or str(ayah.get("aya", "")) != str(index)
            or not isinstance(ayah.get("translation"), str)
            or not ayah["translation"].strip()
        ):
            raise ProviderDataError(f"QuranEnc {language} Ayah {index} is invalid")
        result.append({"ayah": index, "text": ayah["translation"]})
    return result


class QuranEncVerseSource:
    def __init__(
        self,
        translation_client: httpx.AsyncClient,
        arabic_client: httpx.AsyncClient,
        arabic_fallback_client: httpx.AsyncClient,
    ) -> None:
        self._quranenc = translation_client
        self._arabic_primary = arabic_client
        self._arabic_fallback = arabic_fallback_client
        self._arabic_cache: dict[int, list[dict[str, object]]] = {}
        self._translation_cache: dict[tuple[int, str], WrittenTranslation] = {}
        self._arabic_pending: dict[int, asyncio.Task[list[dict[str, object]]]] = {}
        self._translation_pending: dict[tuple[int, str], asyncio.Task[WrittenTranslation]] = {}

    async def _load_arabic(self, surah_id: int) -> list[dict[str, object]]:
        errors: list[Exception] = []
        for client in (self._arabic_primary, self._arabic_fallback):
            try:
                response = await client.get(f"/surah/{surah_id}/quran-uthmani")
                response.raise_for_status()
                return validate_arabic_payload(surah_id, response.json())
            except (httpx.HTTPError, ValueError, ProviderDataError) as exc:
                errors.append(exc)
        raise ProviderUnavailable(
            "Arabic Uthmani Quran text unavailable from both sources"
        ) from errors[-1]

    async def arabic(self, surah_id: int) -> list[dict[str, object]]:
        cached = self._arabic_cache.get(surah_id)
        if cached is not None:
            return cached
        task = self._arabic_pending.get(surah_id)
        if task is None:
            task = asyncio.create_task(self._load_arabic(surah_id))
            self._arabic_pending[surah_id] = task
        try:
            result = await asyncio.shield(task)
            self._arabic_cache[surah_id] = result
            return result
        finally:
            if task.done() and self._arabic_pending.get(surah_id) is task:
                self._arabic_pending.pop(surah_id, None)

    async def _load_translation(self, surah_id: int, language: str) -> WrittenTranslation:
        primary_edition, primary_attribution = _PRIMARY_EDITIONS[language]
        errors: list[Exception] = []
        # The two publicly documented Al Quran Cloud hosts expose the same
        # edition IDs. Try the source we already use for Arabic first.
        for client in (self._arabic_primary, self._arabic_fallback):
            try:
                response = await client.get(f"/surah/{surah_id}/{primary_edition}")
                response.raise_for_status()
                verses = validate_cloud_translation(surah_id, response.json(), primary_edition)
                return {
                    "language": language,
                    "source": "Al Quran Cloud",
                    "edition": primary_edition,
                    "attribution": primary_attribution,
                    "verses": verses,
                }
            except (httpx.HTTPError, ValueError, ProviderDataError) as exc:
                errors.append(exc)

        # No unrelated Urdu translator fallback: the display must remain
        # Jalandhari, including when both Al Quran Cloud hosts are unavailable.
        if language not in _QURANENC_EDITIONS:
            raise ProviderUnavailable(
                f"{language} written translation ({primary_attribution}) unavailable"
            ) from errors[-1]

        # Other languages retain their independently attributed QuranEnc fallback.
        quranenc_edition, quranenc_attribution = _QURANENC_EDITIONS[language]
        try:
            response = await self._quranenc.get(
                f"/api/v1/translation/sura/{quranenc_edition}/{surah_id}"
            )
            response.raise_for_status()
            verses = validate_translation_payload(language, response.json())
            return {
                "language": language,
                "source": "QuranEnc",
                "edition": quranenc_edition,
                "attribution": quranenc_attribution,
                "verses": verses,
            }
        except (httpx.HTTPError, ValueError, ProviderDataError) as exc:
            errors.append(exc)

        raise ProviderUnavailable(
            f"{language} written translation unavailable from all configured providers"
        ) from errors[-1]

    async def translation_details(self, surah_id: int, language: str) -> WrittenTranslation:
        if language not in _PRIMARY_EDITIONS:
            raise ValueError("Unsupported written translation language")
        key = (surah_id, language)
        cached = self._translation_cache.get(key)
        if cached is not None:
            return cached
        task = self._translation_pending.get(key)
        if task is None:
            task = asyncio.create_task(self._load_translation(surah_id, language))
            self._translation_pending[key] = task
        try:
            result = await asyncio.shield(task)
            self._translation_cache[key] = result
            return result
        finally:
            if task.done() and self._translation_pending.get(key) is task:
                self._translation_pending.pop(key, None)

    async def translation(self, surah_id: int, language: str) -> list[dict[str, object]]:
        """Compatibility helper: returns only numbered Ayahs."""
        return (await self.translation_details(surah_id, language))["verses"]

    async def verses(self, surah_id: int) -> list[dict[str, object]]:
        """Legacy aggregate: Arabic succeeds even if a translation fails."""
        arabic = await self.arabic(surah_id)
        responses = await asyncio.gather(
            *(self.translation_details(surah_id, lang) for lang in _PRIMARY_EDITIONS),
            return_exceptions=True,
        )
        return [
            {
                "ayah": row["ayah"],
                "arabic": row["arabic"],
                "translations": {
                    language: response["verses"][index]["text"]
                    for language, response in zip(_PRIMARY_EDITIONS, responses, strict=True)
                    if isinstance(response, dict) and len(response["verses"]) == len(arabic)
                },
            }
            for index, row in enumerate(arabic)
        ]
