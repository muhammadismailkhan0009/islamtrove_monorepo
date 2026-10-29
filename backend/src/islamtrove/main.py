"""FastAPI application factory and lifecycle, analogous to Spring Boot configuration."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from islamtrove.api.continuous import router as continuous_router
from islamtrove.api.media import router as media_router
from islamtrove.api.routes import router
from islamtrove.api.stream import router as stream_router
from islamtrove.api.verses import router as verse_router
from islamtrove.application.quran_service import QuranService, UnknownAudioChoice
from islamtrove.core.settings import Settings
from islamtrove.infrastructure.alquran_cloud import AlQuranCloudSource
from islamtrove.infrastructure.everyayah import EveryAyahAudioSource
from islamtrove.infrastructure.german_audio import GermanAudioSource
from islamtrove.infrastructure.quranenc_text import QuranEncVerseSource
from islamtrove.ports.quran_source import ProviderDataError, ProviderUnavailable


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
                app.state.verse_source = QuranEncVerseSource(text_client)
                yield

    app = FastAPI(
        title="IslamTrove Audio API",
        description="Quran catalog and per-Ayah recitation/audio-translation references.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.allowed_origins,
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(media_router)
    app.include_router(stream_router)
    app.include_router(continuous_router)
    app.include_router(verse_router)
    app.state.media_transport = transport
    app.state.continuous_cache = {}

    @app.get("/health", tags=["Health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.exception_handler(UnknownAudioChoice)
    async def invalid_choice(_request, exc: UnknownAudioChoice):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(ProviderUnavailable)
    async def upstream_unavailable(_request, _exc: ProviderUnavailable):
        return JSONResponse(status_code=503, content={"detail": "Quran provider unavailable"})

    @app.exception_handler(ProviderDataError)
    async def upstream_invalid(_request, _exc: ProviderDataError):
        return JSONResponse(status_code=502, content={"detail": "Invalid Quran provider response"})

    return app


app = create_app()
