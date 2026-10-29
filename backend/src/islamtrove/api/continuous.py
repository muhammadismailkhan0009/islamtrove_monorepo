"""QUL Minshawi Mujawwad Surah recording and authoritative Ayah time ranges."""

from collections.abc import Mapping

import httpx
from fastapi import APIRouter, HTTPException, Path, Request

router = APIRouter(prefix="/api/quran", tags=["Quran"])
_QUL_ENDPOINT = "https://qul.tarteel.ai/api/v1/audio/surah_segments/8"
_CDN_PREFIX = "https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/"


def validate_qul(surah_id: int, payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("QUL response must be an object")
    audio, segments = payload.get("audio"), payload.get("segments")
    if not isinstance(audio, dict) or not isinstance(segments, dict):
        raise ValueError("QUL metadata is missing audio/segments")
    url = audio.get("url")
    if url != f"{_CDN_PREFIX}{surah_id:03d}.mp3":
        raise ValueError("QUL recitation URL is unexpected")
    if not 1 <= len(segments) <= 286:
        raise ValueError("Invalid Ayah count")
    previous = 0
    timings = []
    for ayah in range(1, len(segments) + 1):
        entry = segments.get(f"{surah_id}:{ayah}")
        if not isinstance(entry, Mapping):
            raise ValueError("Missing Ayah timestamp")
        start, end = entry.get("time_from"), entry.get("time_to")
        if (
            type(start) is not int
            or type(end) is not int
            or start < 0
            or end <= start
            or start < previous
            or end > 86_400_000
        ):
            raise ValueError("Invalid Ayah interval")
        timings.append({"ayah": ayah, "fromMs": start, "toMs": end})
        previous = end
    playback_url = (
        "https://everyayah.com/data/Minshawy_Mujawwad_192kbps/PageMp3s/Page001.mp3"
        if surah_id == 1
        else url
    )
    return {"surahId": surah_id, "audioUrl": playback_url, "timings": timings, "endMs": previous}


@router.get("/surahs/{surah_id}/continuous-recitation")
async def continuous_recitation(request: Request, surah_id: int = Path(ge=1, le=114)) -> dict:
    cache: dict[int, dict] = request.app.state.continuous_cache
    cached = cache.get(surah_id)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(18),
            follow_redirects=False,
            transport=getattr(request.app.state, "media_transport", None),
        ) as client:
            response = await client.get(_QUL_ENDPOINT, params={"surah": surah_id, "per_page": 300})
            response.raise_for_status()
        parsed = validate_qul(surah_id, response.json())
        # Verify the Quran's expected Ayah count via existing catalog if readily available
        # rather than trusting a truncated upstream response.
        service = request.app.state.quran_service
        surahs = await service.surahs()
        if len(parsed["timings"]) != surahs[surah_id - 1].ayahCount:
            raise ValueError("QUL metadata does not cover the whole Surah")
    except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=502, detail="QUL Ayah timestamps unavailable") from exc
    cache[surah_id] = parsed
    return parsed
