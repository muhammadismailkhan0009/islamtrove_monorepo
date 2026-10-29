# IslamTrove frontend architecture

This Angular design uses Design Canvas **managed-v2** ownership. Design metadata lives at `.design/project.json`.

## Feature and boundaries

The Listening Studio feature is in `src/features/listening-studio`. The page declares it as its root feature and explicitly depends on four application ports:

| Capability | Contract | Mock adapter | Production adapter |
| --- | --- | --- | --- |
| `quran-catalog` | `src/application/ports/quran-catalog` | `src/infrastructure/adapters/mock/quran-catalog` | `src/infrastructure/adapters/production/quran-catalog` |
| `audio-options` | `src/application/ports/audio-options` | `src/infrastructure/adapters/mock/audio-options` | `src/infrastructure/adapters/production/audio-options` |
| `audio-media` | `src/application/ports/audio-media` | `src/infrastructure/adapters/mock/audio-media` | `src/infrastructure/adapters/production/audio-media` |
| `verse-preview` | `src/application/ports/verse-preview` | `src/infrastructure/adapters/mock/verse-preview` | `src/infrastructure/adapters/production/verse-preview` |
| `media-cache` | `src/application/ports/media-cache` | `src/infrastructure/adapters/mock/media-cache` | `src/infrastructure/adapters/production/media-cache` |
| `continuous-recitation` | `src/application/ports/continuous-recitation` | `src/infrastructure/adapters/mock/continuous-recitation` | `src/infrastructure/adapters/production/continuous-recitation` |
| `streaming-source` | `src/application/ports/streaming-source` | `src/infrastructure/adapters/mock/streaming-source` | `src/infrastructure/adapters/production/streaming-source` |

Design-time fixtures live **only** in `src/infrastructure/mock-data/<capability>/default.ts`, never in the component or adapters.

The Angular composition root (`src/main.ts`) selects the adapter mode and injects the resolved data via typed application tokens. The Listening Studio never imports mock fixtures or production adapters directly.

## Adapter mode

- **Development / Design Canvas preview:** uses `src/environments/environment.ts` with `DC_ADAPTER_MODE='mock'`.
- **Production build:** `npm run build` selects `DC_ADAPTER_MODE='production'`.
- **Local integration:** `npm run start -- --configuration api` enables the production adapters and proxies `/api` to the backend at `127.0.0.1:8000`.

The production adapters now connect to the implemented Python backend:
- `GET /api/quran/surahs`
- `GET /api/quran/audio-options`
- `GET /api/quran/surahs/{id}/audio?reciter=...&translation=...`

Start the FastAPI backend before running the production/API frontend. The mock preview needs no backend (but sample audio URLs stream from the provider CDN when clicked).

Per-Ayah playback now uses `audio-media`, preserving Arabic→translation grouping at the selected breakpoints. Source audio is streamed directly from its provider in the browser; Python supplies the URLs. Al-Minshawi Mujawwad uses corrected EveryAyah `Minshawy_Mujawwad_192kbps` recordings; other editions use Al Quran Cloud.

## Validation

Design Canvas structural validation covers canonical feature/page/component ownership, declared feature-port dependencies, realized mock and production adapters, and source registration. It is not the same as Angular build/tests.

The Design Canvas structural validator returned `valid: true` with 0 issues, 3 realized ports and 6 realized adapters. Verify the running preview separately.

## Dual translation UI (design preview)

The Listening Studio now previews Arabic→first translation→optional second translation, configurable language order, guided German shadowing, German-only immersion, and independent on-screen Arabic/translation visibility. The `verse-preview` port reads sourced five-Surah QuranEnc mock text; its production adapter reserves `GET /api/quran/surahs/{id}/verses`, which the backend does not yet implement. German/dual-language playback **works in the mock Design Canvas preview** by composing separate per-language requests and playing the resulting provider MP3 URLs. Full production-backend German and dual-language support remains pending. See `../docs/DUAL_TRANSLATION_UI_HANDOFF.md` for the implementation checklist.

## Phase-aware browser-memory audio cache (October 29, 2026)

