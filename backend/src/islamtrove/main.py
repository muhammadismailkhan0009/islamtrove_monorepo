"""FastAPI application factory and lifecycle, analogous to Spring Boot configuration."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from islamtrove.api.alignment_admin import AdminSessions
from islamtrove.api.alignment_admin import router as alignment_admin_router
from islamtrove.api.continuous import router as continuous_router
from islamtrove.api.groupings import router as groupings_router
from islamtrove.api.media import router as media_router
from islamtrove.api.routes import router
from islamtrove.api.stream import router as stream_router
from islamtrove.api.verses import router as verse_router
from islamtrove.application.alignment_review import AlignmentReviewStore
from islamtrove.application.grouping_store import GroupingStore
from islamtrove.application.quran_service import QuranService, UnknownAudioChoice
from islamtrove.core.settings import Settings
from islamtrove.infrastructure.alquran_cloud import AlQuranCloudSource
from islamtrove.infrastructure.everyayah import EveryAyahAudioSource
from islamtrove.infrastructure.german_audio import GermanAudioSource
from islamtrove.infrastructure.quranenc_text import QuranEncVerseSource
from islamtrove.ports.quran_source import (
    ProviderDataError,
    ProviderUnavailable,
    SpokenTranslationUnavailable,
)


def create_app(
    *,
    settings: Settings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with httpx.AsyncClient(
            base_url=str(config.quran_api_base_url),
            timeout=config.http_timeout_seconds,
            follow_redirects=False,
            transport=transport,
        ) as client:
            app.state.quran_service = QuranService(
                GermanAudioSource(EveryAyahAudioSource(AlQuranCloudSource(client)))
            )
            async with httpx.AsyncClient(
                base_url="https://quranenc.com/",
                timeout=config.http_timeout_seconds,
                follow_redirects=False,
                transport=transport,
            ) as text_client:
                async with httpx.AsyncClient(
                    base_url="https://alquran.api.islamic.network/v1",
                    timeout=config.http_timeout_seconds,
                    follow_redirects=False,
                    transport=transport,
                ) as arabic_fallback:
                    app.state.verse_source = QuranEncVerseSource(
                        text_client, client, arabic_fallback
                    )
                    yield

    app = FastAPI(
        title="IslamTrove Audio API",
        description="Quran catalog and per-Ayah recitation/audio-translation references.",
        version="0.1.0",
        lifespan=lifespan,
    )
    # Production API calls are same-origin through frontend Nginx.
    # Development-only: allow GET requests from local Design Canvas/Angular
    # ports; never allow cross-origin administrator POST requests.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[],
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(media_router)
    app.include_router(stream_router)
    app.include_router(continuous_router)
    app.include_router(alignment_admin_router)
    app.include_router(groupings_router)
    app.include_router(verse_router)
    app.state.media_transport = transport
    app.state.continuous_cache = {}
    review_dir = (
        Path(config.review_data_dir)
        if config.review_data_dir
        else (Path(__file__).resolve().parents[2] / "review-data")
    )
    app.state.review_store = AlignmentReviewStore(review_dir)
    app.state.grouping_store = GroupingStore(review_dir)
    app.state.grouping_lock = asyncio.Lock()
    app.state.admin_sessions = AdminSessions(config.admin_code)
    app.state.review_lock = asyncio.Lock()

    @app.get("/health", tags=["Health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.exception_handler(UnknownAudioChoice)
    async def invalid_choice(_request, exc: UnknownAudioChoice):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(ProviderUnavailable)
    async def upstream_unavailable(_request, exc: ProviderUnavailable):
        return JSONResponse(
            status_code=503,
            content={"detail": str(exc) or "Quran provider unavailable"},
        )

    @app.exception_handler(SpokenTranslationUnavailable)
    async def spoken_translation_unavailable(_request, exc: SpokenTranslationUnavailable):
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(ProviderDataError)
    async def upstream_invalid(_request, _exc: ProviderDataError):
        return JSONResponse(status_code=502, content={"detail": "Invalid Quran provider response"})

    return app


app = create_app()
