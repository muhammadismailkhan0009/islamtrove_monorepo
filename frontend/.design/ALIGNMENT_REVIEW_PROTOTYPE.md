# Ayah timing review — Design Canvas prototype

This is a **mock UI prototype**, built into IslamTrove's existing Listening Studio and registered as five new Design Canvas preview views. It does not implement an actual admin backend, unlock production access, or modify the Quran audio-alignment JSON files.

## Preview routes and canvas views

- `/?review-demo=grid` — Ar-Rahman passage editor, 11 red pending Ayahs and 11 previously checked ones
- `/?review-demo=access` — Ayah 55:6 admin-code popup (demo code `2468`)
- `/?review-demo=correction` — editable Ayah start, ±1s/±0.1s controls, validation explanation
- `/?review-demo=saved` — confirmation and updated checked state
- Mobile 390×844 preview of the correction state

Each is an additional Design Canvas **view**, backed by the same Angular Listening Studio feature. The popup can also be reached interactively: select Ar-Rahman → Listening settings → Set passage boundaries → click a red **Review** tag. Clicking the numbered tile still changes the contextual playback breakpoint independently.

## State / architecture

- Port: `src/application/ports/alignment-review` (`list`, `authenticate`, `submit`)
- Demo data: `src/infrastructure/mock-data/alignment-review/default.ts`
- Mock adapter: `src/infrastructure/adapters/mock/alignment-review` (code `2468`, in-memory demo writes)
- Production adapter: `src/infrastructure/adapters/production/alignment-review` (**disabled**, returns no reviews, rejects authentication and writes)
- UI: `src/features/listening-studio/components/player/app.component.{ts,html}` and `alignment-review.css`
- Composition: `src/main.ts` selects adapters at startup. No mock fixture is imported into the feature/component.

### Proposed future backend implementation (not implemented yet)

1. `POST /api/admin/verify` checks securely stored code hashes, rate-limits failures, sets short-lived HttpOnly session cookie.
2. All `POST /api/admin/ayahs/verify` and `POST /api/admin/ayahs/correct` writes require that authenticated session; CSRF protections for cookie authentication.
3. Corrections validate the exact Surah/audio version and neighboring timestamp boundaries, update previous Ayah end, and produce immutable audit history.
4. Persist generated alignments and admin overrides separately; rebuild effective JSON without overwriting reviewed corrections. Real commits remain a developer action, not an API side effect.
5. Add real-player seek/capture for timestamp corrections; the prototype's ± controls and seconds field currently simulate this only.

For now, changing the number in the popup and clicking Confirm changes **mock preview state only**, not audio playback or repo files. Admin credentials in the mock are only illustrative, not real authorization.
