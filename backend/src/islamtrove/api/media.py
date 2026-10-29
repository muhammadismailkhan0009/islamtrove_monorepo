"""Strict, read-only same-origin bridge for publicly hosted Quran MP3 recordings.

Browser fetch() cannot read blobs from CDNs that disallow CORS. This route is
restricted to the exact media sources and path formats used by IslamTrove.
Never use as a general-purpose URL proxy.
"""

import re
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

router = APIRouter(prefix="/api/quran", tags=["Quran"])

_ALLOWED_MEDIA = {
    "everyayah.com": re.compile(
        r"^/data/Minshawy_Mujawwad_192kbps/(?:\d{6}\.mp3|PageMp3s/Page001\.mp3)$"
    ),
    "cdn.islamic.network": re.compile(r"^/quran/audio/(?:64|192)/(?:en\.walk|ur\.khan)/\d+\.mp3$"),
    "anlayarakkuranokuyorum.com": re.compile(r"^/audio/de/\d{6}\.mp3$"),
    "audio-cdn.tarteel.ai": re.compile(r"^/quran/surah/minshawy/mujawwad/mp3/\d{3}\.mp3$"),
}
_MAX_AUDIO_BYTES = 20 * 1024 * 1024


def permitted_audio_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
        return (
            parsed.scheme == "https"
            and parsed.hostname in _ALLOWED_MEDIA
            and parsed.port is None
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
            and bool(_ALLOWED_MEDIA[parsed.hostname].fullmatch(parsed.path))
        )
    except ValueError:
        return False


@router.get("/media")
async def get_media(request: Request, url: str = Query(min_length=20, max_length=1024)) -> Response:
    if not permitted_audio_url(url):
        raise HTTPException(status_code=400, detail="Unsupported media URL")

    transport = getattr(request.app.state, "media_transport", None)
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(25.0), follow_redirects=False, transport=transport
        ) as client:
            async with client.stream("GET", url) as incoming:
                if incoming.status_code != 200:
                    raise HTTPException(status_code=502, detail="Audio source unavailable")
                media_type = incoming.headers.get("content-type", "").split(";")[0].strip()
                if media_type not in {
                    "audio/mpeg",
                    "audio/mp3",
                    "application/octet-stream",
                    "binary/octet-stream",
                }:
                    raise HTTPException(status_code=502, detail="Invalid audio source response")
                chunks: list[bytes] = []
                size = 0
                async for chunk in incoming.aiter_bytes():
                    size += len(chunk)
                    if size > _MAX_AUDIO_BYTES:
                        raise HTTPException(
                            status_code=413, detail="Audio exceeds the permitted size"
                        )
                    chunks.append(chunk)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Unable to fetch audio source") from exc
    return Response(
        content=b"".join(chunks),
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )
