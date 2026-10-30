# Published Quran passage groupings

## Purpose

A visitor may use either personal (browser-local) Surah passage groupings or
administrator-published groupings. The selector is in **Listening Settings →
Grouping library** (and the **Groupings** button in the listening summary).

The two collections are independent:

- **My local groupings** are the user's saved per-Surah breakpoint arrays in
  `localStorage`. Choosing a new Surah in local mode creates its default local
  boundaries; editing the breakpoint grid changes only that local version.
- **Published groupings** are read-only, publicly available server data. Selecting
  the published source changes the listening queue but never overwrites local
  boundaries. A Surah without a published grouping uses the built-in starter
  boundaries. Click **Use this as my local grouping** to create an editable copy.
- A shared link (`?surah=18&translation_lang=ur&autoplay=true`) prefers the
  published grouping for its Surah if available. The source and audio parameters
  of a shared link do not overwrite the receiver's stored preferences.

## API contracts

`GET /api/quran/groupings`: public, non-cacheable read of:

```json
{
  "schemaVersion": 1,
  "revision": 3,
  "groupings": [
    {"surahId": 18, "boundaries": [10, 26, 44, 59, 70, 82, 98, 110]}
  ]
}
```

If nothing is published, returns revision 0 and an empty array.

`POST /api/admin/groupings/surahs/{surahId}`: upserts the **one selected
Surah's full grouping**. Other published Surahs remain unchanged, including
those with independent review/verification boundaries saved locally.

```json
{
  "expectedRevision": 3,
  "boundaries": [10, 26, 44, 59, 70, 82, 98, 110]
}
```

The Surah number comes from the URL path, and the body contains only that
Surah's complete list of passage boundaries—not the whole local collection.
The UI clearly identifies which local Surah is selected before requesting
administrator confirmation. The old whole-catalog write endpoint was removed.

Requires the existing `POST /api/admin/verify` administrator login,
HttpOnly same-site admin session cookie, `X-CSRF-Token`, and same-origin
enforcement. A stale revision or invalid grouping returns HTTP 409; invalid
input schema returns 422. On success, the endpoint returns the full updated
catalog with its revision incremented by one.

Validation checks valid Surah IDs, unique Surahs, strictly increasing integer
breakpoints within each Surah's authoritative Ayah count, and mandatory final
Ayah. No source audio, verse text, account data, or translation preferences are
included in a grouping.

## Persistence and deployment

All published groupings are stored in **`review-data/groupings.json`**, alongside
reviewed Ayah records, using an atomic file replacement under a per-process
asyncio lock. In production the existing host-mounted
`ISLAMTROVE_REVIEW_DATA_DIR` retains this file when the Docker container is
replaced. Ensure host directory permissions permit the non-root app to write.

When the file is included in versioned `backend/review-data/groupings.json`,
the Docker entrypoint seeds it on a **new host only**, without overwriting
a live published file. As with reviewed timestamps, export and manually
synchronize server data to Git after verifying it; there is no automatic
repository push.

## Development and testing

The Angular feature uses a typed `GROUPING_LIBRARY` application port.
The production adapter uses same-origin `/api`; the Design Canvas mock
adapter simulates load/login/single-Surah publication in memory, with demonstration
code `2468` that is **not valid on the real backend**.

Design Canvas preview routes remain available:
`/?groups-demo=local|server|publish|success`.

Local validation:

```bash
cd backend && uv run pytest -q && uv run ruff check . && uv run pyright
cd frontend && npm test && npm run build
```

Deployment, commits, and publishing the public host remain separate manual actions.
