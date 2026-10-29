# IslamTrove — Sources, Decisions, and Next-Session Plan

**Session handoff:** 29 October 2026
**Status:** Planning notes only. German audio integration and automatic contextual groupings are **not implemented**.
**Working agreement:** Continue coding directly in this chat using Serena for repository changes and Test Design MCP for Design Canvas. Do not use a delegated coding agent. **Do not commit without instruction.**

## 1. Product direction and decisions

IslamTrove is an **audio-first Quran listening application**, not a verse-reading or AI application. Its distinguishing feature is *contextual translation playback*: recite a coherent group of Arabic Ayahs, play the same group's spoken translation, then continue with the next Arabic group.

- The existing Angular frontend offers Surah, reciter, spoken translation, and editable Ayah breakpoints.
- The existing FastAPI backend resolves per-Ayah audio references; MP3s stream **from the providers to the browser**, not through our backend.
- For the MVP, **no RDBMS or NoSQL database is required**. Small, nearly fixed metadata and predefined context-grouping profiles may be kept as version-controlled JSON, loaded into memory. User preferences remain in browser localStorage.
- Keep manually customizable breakpoints even after adding a predefined default profile.
- **German narrated translation** is the next requested feature, to support Quran comprehension and German listening practice, optionally alongside Urdu. A combined Urdu+German playback mode is a possible *future* feature, **not yet an approved implementation requirement**.
- **No code changes or commits are requested for these new features in this session.** This file preserves research and plans for a later session.

## 2. Confirmed Quran audio sources already used by IslamTrove

| Material | Provider | Identification / URL | Current status |
| --- | --- | --- | --- |
| Surah list, Ayah metadata, audio editions | Al Quran Cloud | https://api.alquran.cloud/v1/ | Already integrated |
| Arabic per-Ayah recitation | Al Quran Cloud | Editions such as `ar.alafasy`, `ar.minshawi` | Already integrated |
| Urdu per-Ayah spoken translation | Al Quran Cloud | Edition `ur.khan` (Shamshad Ali Khan) | Already integrated |
| English per-Ayah spoken translation | Al Quran Cloud | Edition `en.walk` (Ibrahim Walk) | Already integrated |
| **Al-Minshawi Mujawwad, corrected version** | EveryAyah | https://everyayah.com/data/Minshawy_Mujawwad_192kbps/ | Already integrated |
| Quran metadata with Ruku markers | Al Quran Cloud | https://api.alquran.cloud/v1/quran/quran-uthmani | Investigated; **not used for default grouping yet** |

**Important existing decision:** Use EveryAyah's **192 kbps** directory for Sheikh Muhammad Siddiq Al-Minshawi's *Mujawwad* recordings, not the older `64kbps` directory. The user reported errors in the 64 kbps set. Do not regress that choice. The *Murattal* edition remains separate.

Existing backend: `backend/src/islamtrove/` (especially `domain/models.py`, `application/quran_service.py`, `infrastructure/alquran_cloud.py`, `infrastructure/everyayah.py`).
Existing frontend: `frontend/src/application/ports/`, `frontend/src/infrastructure/adapters/`, `frontend/src/features/listening-studio/`.

## 3. German translation — preferred authoritative text

**Preferred translation:** **Abdullah as-Samit (Frank Bubenheim) and Dr. Nadeem Elyas**, a recognized mainstream Muslim German translation. The user specifically wants to avoid Ahmadiyya translations. Verify exact text/edition provenance when referencing translated verses.

Sources:

- QuranEnc website and API documentation: https://quranenc.com/en/home/api/
- QuranEnc German translation list: https://quranenc.com/api/v1/translations/list/de
- QuranEnc German verse API example: https://quranenc.com/api/v1/translation/aya/german_bubenheim/1/1
- Tanzil's Bubenheim/Elyas translation reference: https://tanzil.net/trans/de.bubenheim
- German project describing Bubenheim/Elyas text: https://anlayarakkuranokuyorum.com/de/

**Verified:** QuranEnc's `german_bubenheim` **text** endpoint returned JSON successfully. Its similarly formed German **audio** URLs returned HTTP 404 during investigation. **Do not assume QuranEnc supplies German per-Ayah MP3s.**

## 4. German narration — Den Koran verstehen

