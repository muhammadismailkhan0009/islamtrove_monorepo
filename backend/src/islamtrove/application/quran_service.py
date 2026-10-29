"""Application use cases: independent of FastAPI and provider implementations."""

import asyncio

from islamtrove.domain.models import (
    RECITERS,
    TRANSLATIONS,
    AudioChoice,
    Surah,
    SurahAudio,
    audio_options,
)
from islamtrove.ports.quran_source import ProviderDataError, QuranSource


class UnknownAudioChoice(ValueError):
    pass


def _choose(value: str, choices: tuple[AudioChoice, ...]) -> AudioChoice:
    normalized = value.casefold().strip()
    for choice in choices:
        if choice.id.casefold() == normalized or choice.name.casefold() == normalized:
            return choice
    raise UnknownAudioChoice(f"Unknown audio selection: {value}")


class QuranService:
    def __init__(self, source: QuranSource) -> None:
        self._source = source

    async def surahs(self) -> list[Surah]:
        return await self._source.list_surahs()

    def options(self):
        return audio_options()

    async def surah_audio(
        self,
        surah_id: int,
        reciter: str,
        translation: str | None,
    ) -> SurahAudio:
        reciter_choice = _choose(reciter, RECITERS)
        translation_choice = _choose(translation, TRANSLATIONS) if translation else None

        arabic_task = self._source.list_ayah_audio(surah_id, reciter_choice.id)
        if translation_choice is None:
            arabic = await arabic_task
            spoken = []
        else:
            arabic, spoken = await asyncio.gather(
                arabic_task,
                self._source.list_ayah_audio(surah_id, translation_choice.id),
            )

        if translation_choice and [a.ayah for a in arabic] != [a.ayah for a in spoken]:
            raise ProviderDataError("Recitation and translation Ayah indexes do not match")

        return SurahAudio(
            surahId=surah_id,
            reciter=reciter_choice,
            translation=translation_choice,
            recitation=arabic,
            translationAudio=spoken,
        )
