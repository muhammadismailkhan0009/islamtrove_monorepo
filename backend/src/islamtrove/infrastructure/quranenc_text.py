"""QuranEnc Arabic and German/English/Urdu verse texts for the reading pane.

This is distinct from audio narration: displayed translations are attributed to
their QuranEnc editions and need not be verbatim audio transcripts.
"""

import asyncio

import httpx

from islamtrove.ports.quran_source import ProviderDataError, ProviderUnavailable

_TEXT_EDITIONS = {
    "German": "german_bubenheim",
    "English": "english_rwwad",
    "Urdu": "urdu_junagarhi",
}


class QuranEncVerseSource:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client
        self._cache: dict[int, list[dict[str, object]]] = {}
        self._lock = asyncio.Lock()

    async def _language(self, surah_id: int, edition: str) -> list[dict]:
        try:
            response = await self._client.get(f"/api/v1/translation/sura/{edition}/{surah_id}")
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderUnavailable("QuranEnc verse text temporarily unavailable") from exc
        verses = payload.get("result") if isinstance(payload, dict) else None
        if not isinstance(verses, list) or not 1 <= len(verses) <= 286:
            raise ProviderDataError("QuranEnc verse text is incomplete")
        for index, entry in enumerate(verses, start=1):
            if (
                not isinstance(entry, dict)
                or str(entry.get("aya", "")) != str(index)
                or not isinstance(entry.get("translation"), str)
                or not isinstance(entry.get("arabic_text"), str)
                or not entry["translation"].strip()
                or not entry["arabic_text"].strip()
            ):
                raise ProviderDataError("QuranEnc verse text is invalid or out of order")
        return verses

    async def verses(self, surah_id: int) -> list[dict[str, object]]:
        cached = self._cache.get(surah_id)
        if cached is not None:
            return cached
        async with self._lock:
            cached = self._cache.get(surah_id)
            if cached is not None:
                return cached
            values = await asyncio.gather(
                *(self._language(surah_id, code) for code in _TEXT_EDITIONS.values())
            )
            count = len(values[0])
            if any(len(items) != count for items in values):
                raise ProviderDataError("QuranEnc translations use inconsistent Ayah counts")
            output = [
                {
                    "ayah": ayah,
                    "arabic": values[0][ayah - 1]["arabic_text"],
                    "translations": {
                        language: values[k][ayah - 1]["translation"]
                        for k, language in enumerate(_TEXT_EDITIONS)
                    },
                }
                for ayah in range(1, count + 1)
            ]
            self._cache[surah_id] = output
            return output