**Primary candidate:** *Den Koran verstehen* / *Anlayarak Kur'an Okuyorum*, describing its German translation as Bubenheim & Elyas and the German narrator as **Nail ibn Radhan**.

- German site: https://anlayarakkuranokuyorum.com/de/
- Application homepage: https://anlayarakkuranokuyorum.com/
- Public availability manifest: https://anlayarakkuranokuyorum.com/data/de-audio.json
- Public application script (source of the URL convention and availability handling, at time of investigation): https://anlayarakkuranokuyorum.com/app.js?v=20261028-dl214
- German Ayah MP3 format: `https://anlayarakkuranokuyorum.com/audio/de/{surah:03d}{ayah:03d}.mp3`.
- Real examples:
  - Al-Fatihah 1:1: https://anlayarakkuranokuyorum.com/audio/de/001001.mp3
  - Al-Fatihah 1:7: https://anlayarakkuranokuyorum.com/audio/de/001007.mp3
  - Al-Ikhlas 112:1: https://anlayarakkuranokuyorum.com/audio/de/112001.mp3
  - An-Nas 114:6: https://anlayarakkuranokuyorum.com/audio/de/114006.mp3

**Observed technical facts (29 October 2026):**

1. The public `data/de-audio.json` manifest listed all **114 Surahs** as available, with **Al-Baqarah 2:283–286** explicitly marked as missing.
2. Multiple individual German audio files returned HTTP 200 and `audio/mpeg` on HEAD requests; `audio/de/002283.mp3` returned HTTP 404, matching the manifest.
3. The site's public JavaScript uses an `audio/de/SSSAAA.mp3` convention and references the narrator and translation provenance.
4. These are **public static MP3 paths**, not an officially documented third-party integration API. The manifest may change; avoid treating any particular completeness snapshot as permanent.
5. Only sample files and the manifest have been verified; no complete audit of all 6,236 recordings, audio pronunciation, verse segmentation or editorial accuracy has been conducted.

**Rights note:** The user considers source credit appropriate for Islamic audio material, but **public availability and nonprofit intent do not by themselves establish permission to redistribute or embed copyrighted recordings**. No explicit integration/rehosting license has been verified. Before public distribution, clarify reuse permission/terms and provide narrator, translator and host attribution. We can continue technical prototyping without presenting this as a confirmed license.

## 5. Planned German audio architecture (NOT implemented)

Keep the current **ports-and-adapters** design; do not introduce a new database, audio processor, or extra backend service simply to support German.

Suggested sequence for the next coding session:

1. Register a **German** translation option, with stable backend ID (e.g. `de.bubenheim.nail`) and explicit attribution to Bubenheim/Elyas, Nail ibn Radhan and *Den Koran verstehen*.
2. Implement a focused backend **German audio source adapter**, following the same `QuranSource` protocol. Form URLs from validated Surah (1–114) and Ayah positions, and validate against a cached/packaged copy of the upstream availability manifest. Preserve the original data source and version in provenance metadata.
3. Decide how to represent **missing German Ayahs** in API contracts. The current response expects complete, positional lists. **Never silently omit an Ayah or shift its index**; either reject an unavailable range with an explicit message, or explicitly represent missing media and let the user choose a fallback.
4. Extend the **Angular mock audio adapter** and mock audio-options fixture to include German, so the backend-free Design Canvas preview still works.
5. Connect the existing Angular production adapter and player; leave the manual breakpoint behavior unchanged. Avoid recording downloads/server-side audio storage by default.
6. Add deterministic backend tests using HTTPX mocking, tests for missing recordings (especially 2:283–286), frontend build checks, and a real end-to-end listening check.
7. Assess browser playback on desktop and mobile. The MP3 host did not advertise an `Access-Control-Allow-Origin` header in the inspected HEAD responses; plain cross-origin `<audio>`/Audio playback generally works without CORS, but JS `fetch` of audio bytes and client-side file download may need different arrangements. Do not add binary fetch/caching without testing.
8. Document provider availability, attribution, fallback behavior, and any confirmed permissions.

**Potential German-learning enhancement later:** optional repeated listening to short groups, German-only replay, and alternating Arabic/German/Urdu in selected orders. These are ideas, not part of the current approved feature scope.

