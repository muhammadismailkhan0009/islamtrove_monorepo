"""QUL Minshawi Mujawwad Surah recording and authoritative Ayah time ranges."""

import json
from collections.abc import Mapping
from pathlib import Path as LocalPath

import httpx
from fastapi import APIRouter, HTTPException, Path, Request

from islamtrove.api.stream import ANBIYA_AUDIO_URL

router = APIRouter(prefix="/api/quran", tags=["Quran"])
_QUL_ENDPOINT = "https://qul.tarteel.ai/api/v1/audio/surah_segments/8"
_CDN_PREFIX = "https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/"
_ALIGNMENT_DIRECTORY = LocalPath(__file__).resolve().parents[1] / "data" / "alignments"
_AYAH_COUNTS = json.loads(
    (LocalPath(__file__).resolve().parents[1] / "data" / "surah_ayah_counts.json").read_text()
)
# All 114 Surahs may have provisional timewarps. Runtime reads only local JSON;
# no audio analysis or matching is ever performed in the server.


def load_verified_alignment(surah_id: int) -> dict | None:
    """Use a recording-specific, offline-verified timeline when one exists.

    Never apply a correction to another source/reciter. Any invalid local
    alignment is a deployment error, not a reason to silently use wrong QUL
    boundaries. The source SHA256 is retained for regeneration/auditing; it
    is not fetched or rehashed on every browser request.
    """
    path = _ALIGNMENT_DIRECTORY / f"{surah_id:03d}.json"
    if not path.is_file():
        return None
    metadata = json.loads(path.read_text(encoding="utf-8"))
    if surah_id == 21:
        expected_url = ANBIYA_AUDIO_URL
    elif surah_id == 1:
        expected_url = "https://everyayah.com/data/Minshawy_Mujawwad_192kbps/PageMp3s/Page001.mp3"
    else:
        expected_url = f"{_CDN_PREFIX}{surah_id:03d}.mp3"
    allowed_statuses = (
        "experimental-cross-recording",
        "manually-reviewed",
        "automatically-verified",
        "qul-published",
    )
    entries = metadata.get("timings")
    if (
        metadata.get("schemaVersion") != 1
        or metadata.get("surahId") != surah_id
        or metadata.get("reciter") != "minshawi-mujawwad"
        or metadata.get("validationStatus") not in allowed_statuses
        or metadata.get("audioUrl") != expected_url
        or not isinstance(metadata.get("audioSha256"), str)
        or len(metadata["audioSha256"]) != 64
        or not isinstance(metadata.get("audioBytes"), int)
        or metadata["audioBytes"] <= 0
        or not isinstance(entries, list)
        or len(entries) != _AYAH_COUNTS[str(surah_id)]
    ):
        raise ValueError(f"Invalid local alignment metadata for Surah {surah_id}")
    previous = 0
    for number, entry in enumerate(entries, start=1):
        if (
            not isinstance(entry, dict)
            or entry.get("ayah") != number
            or type(entry.get("fromMs")) is not int
            or type(entry.get("toMs")) is not int
            or entry["fromMs"] != previous
            or entry["toMs"] <= previous
        ):
            raise ValueError(f"Invalid verified alignment at {surah_id}:{number}")
        previous = entry["toMs"]
    if (
        metadata.get("endMs") != previous
        or type(metadata.get("audioDurationMs")) is not int
        or previous > metadata["audioDurationMs"]
    ):
        raise ValueError(f"Verified alignment exceeds source audio for {surah_id}")
    return {"surahId": surah_id, "audioUrl": expected_url, "timings": entries, "endMs": previous}


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
    # Corrected, recording-specific Ayah times are static app data, generated
    # once offline. Serve them directly without refetching incorrect QUL data.
    try:
        aligned = request.app.state.review_store.effective(surah_id)
        if aligned is not None:
            cache[surah_id] = aligned
            return aligned
        if surah_id in (21, 55):
            # Ar-Rahman's mismatched source timestamps must not be used.
            raise HTTPException(
                status_code=503, detail="Recording-matched local timeline is missing"
            )
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Verified audio alignment is invalid") from exc
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
