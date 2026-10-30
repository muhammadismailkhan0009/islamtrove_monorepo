"""Admin-review API: rate-limited code login, short sessions and CSRF-protected writes."""

import hmac
import secrets
import time
from collections import defaultdict
from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Path, Request, Response
from pydantic import BaseModel, Field

from islamtrove.application.alignment_review import ReviewConflict

router = APIRouter(prefix="/api/admin", tags=["Alignment administration"])
COOKIE = "islamtrove_admin_session"
SESSION_SECONDS = 30 * 60


@dataclass
class AdminSession:
    csrf: str
    expires: float


class AdminSessions:
    def __init__(self, admin_code: str) -> None:
        self.admin_code = admin_code
        self.active: dict[str, AdminSession] = {}
        self.failed: dict[str, list[float]] = defaultdict(list)

    def authenticate(self, code: str, address: str) -> tuple[str, str]:
        if not self.admin_code:
            raise HTTPException(status_code=503, detail="Administrator code is not configured")
        now = time.monotonic()
        self.failed[address] = [t for t in self.failed[address] if now - t < 900]
        if len(self.failed[address]) >= 5:
            raise HTTPException(status_code=429, detail="Too many attempts. Try again later")
        if not hmac.compare_digest(code, self.admin_code):
            self.failed[address].append(now)
            raise HTTPException(status_code=401, detail="Invalid administrator code")
        self.failed.pop(address, None)
        ticket = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        self.active[ticket] = AdminSession(csrf, now + SESSION_SECONDS)
        for old, value in list(self.active.items()):
            if value.expires <= now:
                del self.active[old]
        return ticket, csrf

    def require(self, request: Request) -> None:
        ticket = request.cookies.get(COOKIE, "")
        session = self.active.get(ticket)
        if not session or session.expires <= time.monotonic():
            raise HTTPException(status_code=401, detail="Admin session expired; sign in again")
        csrf = request.headers.get("x-csrf-token", "")
        if not csrf or not hmac.compare_digest(csrf, session.csrf):
            raise HTTPException(status_code=403, detail="Invalid review CSRF token")


def _canonical_origin(value: str) -> tuple[str, str, int] | None:
    """Compare actual origins, allowing equivalent explicit default ports."""
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            return None
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        return (parsed.scheme, parsed.hostname.lower(), port)
    except ValueError:
        return None


def enforce_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return
    # The frontend/Angular dev proxy must forward the original Host, not
    # rewrite it to the internal backend hostname. In production Nginx also
    # forwards the public host/port and HTTPS scheme to trusted Uvicorn.
    expected = f"{request.url.scheme}://{request.url.netloc}"
    actual_origin = _canonical_origin(origin)
    expected_origin = _canonical_origin(expected)
    if actual_origin is None or expected_origin is None or actual_origin != expected_origin:
        raise HTTPException(status_code=403, detail="Origin not authorized for administration")


class CodeInput(BaseModel):
    code: str = Field(min_length=1, max_length=256)


class ReviewInput(BaseModel):
    surahId: int = Field(ge=1, le=114)
    ayah: int = Field(ge=1, le=286)
    expectedStartMs: int | None = Field(default=None, ge=0)


class CorrectionInput(ReviewInput):
    startMs: int = Field(ge=0, le=86_400_000)


class BoundaryInput(BaseModel):
    ayah: int = Field(ge=1, le=286)
    expectedStartMs: int = Field(ge=0, le=86_400_000)


class BlockReviewInput(BaseModel):
    surahId: int = Field(ge=1, le=114)
    boundaries: list[BoundaryInput] = Field(min_length=1, max_length=286)


@router.get("/surahs/{surah_id}/reviews")
async def reviews(request: Request, surah_id: int = Path(ge=1, le=114)) -> Response:
    try:
        data = request.app.state.review_store.list(surah_id)
    except ReviewConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=500, detail="Alignment review metadata invalid") from exc
    from fastapi.responses import JSONResponse

    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@router.post("/verify")
async def verify_code(body: CodeInput, request: Request, response: Response) -> dict:
    enforce_origin(request)
    if request.url.scheme != "https" and request.url.hostname not in ("localhost", "127.0.0.1"):
        raise HTTPException(status_code=403, detail="HTTPS required for admin authentication")
    sessions = request.app.state.admin_sessions
    ticket, csrf = sessions.authenticate(body.code, request.client.host if request.client else "?")
    response.set_cookie(
        COOKIE,
        ticket,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        max_age=SESSION_SECONDS,
        path="/api/admin",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"authorized": True, "csrfToken": csrf, "expiresIn": SESSION_SECONDS}


@router.post("/blocks/verify")
async def verify_block(body: BlockReviewInput, request: Request) -> Response:
    enforce_origin(request)
    request.app.state.admin_sessions.require(request)
    from fastapi.responses import JSONResponse

    async with request.app.state.review_lock:
        try:
            result = request.app.state.review_store.commit_block(
                body.surahId, [(x.ayah, x.expectedStartMs) for x in body.boundaries]
            )
        except ReviewConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=500, detail="Unable to save block review") from exc
        request.app.state.continuous_cache.pop(body.surahId, None)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@router.post("/ayahs/verify")
async def verify_ayah(body: ReviewInput, request: Request) -> Response:
    return await commit(body, request, "verify")


@router.post("/ayahs/correct")
async def correct_ayah(body: CorrectionInput, request: Request) -> Response:
    return await commit(body, request, "correct")


async def commit(body: ReviewInput, request: Request, kind: str) -> Response:
    enforce_origin(request)
    request.app.state.admin_sessions.require(request)
    from fastapi.responses import JSONResponse

    async with request.app.state.review_lock:
        try:
            result = request.app.state.review_store.commit(
                body.surahId,
                body.ayah,
                kind,
                start_ms=body.startMs if isinstance(body, CorrectionInput) else None,
                expected_start_ms=body.expectedStartMs,
            )
        except ReviewConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=500, detail="Unable to save alignment review") from exc
        request.app.state.continuous_cache.pop(body.surahId, None)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})
