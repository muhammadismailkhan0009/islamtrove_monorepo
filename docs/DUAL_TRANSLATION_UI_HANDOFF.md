# Dual-Translation Listening Studio — UI Design Handoff

> Historical design reference: the current Urdu **written** translation is Fateh Muhammad Jalandhari (`ur.jalandhry` via Al Quran Cloud). Shamshad Ali Khan remains the separate Urdu audio narrator. Obsolete Junagarhi references below describe the earlier implementation.

**Date:** 29 October 2026
**Scope:** Angular + Design Canvas UI only. Backend and real multi-translation audio have **not** been implemented or changed.
**Status:** Latest Web Audio, per-Ayah controls and production text/audio adapters implemented; see the final dated section.

## What the screen now supports (in the Design Canvas UI)

- **Audio playback planning:** Arabic recitation followed by either **one** selected spoken translation or **two ordered** translations. Both slots are generic choices: German, English, or Urdu. Duplicate languages are prevented.
- **Guided listening preset:** Arabic → English → German. Default on-screen text is Arabic + German, letting the listener hear the familiar English first and then practise German.
- **German immersion preset:** Arabic → German, without a second spoken translation.
- **Editable language order:** Users can pick Urdu → German, German → English, German → Urdu, etc.
- **Independent on-screen text controls:** Arabic remains visible; listeners choose to display **first translation**, **second translation**, or **both**. This is independent of audio sequence.
- **Reading companion:** Verse-by-verse Arabic plus chosen translation text, grouped by the currently selected Ayah passage. Existing breakpoint editor, reciter, and saved setup remain available.
- **UI interactions:** Preset buttons, dropdowns, reading-language visibility toggles, breakpoints, passage selection, stage navigation, and saved setup update their displayed states.

## Source and attribution for the design fixture

Five sample Surahs (1, 103, 112, 113, 114) contain actual verse text in the mock-data fixture:

`frontend/src/infrastructure/mock-data/verse-preview/verses.json`