- The UI offers **only Muhammad Siddiq Al-Minshawi (Mujawwad), EveryAyah 192 kbps**. The backend still accepts its historic reciter IDs for compatibility, but the UI always requests this fixed edition.
- Listening mode, Surah, per-Surah selected breakpoints, selected translations and screen display choice save automatically to `localStorage`. Manual Save setup is removed.
- The generic `media-cache` port is implemented by a browser-session `MemoryMediaCache`: downloaded Blob bytes are keyed by canonical URL, concurrent downloads deduplicated, entries retained across playback resets, least-recently-used eviction within a device-memory-based budget (96–512 MiB; default 256 MiB).
- `BufferedAudioPlayer` prepares current and next Ayah audio concurrently at phase start, then requests a further Ayah when progressing. It stores byte content, not merely URL strings, and creates playback-specific Blob object URLs. Object URLs are revoked when tracks are released. Downloads do **not** cross an Arabic-to-translation phase boundary prematurely. Dual translations remain paired per Ayah; the Arabic portion stays grouped.
- If a source denies browser CORS (e.g. German/English/Urdu direct URLs in mock preview), the player falls back to native `HTMLAudioElement.preload='auto'` streaming. **This fallback is not equivalent to storing MP3 bytes in JavaScript memory**, and seamless playback cannot be guaranteed. In production the `/api/quran/media?url=...` allowlisted same-origin Python bridge handles those hosts, enabling actual Blob downloads. Missing German API integration in the production audio catalog remains a separate task.
- Files: `src/infrastructure/media/memory-media-cache.ts`, `src/features/listening-studio/media-playback.ts`, `../backend/src/islamtrove/api/media.py`.

## Web Audio sequencing and verse-level controls (29 October 2026)

The `ListeningController` owns a single active listening mode: full passage sequence or a standalone Ayah/translation clip. The generic `media-cache` port still holds compressed MP3 Blob bytes across player sessions. When readable, `BufferedAudioPlayer` decodes recordings into AudioBuffers and schedules adjacent audio source nodes on a shared AudioContext clock; the next decoded recording is scheduled for the exact end of the current one, rather than being started inside an `ended` callback. Two audio files are downloaded in parallel at the start of each playback phase; Arabic and translated audio are kept as distinct phases, and only the next decoded recording is retained alongside the current one. Audio elements are a non-gapless fallback for providers blocking CORS in mock preview.

In the reading UI, each displayed Arabic Ayah and each displayed translation has its own labelled Play/Pause control; the overall sequence uses a single control at the reading-pane header. The bottom player dock was removed. A single clip interrupts the sequence and the previous clip. See `../docs/DUAL_TRANSLATION_UI_HANDOFF.md` for the limitations and test coverage.

## QUL continuous Ayah-timestamp playback (29 October 2026)

**Arabic source of truth:** QUL Minshawi Mujawwad Surah-level audio metadata, per-Ayah absolute millisecond offsets. A contextual Arabic group uses ONE continuous recording, started at the first Ayah's `time_from` and ended at the last Ayah's `time_to`. Never continue into extra renditions present in the physical MP3. Individual Arabic Play buttons seek directly to the relevant timestamp pair. Existing dual spoken-translation ordering is unchanged.

This is an independent `continuous-recitation` application port with mock/production adapters; the backend verifies QUL metadata in `GET /api/quran/surahs/{id}/continuous-recitation`. Small Surahs use an AudioBuffer with a specified source start and duration, even when the MP3 is longer; long Surahs use one native streaming element with end-time guards to avoid decoding hours of PCM. See `../docs/QUL_CONTINUOUS_PLAYBACK.md` for sources, precise limitations and verification.

## Long MP3 progressive delivery and cross-session caching

The `streaming-source` port resolves the native media URL. Production points approved QUL audio to the same-origin FastAPI `GET/HEAD /api/quran/stream`, which forwards HTTP byte ranges without reading the whole recording. `src/stream-cache-sw.js` is installed through Angular's static assets in production/API mode: it serves MediaElement range requests from 256-KiB IndexedDB chunks and fetches/retains missing chunks as playback continues. See `../docs/STREAMING_CACHE_HANDOFF.md` for security, quota policy, mobile behavior and local testing. A separate Cache Storage adapter persists small completed MP3 Blobs across sessions; the existing in-memory LRU remains the hot cache.

**Design Canvas mock exception:** QUL CDN audio is opaque to cross-origin JavaScript. Its direct mock-mode playback remains progressive but cannot persist large QUL chunks without the FastAPI same-origin proxy. Use the API-backed Angular configuration to test persistent Surah-range caching.
