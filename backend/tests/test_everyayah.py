from unittest.mock import AsyncMock

import pytest
from pydantic import HttpUrl

from islamtrove.domain.models import AyahAudio
from islamtrove.infrastructure.everyayah import EveryAyahAudioSource


@pytest.mark.asyncio
async def test_minshawi_mujawwad_uses_distinct_everyayah_files() -> None:
    upstream = AsyncMock()
    upstream.list_ayah_audio.return_value = [
        AyahAudio(ayah=n, url=HttpUrl(f"https://cdn.islamic.network/audio/{n}.mp3"))
        for n in range(1, 8)
    ]
    source = EveryAyahAudioSource(upstream)

    result = await source.list_ayah_audio(1, "ar.minshawimujawwad")

    assert len(result) == 7
    assert str(result[0].url) == ("https://everyayah.com/data/Minshawy_Mujawwad_192kbps/001001.mp3")
    assert str(result[-1].url).endswith("/001007.mp3")
    upstream.list_ayah_audio.assert_awaited_once_with(1, "ar.minshawimujawwad")


@pytest.mark.asyncio
async def test_everyayah_adapter_preserves_unrelated_reciters() -> None:
    upstream = AsyncMock()
    original = [AyahAudio(ayah=1, url=HttpUrl("https://cdn.islamic.network/ar/1.mp3"))]
    upstream.list_ayah_audio.return_value = original
    source = EveryAyahAudioSource(upstream)

    assert await source.list_ayah_audio(1, "ar.minshawi") == original
    upstream.list_ayah_audio.assert_awaited_once_with(1, "ar.minshawi")