Source: [QuranEnc](https://quranenc.com/en/home/api/) — obtained via its public Surah translation endpoints on 29 October 2026:

- German: `german_bubenheim` (Abdullah as-Samit / Frank Bubenheim & Nadeem Elyas)
- English: `english_rwwad` (Rowwad Translation Center)
- Urdu: `urdu_junagarhi` (Muhammad Junagarhi)
- Arabic: Arabic text included with the same QuranEnc verse response.

**Text and audio are different data streams.** Existing English/Urdu audio recordings may follow different text translations; do not label the displayed Rowwad/Junagarhi text as verbatim transcripts of those recordings.

## Architecture

Managed Design Canvas v2 now declares **4 application ports**, each realized by a mock and production adapter (**8 adapters total**):

1. `quran-catalog`
2. `audio-options`
3. `audio-media`
4. `verse-preview` — new, independent Arabic/translation reading-text port

The mock verse-preview adapter uses the five-Surah QuranEnc sample; the production adapter reserves **`GET /api/quran/surahs/{id}/verses`**, which the Python backend **does not implement yet**. The frontend handles absence of production verse text without fabricating a translation.

UI style resides in `frontend/src/features/listening-studio/components/player/study-ui.css`. The player stays within the existing Listening Studio feature, and icons plus pure track planning were extracted into smaller modules to satisfy Design Canvas's source-size architecture limit.

## What still needs implementation after UI approval

1. Add the German spoken translation source (Nail ibn Radhan, `https://anlayarakkuranokuyorum.com/audio/de/SSSAAA.mp3`), including explicit handling for the source's known missing audio files (Al-Baqarah 2:283–286).
2. Extend `audio-options` and `audio-media` backend contracts to return 1–2 selected translations and synchronized per-Ayah URLs. Keep language order stable; handle missing audio without silently skipping Ayahs.
3. Update Angular playback to resolve and play the planned dual-language sequence. **The Play button is enabled in the design preview for German and dual-translation modes**. The frontend composes separate per-language requests using the mock audio-media adapter and streams the provider MP3s directly. The production backend still lacks German support and a combined response endpoint; those scenarios may return an API error until implemented. Existing recitation-only and single English/Urdu playback paths remain available.
4. Implement the verse-text backend API using verified German, English, and Urdu translations. Preserve source attribution and review usage terms before release.
5. Test responsive layout, actual German listening, stage transitions, per-Ayah alignment, navigation, and audio continuity.
6. Later, if approved, add a source-checked JSON profile for contextual Surah segmentation. **No complete 114-Surah contextual file has been generated.**

## Reference UI

Borrowed design principles—not code—from [Quran.com's personalized reading guidance](https://quran.com/explore/build-your-personalized-quran-experience): independently configurable verse display, multiple translations, reading modes and audio reciter choices.

## Design Canvas preview warning

**Do not restart the preview unnecessarily.** The user observed that preview restarts may leave earlier Angular instances running. The existing watch-mode preview updates automatically on file changes.

**No code commit was requested or performed.**

## 29 October 2026 — listening UI simplification and buffered verse-paired audio

Three user-requested improvements have been implemented in the **Angular Design Canvas preview**:

1. **Settings moved to a modal:** The main page retains the Surah banner, compact listening setup, passage navigation, and reading pane. A native accessible <dialog> (openable from either the sidebar or the main page) contains listening mode, reciter, Guided/German immersion presets, ordered languages, reading-display choices, and the existing breakpoint editor. Closing the dialog does not interrupt playback; settings changes still regenerate the queue. Escape closes the native dialog.
2. **Context remains grouped; dual translations become Ayah-paired:** Each Arabic passage (according to existing breakpoints) is played in full. For two translations, the subsequent spoken segments follow **translation 1 of Ayah N → translation 2 of Ayah N → translation 1 of Ayah N+1 → translation 2 of Ayah N+1**. A single translation still plays the entire translated passage consecutively. The reader continues showing the whole passage, and highlights the currently playing Ayah.
3. **Bounded prebuffering:** The client audio player maintains the current MP3 and **two next MP3s**, calling `load()` early with `preload=auto`. At each track boundary, playback switches to the already-prepared HTMLAudioElement rather than replacing an element's `src` at the last moment. Browser buffering reduces gaps but **cannot guarantee sample-accurate gapless playback** across remote MP3s or variable network conditions. Memory is bounded because older audio elements are released.

Code: `frontend/src/features/listening-studio/audio-plan.ts`, `frontend/src/features/listening-studio/media-playback.ts`, `frontend/src/features/listening-studio/components/player/{app.component.html,app.component.ts,settings-ui.css}`.

Verification: four Node tests at `frontend/tests/listening-studio.test.cjs` check pairing, single-language grouping, ordered media URLs, and buffer-window advancement. Both Angular builds pass; browser inspection confirmed the dialog, the 16-stage two-passage Al-Fatihah queue, live buffered elements with `readyState=4`, the highlighted Ayah, and the sequence jumping from Arabic to English 1 and the preloaded German 1. Design Canvas managed-v2 structure remains valid (4 ports, 8 adapters, zero issues).

**Production backend limitation remains:** The backend does not yet support the German audio edition or new combined translation response. The preview uses the existing audio-media port once per language and streams public provider MP3s. No backend changes or commit were made here.

## 29 October 2026 — fixed reciter, autosave, high-memory audio cache

**Delivered:** Minshawi Mujawwad 192 kbps is the only frontend reciter and its dropdown was removed. The Save setup action was removed in favor of reactive automatic `localStorage` persistence. A generic high-capacity browser-session Blob cache and phase-aware rolling two-Ayah download window replaced URL-only audio-element preloading. Arabic media is downloaded first, with no translation media downloads until the Arabic passage completes. The next two translation tracks are then fetched, moving forward by one as playback proceeds.

**Important integration detail:** Browser CORS allows direct EveryAyah blob downloading but blocks the verified German and English CDN hosts. Therefore the standalone mock Design Canvas preview uses native audio preloading as a fallback for those hosts; this cannot guarantee retained JavaScript bytes. A restricted `/api/quran/media` FastAPI proxy with an explicit allowlist supplies same-origin MP3 bytes when the production app runs with its backend. Streaming pauses are minimized, but **gapless audio is not guaranteed**, especially when a new audio phase first starts or a source does not permit binary downloads.

Frontend tests verify cache reuse, LRU memory eviction, audio stage ordering, delayed translation downloads, and fallback behavior. Backend tests verify the MP3 endpoint's host/path restrictions, media bytes, content type and redirects. The backend audio catalog's German edition remains pending; this proxy is not a substitute for that metadata integration.

**No commit made.**

The automatic preference store now also retains a **separate breakpoint set per Surah**, so switching between Surahs does not discard previously edited boundaries.

## 29 October 2026 — scheduled Web Audio and per-Ayah playback controls (latest)

**Implemented:** Replaced HTMLAudioElement-to-HTMLAudioElement handoff for CORS-readable recordings with one AudioContext and decoded AudioBufferSourceNodes scheduled on a common audio timeline. Each subsequent recording starts at the previous decoded recording’s calculated end time; the `ended` callback updates state and requests more downloads but **does not start the next scheduled buffer**. At phase start, two recordings are downloaded/decoded together. During an Arabic passage, subsequent Arabic recordings are prepared as the playing window advances; translations are not downloaded until that Arabic passage finishes. The generic compressed MP3 Blob cache remains in browser memory, while only the active and next decoded buffers are retained by the player.

**UI:** Removed fixed bottom player. The reading pane now provides one overall **Play sequence / Pause** control and a separate **Arabic** playback button for every displayed Ayah, plus a **Listen** button for each displayed translated Ayah. Selecting any individual clip interrupts the overall sequence, and vice versa; the user can repeat each verse without changing their passage configuration. All controls retain semantic labels and current-Ayah highlighting.

**Backend production integration completed:** Registered `de.bubenheim.nail` (Bubenheim/Elyas narration by Nail ibn Radhan); explicitly rejects the incomplete Al-Baqarah German audio set (2:283–286). Added `GET /api/quran/surahs/{id}/verses`, which retrieves and caches Arabic and German/English/Urdu QuranEnc text with attribution. The already-existing `GET /api/quran/media?url=...` restricted audio bridge makes audio from non-CORS providers available as same-origin downloaded Blobs when the production Angular app runs with FastAPI.

**Limitations:** Native audio remains a fallback only for the mock Design Canvas preview when a source disallows JavaScript CORS downloads. That fallback **cannot guarantee gapless transitions**; for German/English/Urdu Web Audio scheduling, run the production-backed Angular configuration and FastAPI. Decoding/scheduling eliminates the *player’s introduced handoff delay* but not silence embedded in the source MP3s, network stalls if the next recording fails to arrive in time, or the intentional delay while switching from Arabic to the translation phase.

**Testing:** Frontend tests check exact scheduling, Arabic-phase prefetch priorities, pause/resume offsets and non-CORS fallback. Backend tests cover German edition wiring, missing Ayahs, QuranEnc text and the allowlisted audio bridge. No commit made.
