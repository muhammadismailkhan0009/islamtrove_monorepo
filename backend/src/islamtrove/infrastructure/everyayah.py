"""Use distinct EveryAyah tracks for recitations missing from Al Quran Cloud.

Al Quran Cloud currently advertises a Minshawi Mujawwad edition but serves
identical audio bytes to its Murattal edition in verified sample Ayahs.
The EveryAyah dataset has a separate, distinct Mujawwad recording.

This decorator preserves the QuranSource protocol and uses the upstream
catalog's validated per-Ayah indexing to avoid guessing a Surah's length.
"""

from pydantic import HttpUrl

from islamtrove.domain.models import AyahAudio, Surah
from islamtrove.ports.quran_source import QuranSource

_MINSHAWI_MUJAWWAD = "ar.minshawimujawwad"
_EVERYAYAH_FOLDER = "Minshawy_Mujawwad_192kbps"


class EveryAyahAudioSource:
    """QuranSource adapter: replace only the Minshawi Mujawwad media files."""

    def __init__(self, primary: QuranSource) -> None:
        self._primary = primary

    async def list_surahs(self) -> list[Surah]:
        return await self._primary.list_surahs()

    async def list_ayah_audio(self, surah_id: int, edition_id: str) -> list[AyahAudio]:
        # Preserve the verified Al Quran Cloud index/coverage for every edition.
        ayahs = await self._primary.list_ayah_audio(surah_id, edition_id)
        if edition_id != _MINSHAWI_MUJAWWAD:
            return ayahs

        return [
            AyahAudio(
                ayah=ayah.ayah,
                url=HttpUrl(
                    f"https://everyayah.com/data/{_EVERYAYAH_FOLDER}/"
                    f"{surah_id:03d}{ayah.ayah:03d}.mp3"
                ),
            )
            for ayah in ayahs
        ]
