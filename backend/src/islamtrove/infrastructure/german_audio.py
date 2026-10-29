"""German spoken Quran translation adapter.

The narration uses Bubenheim/Elyas wording, spoken by Nail ibn Radhan,
as served by Den Koran verstehen. Files follow SSSAAA.mp3, where both
numbers are three-digit and one-based.

Known missing recordings: Al-Baqarah 2:283–286. The current audio contract
requires a complete Ayah list, so do not pretend that Surah 2 is complete.
"""

from pydantic import HttpUrl

from islamtrove.domain.models import AyahAudio, Surah
from islamtrove.ports.quran_source import ProviderDataError, QuranSource

_GERMAN_EDITION = "de.bubenheim.nail"
_MISSING_GERMAN_IN_AL_BAQARAH = {283, 284, 285, 286}


class GermanAudioSource:
    def __init__(self, primary: QuranSource) -> None:
        self._primary = primary

    async def list_surahs(self) -> list[Surah]:
        return await self._primary.list_surahs()

    async def list_ayah_audio(self, surah_id: int, edition_id: str) -> list[AyahAudio]:
        if edition_id != _GERMAN_EDITION:
            return await self._primary.list_ayah_audio(surah_id, edition_id)
        if surah_id == 2:
            raise ProviderDataError(
                "German audio is incomplete for Al-Baqarah (Ayahs 283–286 unavailable)"
            )
        # Resolve validated Ayah count from the primary Quran source.
        arabic = await self._primary.list_ayah_audio(surah_id, "ar.minshawimujawwad")
        return [
            AyahAudio(
                ayah=item.ayah,
                url=HttpUrl(
                    f"https://anlayarakkuranokuyorum.com/audio/de/{surah_id:03d}{item.ayah:03d}.mp3"
                ),
            )
            for item in arabic
        ]
