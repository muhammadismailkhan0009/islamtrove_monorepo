from unittest.mock import AsyncMock

import pytest
from pydantic import HttpUrl

from islamtrove.application.quran_service import QuranService, UnknownAudioChoice
from islamtrove.domain.models import AyahAudio
from islamtrove.ports.quran_source import ProviderDataError


@pytest.mark.asyncio
async def test_mismatched_translation_ayahs_are_rejected() -> None:
    source = AsyncMock()
    source.list_ayah_audio.side_effect = [
        [AyahAudio(ayah=1, url=HttpUrl("https://cdn.islamic.network/ar/1.mp3"))],
        [AyahAudio(ayah=2, url=HttpUrl("https://cdn.islamic.network/ur/2.mp3"))],
    ]

    with pytest.raises(ProviderDataError, match="do not match"):
        await QuranService(source).surah_audio(1, "ar.alafasy", "ur.khan")


@pytest.mark.asyncio
async def test_recitation_only_does_not_fetch_translation() -> None:
    source = AsyncMock()
    source.list_ayah_audio.return_value = [
        AyahAudio(ayah=1, url=HttpUrl("https://cdn.islamic.network/ar/1.mp3"))
    ]
    result = await QuranService(source).surah_audio(1, "ar.alafasy", None)
    assert result.translation is None
    source.list_ayah_audio.assert_awaited_once_with(1, "ar.alafasy")


@pytest.mark.asyncio
async def test_unrecognized_reciter_raises_validation_error() -> None:
    service = QuranService(AsyncMock())
    with pytest.raises(UnknownAudioChoice):
        await service.surah_audio(1, "unknown", None)
