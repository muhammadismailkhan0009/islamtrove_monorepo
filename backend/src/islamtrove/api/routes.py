"""REST API matching the approved Angular production port contracts."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response

from islamtrove.application.quran_service import QuranService
from islamtrove.domain.models import AudioOptions, Surah, SurahAudio

router = APIRouter(prefix="/api/quran", tags=["Quran"])


def get_service(request: Request) -> QuranService:
    return request.app.state.quran_service


@router.get("/surahs", response_model=list[Surah])
async def list_surahs(
    response: Response,
    service: Annotated[QuranService, Depends(get_service)],
) -> list[Surah]:
    response.headers["Cache-Control"] = "public, max-age=3600"
    return await service.surahs()


@router.get("/audio-options", response_model=AudioOptions)
async def get_audio_options(
    response: Response,
    service: Annotated[QuranService, Depends(get_service)],
) -> AudioOptions:
    response.headers["Cache-Control"] = "public, max-age=86400"
    return service.options()


@router.get("/surahs/{surah_id}/audio", response_model=SurahAudio)
async def get_surah_audio(
    response: Response,
    service: Annotated[QuranService, Depends(get_service)],
    surah_id: Annotated[int, Path(ge=1, le=114)],
    reciter: Annotated[str, Query(min_length=1)] = "Mishary Rashid Alafasy",
    translation: Annotated[str | None, Query()] = None,
) -> SurahAudio:
    response.headers["Cache-Control"] = "public, max-age=3600"
    return await service.surah_audio(surah_id, reciter, translation)
