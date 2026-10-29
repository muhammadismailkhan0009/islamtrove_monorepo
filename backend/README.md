# IslamTrove Backend

FastAPI implementation of the Quran catalog and audio URL API. All code is in the existing `islamtrove_monorepo/backend` folder.

## Start

Python 3.12+ is supported; `.python-version` selects Python 3.13, already installed on the development host.

```sh
cd backend
uv sync --group dev
uv run uvicorn islamtrove.main:app --reload --host 127.0.0.1 --port 8000
```

Visit `http://127.0.0.1:8000/docs` or `/health`.

## Test and validate

```sh
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
uv run pyright
```

Unit, API, and provider contract tests use HTTPX MockTransport and do not contact the real provider. A real network smoke check should be run separately and deliberately.

Testcontainers Python is available as a development dependency, but no container tests are needed until we add PostgreSQL or another containerized dependency. Avoid adding dummy Docker tests just to exercise the library.

## REST API

- `GET /api/quran/surahs` — 114 Surahs, using the approved Angular frontend fields.
- `GET /api/quran/audio-options` — reciters and translation languages, plus stable edition IDs/attribution.
- `GET /api/quran/surahs/{id}/audio?reciter=ar.alafasy&translation=Urdu` — ordered per-Ayah URLs for both audio streams. Omit translation for recitation-only mode.
- `GET /health` — liveness.

The frontend constructs the Arabic→translation queue from its breakpoints; the backend never concatenates or proxies MP3s.

## Providers and copyright

The primary provider is [Al Quran Cloud](https://alquran.cloud/cdn). The distinct Al-Minshawi Mujawwad recordings are resolved through [EveryAyah](https://everyayah.com/recitations_ayat.html) (the corrected `Minshawy_Mujawwad_192kbps` files), because Al Quran Cloud currently serves the same sampled audio bytes under its Minshawi Murattal and Mujawwad edition IDs. We verified its documented per-Ayah URLs and live audio-edition identifiers. The backend maps **only allowlisted IDs** and validates returned CDN hosts. Audio is played directly from CDN URLs; text is not included in API responses.

See [audio provider terms](https://alquran.cloud/terms-and-conditions). Audio rights remain with their copyright holders and streams must be used within the provider's usage restrictions; attribution of translators/reciters should be visible in the client before public release. We do not mirror, redistribute, or splice recordings.

## Configuration

Optional environment variables are documented in `.env.example`, with the `ISLAMTROVE_` prefix. The default CORS policy allows browser previews on localhost/127.0.0.1 with arbitrary ports, plus explicit origins in `ISLAMTROVE_CORS_ORIGINS`. Restrict loopback before publishing if needed.

## Deliberate omissions

No database, authentication, Redis, Celery, FFmpeg, or AI. The Angular player is connected through a typed audio-media port. To run both sides locally, start this API, then in `../frontend` run `npm run start -- --configuration api`. For the backend-free Design Canvas preview, use the default mock mode.