## 6. Context-aware default translation grouping (NOT implemented)

The user asked whether we can prepare a **complete JSON profile for all 114 Surahs** with context-aware passage boundaries based on translations, inter-Ayah relationships, and established tafsir. The answer is **yes as a carefully marked editorial draft**, but we should **not claim unreviewed model-generated divisions are authoritative interpretations**.

**Proposed procedure:**

1. Establish a consistent Quran edition and canonical 1-based Surah/Ayah numbering.
2. Read *translations and tafsir* to identify complete ideas, continuations, shifts in address, narratives, question/answer sequences, thematic arguments, prayers, and conclusions.
3. Use source Ruku boundaries as **contextual guidance, not an automatic final profile**. Al Quran Cloud's `quran-uthmani` source exposes **556 distinct Ruku markers**. Investigations found some Rukus are **very long (up to 53 Ayahs)**, so Ruku alone would produce overly long translation intervals.
4. Split where meaning naturally changes, not after a fixed count. A soft usability preference of roughly **3–10 Ayahs per group** can guide review, but semantic continuity takes precedence; short or long exceptions are acceptable.
5. Include explicit **source citations, editorial explanation, and review status** for every suggested boundary or contextual segment. Obtain qualified human review for uncertain passages.
6. Validate algorithmically: every Surah 1–114 represented, every Ayah covered exactly once, inclusive ranges continuous, no gaps or overlaps, group labels and source references present, end of final group equals the Surah's total Ayah count.
7. Ship the reviewed/preliminary profile as a **version-controlled JSON file** with a schema version. Let users start from the default profile but freely customize breakpoints; their choices persist locally.
8. Keep a clear distinction between **predefined contextual passage boundaries** and **per-Ayah audio tracks**. The JSON controls ordering, not audio content or audio hosting.

Suggested schema (example only — **not created or approved as final**):

```json
{
  "schemaVersion": 1,
  "profileId": "default-contextual-v1",
  "surahs": [
    {
      "surahId": 1,
      "ayahCount": 7,
      "groups": [
        {
          "startAyah": 1,
          "endAyah": 4,
          "topic": "Praise and recognition of Allah",
          "basis": "editorial-draft",
          "reviewStatus": "needs-scholarly-review",
          "sources": []
        },
        {
          "startAyah": 5,
          "endAyah": 7,
          "topic": "Worship, seeking help, and guidance",
          "basis": "editorial-draft",
          "reviewStatus": "needs-scholarly-review",
          "sources": []
        }
      ]
    }
  ]
}
```

This Al-Fatihah grouping is an **illustration**, not a verified final contextual segmentation.

**Important:** A previous attempted automatic JSON generation failed before writing its output; **no completed 114-Surah contextual grouping file exists**. Do not assume it does.

## 7. Suggested next-session checkpoints

1. Resume from **this file**; do not start by creating another architecture or redesigning the already-approved interface.
2. Confirm the German-audio missing-Ayah behavior (explicit unavailability vs chosen fallback) before changing API response shapes.
3. Add the German provider through existing architecture and preserve the 192 kbps Minshawi Mujawwad decision.
4. Verify actual spoken translation audio against its text reference for a few selected Ayahs.
5. Test one full German listening session with custom breakpoints; only then consider the larger 114-Surah contextual JSON task.
6. For the contextual task, use source-aware passage analysis and review flags; do not use an unreviewed Ruku-only profile as the final default.
7. Run `cd backend && uv run pytest -q && uv run ruff check . && uv run pyright`, Angular development/production builds, and Design Canvas's **structural** validator. Remember structural validity does **not** imply architecture completeness.
8. **Do not commit without explicit user instruction.**

## 8. Known tooling issue

Design Canvas's `restart_project_preview` may create a new frontend preview process/port **without stopping or invalidating an older process**. This is an issue in Design Canvas, not an IslamTrove feature. The user intends to address it separately. Avoid unnecessary preview restarts during the next session.

---

**Bottom line:** Existing recitation + Urdu/English playback architecture is implemented. The **German** per-Ayah audio path and its four known missing Ayahs have been researched but **not integrated**. A 114-Surah semantic passage JSON is planned, but **not generated**. Preserve all of these distinctions when resuming.
