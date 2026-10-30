# IslamTrove

Audio-first Quran listening app: contextual Arabic recitation with English, German and Urdu translations, QUL Ayah timestamps, and progressive audio caching.

## One-command Nx development (real backend)

Prerequisites: **Node.js 20+**, **npm**, **Python 3.12+**, and **uv**. Run these once from the repository root:

```bash
npm install
cd frontend && npm install && cd ..
cd backend && uv sync --group dev && cd ..
```

Start **both** applications from the monorepo root:

```bash
npm run dev
# same as: npx nx run-many -t serve -p backend frontend --parallel=2
```

Open **http://127.0.0.1:4200/**. Angular uses the **production/API adapters** via its `development-api` configuration and proxies `/api/*` to FastAPI at **http://127.0.0.1:8000/**. Use Ctrl+C to stop both processes. Nx will not launch the old Design Canvas preview.

The API-backed frontend is necessary for persistent caching of long QUL MP3s. A service worker is installed under localhost for IndexedDB range caching. The first visit after installation may require one reload before the worker controls the tab. On-screen QuranEnc verse text and Bismillah are included. Large Arabic recordings stream before full download, and small translation clips use a persistent browser cache where supported. See [streaming cache handoff](docs/STREAMING_CACHE_HANDOFF.md).

## Local and published passage groupings

Open **Grouping library** from the listening summary or Listening Settings.
Choose **My local groupings** to use your browser's private breakpoints, or
**Published groupings** to listen using the server's read-only boundaries.
Copy a published grouping into local before editing it. A single
**Publish this Surah** action submits only the selected Surah's full passage
grouping with the same protected administrator code used for Ayah alignment reviews.
Other published Surahs and locally saved review boundaries are untouched.
Server-published boundaries persist independently of visitors' local data.
See [Grouping Library API, security, and persistence](docs/GROUPINGS.md).

## Shared listening links

Use the **Share** button next to Groupings and Configure in Listening Studio. It generates a link from the current Surah and spoken translation languages, requests autoplay, and opens your device’s share sheet or copies the link. The URL is also displayed for manual copying.

Send a link with exactly these optional settings to open a Surah with its
**spoken** translation already selected:

```text
https://islamtrove.example/?surah=18&translation_lang=ur&autoplay=true
```

- `surah` — valid Surah number (1–114).
- `translation_lang` — audio translation: `ur`, `en`, or `de`. For two spoken
  translations, use e.g. `ur,de` (in that playback order).
- `autoplay` — `true` attempts immediate playback; otherwise no automatic start.

Browser autoplay restrictions cannot be bypassed. If playback does not begin,
the approved large **Start listening** screen remains visible; one tap starts
the configured recitation. Links use built-in Surah passage grouping rather than
the receiver's private breakpoints. URL settings take precedence on that visit,
but do **not** overwrite existing browser-saved preferences. Unsupported or
malformed Surah/language values are ignored.

The fixed Design Canvas screen `/?link-demo=blocked` remains a mock-only visual
scenario. Actual listening links use the real three parameters above.

## Quran-wide Ayah alignment and admin corrections

The backend stores original-CDN-specific timestamps in
`backend/src/islamtrove/data/alignments/NNN.json`. Trusted recordings such
as Al-Kahf retain their previously verified boundaries; newly generated
Surahs are explicitly marked **experimental** until listening review. The
frontend flags uncertain Ayahs in the contextual passage editor, where an
administrator can confirm or adjust a boundary. Overrides and audit history
are stored separately in `backend/review-data/NNN.json`, pinned to the exact
recording SHA-256. The runtime serves static timing JSON and streams the
original MP3; it does **not** perform audio matching or ship generated audio.

Offline preparation tools are unified under
`backend/scripts/offline-audio-alignment/` and can be rerun safely:

```bash
cd backend
uv run --with librosa --with numpy python scripts/offline-audio-alignment/batch.py --all --workers 2
python3 scripts/offline-audio-alignment/audit.py
```

Existing files, including manually reviewed Ar-Rahman (55) and Al-Kahf (18),
are never overwritten. Failed or incomplete Surahs remain in the batch
report for targeted retry. See the [corpus generator](backend/scripts/offline-audio-alignment/README.md),
[audio alignment methodology](backend/docs/AUDIO_ALIGNMENT_GENERATOR.md), and
[admin review documentation](backend/docs/ADMIN_ALIGNMENT_REVIEW.md).

## Docker and Woodpecker deployment

IslamTrove uses two independently deployed Docker images: an Angular/Nginx
frontend and a FastAPI backend. The Woodpecker pipelines mirror the
\`mcp-registry\` project's main-branch Docker-socket deployments.

Production Ayah verification data is stored on a persistent host bind mount,
never inside the replaceable Docker container. The image includes published
review JSON only to seed a new host without overwriting existing reviews.
GitHub synchronization is deliberate and performed from the server terminal,
not by application code. See [Docker and Woodpecker deployment](docs/DEPLOYMENT.md)
for the host setup, secrets, HTTPS proxy and reviewed-timeline workflow.

## Common Nx commands

```bash
npx nx show projects
npx nx serve frontend           # only Angular, requires backend separately
npx nx serve backend            # only FastAPI
npx nx run frontend:build       # production Angular build
npx nx run-many -t test -p frontend backend
npx nx run backend:lint
```

### Workspace layout

- `frontend/`: Angular 20 UI; Nx invokes its existing Angular CLI build/serve scripts.
- `backend/`: FastAPI backend managed by `uv`, exposed through Nx.
- `docs/`: design, source and caching documentation.
- `nx.json`, `frontend/project.json`, `backend/project.json`: Nx project/task definitions.

**Licensing:** IslamTrove application source code is released under the [MIT License](LICENSE). Externally sourced Quran recordings, translations, texts, and derived provider data have separate terms and are not relicensed by the source-code license. Verify reuse permissions, attribution, and provider rate limits before public deployment. Nothing is pushed without explicitly configuring and using a Git remote.
