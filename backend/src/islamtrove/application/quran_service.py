"""Application use cases: independent of FastAPI and provider implementations."""

import asyncio

from islamtrove.domain.models import (
    RECITERS,
    TRANSLATIONS,
    AudioChoice,
    Surah,
    SurahAudio,
    TranslationAudioManifest,
    audio_options,
)
from islamtrove.ports.quran_source import (
    ProviderDataError,
    ProviderUnavailable,
    QuranSource,
    SpokenTranslationUnavailable,
)


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

    async def translation_audio(self, surah_id: int, language: str) -> TranslationAudioManifest:
        """Resolve a spoken translation alone, with no recitation request."""
        selected = _choose(language, TRANSLATIONS)
        try:
            catalog = await self.surahs()
            surah = next((item for item in catalog if item.id == surah_id), None)
            if surah is None:
                raise ProviderDataError("Unknown Quran Surah")
            audio = await self._source.list_ayah_audio(surah_id, selected.id)
        except (ProviderDataError, ProviderUnavailable) as exc:
            raise SpokenTranslationUnavailable(
                f"{selected.name} spoken translation unavailable"
            ) from exc
        actual = [item.ayah for item in audio]
        allowed = set(range(1, surah.ayahCount + 1))
        if (
            len(actual) != len(set(actual))
            or actual != sorted(actual)
            or any(item not in allowed for item in actual)
        ):
            raise SpokenTranslationUnavailable("Translation Ayah indexes are invalid")
        available = set(actual)
        unavailable = sorted(allowed - available)
        known_gaps = (
            [283, 284, 285, 286] if surah_id == 2 and selected.id == "de.bubenheim.nail" else []
        )
        if unavailable != known_gaps:
            raise SpokenTranslationUnavailable(
                "Translation audio contains unexpected missing Ayahs"
            )
        return TranslationAudioManifest(
            surahId=surah_id,
            language=selected,
            audio=audio,
            unavailableAyahs=unavailable,
        )

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

        unavailable: list[int] = []
        if translation_choice:
            arabic_numbers = [item.ayah for item in arabic]
            spoken_numbers = [item.ayah for item in spoken]
            spoken_set = set(spoken_numbers)
            # Translation audio can be sparse only for a documented, known gap.
            # All other incomplete, duplicated or reordered provider responses
            # continue to fail rather than silently skip an Ayah.
            unavailable = [ayah for ayah in arabic_numbers if ayah not in spoken_set]
            documented_missing = (
                [283, 284, 285, 286]
                if surah_id == 2 and translation_choice.id == "de.bubenheim.nail"
                else []
            )
            if (
                len(spoken_set) != len(spoken_numbers)
                or spoken_numbers != [ayah for ayah in arabic_numbers if ayah in spoken_set]
                or unavailable != documented_missing
            ):
                raise ProviderDataError("Recitation and translation Ayah indexes do not match")

        return SurahAudio(
            surahId=surah_id,
            reciter=reciter_choice,
            translation=translation_choice,
            recitation=arabic,
            translationAudio=spoken,
            unavailableTranslationAyahs=unavailable,
        )
