"""Verse text endpoint for the Quran reading companion."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, Response

from islamtrove.infrastructure.quranenc_text import QuranEncVerseSource

router = APIRouter(prefix="/api/quran", tags=["Quran"])


def get_verse_source(request: Request) -> QuranEncVerseSource:
    return request.app.state.verse_source


@router.get("/surahs/{surah_id}/verses")
async def get_verses(
    response: Response,
    service: Annotated[QuranEncVerseSource, Depends(get_verse_source)],
    surah_id: Annotated[int, Path(ge=1, le=114)],
) -> list[dict[str, object]]:
    response.headers["Cache-Control"] = "public, max-age=86400"
    return await service.verses(surah_id)
