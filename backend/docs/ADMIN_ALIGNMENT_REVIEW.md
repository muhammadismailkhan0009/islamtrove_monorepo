# Admin-protected alignment review (implemented)

The Listening Studio uses the existing **recitation passages** as review selections. In the real application (Angular `start:api` mode), the Review action beside each passage opens an admin-code prompt. Authorized verification/correction is processed by FastAPI; **the public browser cannot edit JSON files directly**.

## Run locally

From the monorepo root in separate terminals:

```sh
cd backend && uv run uvicorn islamtrove.main:app --reload --host 127.0.0.1 --port 8000
cd frontend && npm run start:api -- --host 127.0.0.1 --port 4200
```

Visit `http://127.0.0.1:4200`, select **Ar-Rahman**, choose **Listening settings**, and scroll to **Set passage boundaries**. Each passage displays the number of its Ayahs already checked. Verified and corrected Ayahs stay checked after changes to passage boundaries. The prototype remains available through the separate Design Canvas mock runtime.

### Administrator code

Set one **secret environment variable** named `ISLAMTROVE_ADMIN_CODE`.
In Woodpecker, create a repository secret with this exact name containing your
chosen strong administrator password. The backend receives it at runtime; the
value is **not built into Docker images, committed to Git, or sent to browsers**.

For a local backend in the current shell:

```sh
read -r -s -p 'Admin code: ' ISLAMTROVE_ADMIN_CODE; echo
export ISLAMTROVE_ADMIN_CODE
```

The previous PBKDF2 hash generator and `ISLAMTROVE_ADMIN_CODE_HASH` variable are
obsolete. Set the new variable before restarting the server; without it,
authentication returns 503 and there is no default password. Use a unique,
strong password. Docker-host administrators can inspect container environments.

### HTTP endpoints

| Method/URL | Purpose | Authorization |
| --- | --- | --- |
| `GET /api/admin/surahs/{id}/reviews` | Public list of flagged, checked and corrected Ayahs | None |
| `POST /api/admin/verify` | Check code, start a 30-minute admin session | Rate-limited code |
| `POST /api/admin/ayahs/verify` | Mark Ayah as reviewed | Admin session + CSRF token |
| `POST /api/admin/ayahs/correct` | Save edited Ayah start | Admin session + CSRF token |
| POST /api/admin/blocks/verify | Bulk verify individually unreviewed Ayahs in a recitation passage | Admin session + CSRF token |

The admin cookie is HttpOnly and SameSite=Strict, scoped to `/api/admin`; the CSRF token is kept only in the frontend adapter's memory and must be sent on **each write**. Sessions expire after 30 minutes or upon backend process restart. Invalid codes are rate-limited (5 failures per 15-minute window per client IP). Administrator write/login requests are restricted to the same origin as the request Host and scheme; remote HTTP admin authentication is blocked, so remote deployment requires HTTPS. For local Design Canvas development only, cross-origin GET requests from localhost/127.0.0.1 ports are permitted by a hardcoded CORS rule; cross-origin administrator POST requests are not permitted. The backend compares the submitted code against the secret environment value using a constant-time comparison; the password is never returned to the browser.

## Data and invariants

The generator's base alignment is never modified, e.g. `backend/src/islamtrove/data/alignments/055.json`. Admin actions are saved separately and atomically in `backend/review-data/055.json`:

- `audioSha256` pins the exact recording. If a source changes, old reviews fail closed rather than silently applying to another performance.
- `reviews` records verified Ayahs and overrides (`startMs`) for corrected starts.
- Review status is **per Ayah, never per passage**. Confirming one passage creates independent durable review entries for each previously unreviewed Ayah.
- Previous verified/corrected Ayah status, reviewer, review timestamp, and timing override are immutable during a bulk verification. Changing passage breakpoints can never reset Ayah verification.
- Passage progress is computed from per-Ayah records. Block validation checks every start offset before committing; a re-verification with no new Ayahs is a no-op.

- `audit` retains the prior/new timestamps and operation date.
- A change to Ayah *N*'s start automatically changes Ayah *N−1*'s end; all intervals must remain ordered, contiguous, at least 250ms and within the recording. Ayah 1 must start at zero; final end remains unchanged.
- The public `GET /api/quran/surahs/{id}/continuous-recitation` merges the immutable base and authorized overrides. Server cache is invalidated after edits, and the Angular continuous-recitation cache is invalidated before the next play.
- The `expectedStartMs` guard rejects updates based on stale frontend data (HTTP 409). User can reload/review and retry.

The initial `055.json` review file records the listening-confirmed Ar-Rahman Ayahs **7, 15, 21–27, 40, 78**. They remain checked; the other **11** flagged Ayahs await human review. Do not automatically approve them. Future offline regenerations must preserve these reviews by matching the source recording hash; reusing corrections on a different recording is prohibited.

### Current UI limitation

The correction dialog supports editing start seconds and ±0.1s/±1s nudges, but **does not yet seek to/capture the current player position** directly. Listen through the normal Ayah controls and enter the corrected start. This feature can be added separately without weakening backend verification. Review actions are persisted; Git commit remains a developer action.

## Validation

```sh
cd backend && uv run pytest -q && uv run ruff check . && uv run pyright
cd ../frontend && npm test && npm run build
```

The tests cover authentication/CSRF/origin/rate limiting, durable review history, optimistic concurrency, immutable base metadata, source mismatch, invalid adjacent boundaries, cache invalidation and the real frontend adapter.

## Whole-Quran provisional alignments

New `experimental-cross-recording` files for any Surah are accepted as local
playback timelines. The review UI reads each file's `reviewAyahs` and retains
admin review/override records per source SHA-256. Generators never overwrite
files that already exist, especially Ar-Rahman's listening-approved timing
and `review-data/055.json`. Offline tooling is in
`backend/scripts/offline-audio-alignment/`; see its README and corpus audit.
