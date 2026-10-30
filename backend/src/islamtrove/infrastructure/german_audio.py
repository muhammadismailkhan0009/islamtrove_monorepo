"""German spoken Quran translation adapter.

The narration uses Bubenheim/Elyas wording, spoken by Nail ibn Radhan,
as served by Den Koran verstehen. Files follow SSSAAA.mp3, where both
numbers are three-digit and one-based.

Known missing recordings: Al-Baqarah 2:283–286. Return only recordings
actually available, and let the application explicitly report unavailable Ayahs.
Never generate links to nonexistent recordings.
"""

from pydantic import HttpUrl

from islamtrove.domain.models import AyahAudio, Surah
from islamtrove.ports.quran_source import QuranSource

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
        # The German recording is an independent audio source. Obtain the
        # canonical Ayah count from the catalog, NEVER from an Arabic MP3
        # manifest (which may be unavailable while translations still work).
        surahs = await self._primary.list_surahs()
        surah = next((item for item in surahs if item.id == surah_id), None)
        if surah is None:
            raise ValueError(f"Surah {surah_id} is not in the Quran catalog")
        return [
            AyahAudio(
                ayah=ayah,
                url=HttpUrl(
                    f"https://anlayarakkuranokuyorum.com/audio/de/{surah_id:03d}{ayah:03d}.mp3"
                ),
            )
            for ayah in range(1, surah.ayahCount + 1)
            if surah_id != 2 or ayah not in _MISSING_GERMAN_IN_AL_BAQARAH
        ]
