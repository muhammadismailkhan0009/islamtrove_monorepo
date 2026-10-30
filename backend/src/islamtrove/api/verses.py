"""Verse text endpoint for the Quran reading companion."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response

from islamtrove.infrastructure.quranenc_text import QuranEncVerseSource, WrittenTranslation

router = APIRouter(prefix="/api/quran", tags=["Quran"])


def get_verse_source(request: Request) -> QuranEncVerseSource:
    return request.app.state.verse_source


@router.get("/surahs/{surah_id}/arabic-verses")
async def get_arabic_verses(
    response: Response,
    service: Annotated[QuranEncVerseSource, Depends(get_verse_source)],
    surah_id: Annotated[int, Path(ge=1, le=114)],
) -> list[dict[str, object]]:
    """Uthmani Arabic is independent of QuranEnc translations."""
    output = await service.arabic(surah_id)
    response.headers["Cache-Control"] = "public, max-age=86400"
    return output


@router.get("/surahs/{surah_id}/translation-text")
async def get_translation_text(
    response: Response,
    service: Annotated[QuranEncVerseSource, Depends(get_verse_source)],
    surah_id: Annotated[int, Path(ge=1, le=114)],
    language: Annotated[str, Query(min_length=2)],
) -> WrittenTranslation:
    """One attributed written translation; cannot block other languages or Arabic."""
    if language not in {"German", "English", "Urdu"}:
        raise HTTPException(status_code=422, detail="Unsupported written translation")
    output = await service.translation_details(surah_id, language)
    response.headers["Cache-Control"] = "public, max-age=86400"
    return output


@router.get("/surahs/{surah_id}/verses")
async def get_verses(
    response: Response,
    service: Annotated[QuranEncVerseSource, Depends(get_verse_source)],
    surah_id: Annotated[int, Path(ge=1, le=114)],
) -> list[dict[str, object]]:
    response.headers["Cache-Control"] = "public, max-age=86400"
    return await service.verses(surah_id)
