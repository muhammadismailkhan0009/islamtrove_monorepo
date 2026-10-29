"""Progressive, range-aware proxy for the approved continuous Minshawi MP3s.

Never buffers the complete upstream response. The frontend service worker
requests small, independently reusable byte ranges and stores them in IndexedDB.
Native media playback works through this endpoint even when no SW is active.
"""

import re
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

router = APIRouter(prefix="/api/quran", tags=["Quran"])

_QUL_MP3 = re.compile(
    r"^/quran/surah/minshawy/mujawwad/mp3/(?:00[1-9]|0[1-9]\d|10\d|11[0-4])\.mp3$"
)
_RANGE = re.compile(r"^bytes=(\d+)-(\d*)$")
_MIME = {"audio/mpeg", "audio/mp3", "application/octet-stream", "binary/octet-stream"}


def approved_stream_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
        return (
            parts.scheme == "https"
            and parts.hostname == "audio-cdn.tarteel.ai"
            and parts.port is None
            and parts.username is None
            and parts.password is None
            and not parts.query
            and not parts.fragment
            and bool(_QUL_MP3.fullmatch(parts.path))
        )
    except ValueError:
        return False


@router.head("/stream")
async def stream_metadata(
    request: Request, url: str = Query(min_length=40, max_length=1024)
) -> Response:
    """Mobile media players may ask for length/range support before GET."""
    if not approved_stream_url(url):
        raise HTTPException(status_code=400, detail="Unsupported continuous audio source")
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15),
            follow_redirects=False,
            transport=getattr(request.app.state, "media_transport", None),
        ) as client:
            upstream = await client.head(url)
            if upstream.status_code != 200:
                raise HTTPException(status_code=502, detail="Audio source metadata unavailable")
            mime = upstream.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if mime not in _MIME:
                raise HTTPException(
                    status_code=502, detail="Audio source returned non-audio metadata"
                )
            headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
            for name in ("Content-Length", "ETag", "Last-Modified"):
                if upstream.headers.get(name):
                    headers[name] = upstream.headers[name]
            return Response(status_code=200, headers=headers, media_type="audio/mpeg")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Audio source metadata unavailable") from exc


@router.get("/stream")
async def stream_recitation(
    request: Request,
    url: str = Query(min_length=40, max_length=1024),
) -> StreamingResponse:
    if not approved_stream_url(url):
        raise HTTPException(status_code=400, detail="Unsupported continuous audio source")

    requested_range = request.headers.get("range")
    start = 0
    upstream_headers = {"Accept": "audio/mpeg, application/octet-stream"}
    if requested_range is not None:
        match = _RANGE.fullmatch(requested_range.strip())
        if match is None:
            raise HTTPException(
                status_code=416, detail="Only single numeric byte ranges are supported"
            )
        start, end = int(match.group(1)), match.group(2)
        if start < 0 or (end and int(end) < start):
            raise HTTPException(status_code=416, detail="Invalid requested byte range")
        upstream_headers["Range"] = f"bytes={start}-{end}"

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=15.0, read=45.0, write=20.0, pool=10.0),
        follow_redirects=False,
        transport=getattr(request.app.state, "media_transport", None),
    )
    upstream: httpx.Response | None = None
    try:
        upstream = await client.send(
            client.build_request("GET", url, headers=upstream_headers), stream=True
        )
        if upstream.status_code == 416:
            raise HTTPException(status_code=416, detail="Requested audio range unavailable")
        expected_status = 206 if requested_range else 200
        if upstream.status_code != expected_status:
            raise HTTPException(
                status_code=502, detail="Audio source does not support requested range"
            )
        mime = upstream.headers.get("content-type", "").split(";")[0].strip().lower()
        if mime not in _MIME:
            raise HTTPException(status_code=502, detail="Audio source returned non-audio bytes")
        headers = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        }
        for name in ("Content-Range", "Content-Length", "ETag", "Last-Modified"):
            value = upstream.headers.get(name)
            if value:
                headers[name] = value
        if requested_range:
            content_range = headers.get("Content-Range", "")
            if not re.fullmatch(r"bytes \d+-\d+/\d+", content_range):
                raise HTTPException(
                    status_code=502, detail="Audio source returned invalid range metadata"
                )
            returned_start = int(content_range.split(" ", 1)[1].split("-", 1)[0])
            if returned_start != start:
                raise HTTPException(
                    status_code=502, detail="Audio source returned incorrect byte offset"
                )
    except (httpx.HTTPError, HTTPException) as exc:
        if upstream is not None:
            await upstream.aclose()
        await client.aclose()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=502, detail="Unable to connect to audio source") from exc

    async def chunks():
        try:
            assert upstream is not None
            async for part in upstream.aiter_raw(chunk_size=64 * 1024):
                if await request.is_disconnected():
                    break
                yield part
        finally:
            if upstream is not None:
                await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        chunks(),
        status_code=206 if requested_range else 200,
        headers=headers,
        media_type="audio/mpeg",
    )
