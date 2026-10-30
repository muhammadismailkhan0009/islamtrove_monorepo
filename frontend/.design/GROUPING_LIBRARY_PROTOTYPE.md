# Grouping Library — Design Canvas Prototype

Status: **Design Canvas fixture/artboard reference**. The approved feature has now been
implemented with real backend publishing, persistence, authentication, and source selection.
See `docs/GROUPINGS.md` for the current production contract. Mock artboards still
use an in-memory adapter and demonstration code `2468`; they never modify production data.

## Purpose

Allow listeners to switch between their own private per-Surah grouping collection and a
published server grouping collection. A logged-in administrator should be able to publish
the **currently selected Surah's complete grouping in one operation**, never
unrelated local Surahs that may have verification-only boundaries.

## Design Canvas preview pages

- `/?groups-demo=local` — local collection and **Publish this Surah** action.
- `/?groups-demo=server` — published collection with read-only passage ranges and
  **Use this as my local grouping** copy action.
- `/?groups-demo=publish` — single-Surah administration code entry.
- `/?groups-demo=success` — a simulated successful publication.

The first two pages have desktop (1440×960) and mobile (390×844) artboards.
The mock preview opens the existing listening settings dialog on loading. The grouping view is also discoverable **without special URL parameters** in the normal Design Canvas listening page: click **Groupings · Preview** next to Configure in the listening summary, or open **Configure → Grouping library** inside Listening Settings.

## Interaction semantics demonstrated

1. Local and published are separate collections. The switch changes the displayed
   Surahs and passage ranges; switching does not silently overwrite personal groupings.
2. Published grouping ranges are read-only until copied into local.
3. One **Publish this Surah** action initiates administrator authorization, then
   submits all passages of that Surah, without changing any other published Surahs.
   Sample code `2468` is **mock-only**.
4. The success message identifies the Surah that was published and switches to
   the server collection without deleting other published Surahs. In this demo, the state is in-memory only.
5. Local sample data includes Al-Kahf, Ar-Rahman, and Al-Mulk. Server sample data
   initially includes Al-Kahf and Ar-Rahman. These are **non-authoritative** mock
   groupings for inspecting interface behavior; they are not tafsir recommendations.

## Production implementation

- Public GET and protected single-Surah POST endpoints are implemented in `backend/src/islamtrove/api/groupings.py`; only an authorized administrator may update one published Surah.
- The backend validates IDs, strictly increasing boundaries, authoritative last Ayahs, and revision conflicts; spoken audio and UI preferences are not submitted.
- Published JSON persists in the existing host-mounted review-data directory and uses the existing administrator session, CSRF, and same-origin checks.
- Browser-local boundaries remain separate; source switching never copies them. Deep links need no grouping parameter.
- The feature is implemented locally but has **not been deployed, committed, or pushed**.

## Source

- `frontend/src/features/listening-studio/components/player/grouping-library-preview.component.ts`
- `frontend/src/features/listening-studio/components/player/grouping-library-preview.component.html`
- `frontend/src/features/listening-studio/components/player/grouping-library-preview.component.css`
- `frontend/.design/project.json`

The application mounts the **same approved UI** in normal Listening Settings on both adapters. The mock adapter simulates the server; the production adapter uses the real HTTP endpoints and administrator authorization. Special `?groups-demo=` routes remain as Design Canvas artboards.
