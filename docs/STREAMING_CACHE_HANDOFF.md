# Progressive audio + persistent chunk caching — implementation handoff

**Goal:** Starting Al-Baqarah (~293 MB) must not wait for a complete download. Bytes that *were* fetched during listening can be reused on later visits. Never decode a multi-hour MP3 into one huge AudioBuffer. QUL's Ayah timestamps continue to define playback boundaries, never the full recording's duration.

## Two independent cache layers

| Recording | Playing | Session cache | Persistent cache |
|---|---|---|---|
| Short Arabic/Bismillah and translation MP3 | Web Audio BufferSource | Existing MemoryMediaCache LRU | Cache Storage `islamtrove-small-mp3-v1` (up to 48 MiB mobile / 128 MiB desktop, 14 days) |
| Long QUL Arabic Surah MP3 | Native `HTMLAudioElement` progressive stream | Browser native buffer only (not 293 MB in JS RAM) | IndexedDB `islamtrove-stream-cache-v1` (256-KiB byte ranges, ~96 MiB mobile / 384 MiB desktop; additionally limited to 20% of browser storage quota, 7-day TTL) |

The short-cache layer is also available in the Design Canvas mock preview for CORS-readable files. As before, mock-host translation sources that block CORS can use native audio but are not persisted as Blobs.

### Production long-file path

1. The production `streaming-source` port maps the original approved QUL MP3 URL to same-origin `/api/quran/stream?url=<encoded provider URL>`.
2. FastAPI's allowlisted streaming endpoint passes through `GET` with `Range` headers (and supports `HEAD`), validating the provider's `206`/`Content-Range`; **it streams data instead of assembling the 293 MB into bytes in RAM**.
3. In API-backed mode, Angular registers `/stream-cache-sw.js` as a service worker. The browser's media request is intercepted when the worker controls the page. The worker requests up to 256 KiB at a time from the same-origin endpoint, buffers only the current chunk and writes each completed chunk to IndexedDB. It returns a streaming `200` or `206` response to the media element, with correct byte-range headers.
4. On a later visit or later seek, previously stored chunks are returned from IndexedDB, and only missing chunks are requested from FastAPI. In-flight chunk requests are deduplicated. Small/short completed Blob files use a separate Cache Storage layer.
5. Cache storage is bounded, using approximate LRU eviction. Under storage quota errors, unsupported service workers, or browser policies, the player **continues streaming without persistent caching** rather than blocking audio. Only already cached portions can be used without a network connection.

**Important:** The current Design Canvas preview runs `DC_ADAPTER_MODE='mock'` and has no FastAPI proxy. QUL's CDN does not expose readable cross-origin MP3 byte ranges to browser JavaScript, so **the preview cannot exercise persistent QUL range caching**. It still progressively streams the direct QUL MP3. To test persistent long-file caching, run the API-backed frontend with the FastAPI server (see below). The preview's CORS-readable small MP3 files can still use the persistent Cache Storage layer.

### To run your own Al-Baqarah test (two terminals)

Terminal A:

```bash
cd backend
uv run uvicorn islamtrove.main:app --host 127.0.0.1 --port 8000
```

Terminal B:

```bash
cd frontend
npm run start:api
```

Open the Angular app on the port that `ng serve` prints (normally `http://localhost:4200`). The first service worker installation may take a moment; if the service worker isn't controlling the app yet, refresh once. Nothing should attempt a 293 MB `fetch().blob()` before playback.

For an optional inspection, in Chrome DevTools go to **Application → IndexedDB → `islamtrove-stream-cache-v1`** and check `chunks`/`entries`; **Application → Cache Storage → `islamtrove-small-mp3-v1`** shows saved smaller MP3s. The Network panel can show the `X-IslamTrove-Stream-Cache: chunks` header on service-worker-cached media responses.

### Limitations / accuracy

- Browser service workers, MediaElement byte-range behavior, IndexedDB quotas and background suspension vary among Chrome, Safari and mobile browsers. Progressive playback still works through the backend when no worker is active; persistence then isn't guaranteed.
- This does *not* store an entire 293 MB Surah on mobile by default. It retains **already buffered/listened sections** within a bounded budget. On desktop, it can potentially retain the entire file if quota permits.
- It does *not* offer an offline download button, predictive downloading of the entire Surah, or an adaptive bit-rate alternative. It caches exact original bytes rather than transcoding, so recitation quality is unchanged.
- QUL timestamps are not inferred from byte offsets. Byte ranges are managed by the browser's native MP3 playback pipeline. QUL timestamps still govern actual Ayah/playback start/end seconds.
- The FastAPI proxy only accepts exact Minshawi Mujawwad Surah URLs at `audio-cdn.tarteel.ai`; it is not an arbitrary URL proxy. External audio hosting permissions, licensing and rate limits must be checked before public deployment.

**User instruction:** Do not run playback tests or builds automatically. This implementation was authored but not exercised; the user will test Al-Baqarah manually. No commit requested/performed.
