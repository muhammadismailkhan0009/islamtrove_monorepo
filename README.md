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

**Source licensing:** Verify recitation/translation licensing, provider rate limits, and redistribution permissions before deployment. All development data and code stay local unless you explicitly configure and push a Git remote.
