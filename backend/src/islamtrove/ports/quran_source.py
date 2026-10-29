"""Protocol is Python's equivalent of a Java interface."""

from typing import Protocol

from islamtrove.domain.models import AyahAudio, Surah


class QuranSource(Protocol):
    async def list_surahs(self) -> list[Surah]: ...

    async def list_ayah_audio(self, surah_id: int, edition_id: str) -> list[AyahAudio]: ...


class ProviderUnavailable(Exception):
    """Remote Quran provider cannot be reached or returned an HTTP failure."""


class ProviderDataError(Exception):
    """Remote Quran data cannot be trusted for playback."""
