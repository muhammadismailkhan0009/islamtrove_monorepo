# Long-Surah progressive streaming — implementation handoff

Clarified requirement: **start playing a large Surah MP3 while it is still downloading**, without a new "Play from Ayah" UI. The latter was removed.

## Player pipeline
- Short recordings (up to 240s on the QUL timing span) still use compressed Blob cache and Web Audio.
- Long recordings use the remote MP3 URL on a native HTMLAudioElement with preload="auto". The browser progressively buffers and can play before the complete file transfers. No full-file fetch/Blob/decodeAudioData is awaited.
- If the CDN supports HTTP Range (206), browsers can seek efficiently; this has not been independently verified for every origin. Native media caching is browser-controlled, not the same as the app's completed Blob memory cache.
- A continuous Surah HTMLAudioElement is reused within the player when Arabic recitation resumes after translation stages. QUL Ayah timestamps still determine passage start/end positions.
- Arabic-only sequential passages can use one uninterrupted MP3 with timestamp-driven UI passage highlighting. The translation grouping rules are unchanged.

## Mock catalog and listening breakpoints
- Added **Al-Kahf (Surah 18, 110 Ayahs)** and **Al-Baqarah (Surah 2, 286 Ayahs)** to the Design Canvas mock Surah list and translation-index fixture. Al-Kahf 18:1 uses global Ayah 2141; Al-Baqarah 2:1 uses global Ayah 8.
- Suggested Al-Kahf passage boundaries: 10, 26, 44, 59, 70, 82, 98, 110. Editable and never overwrite saved user boundaries.
- The Design Canvas verse-text fixture is still limited to five Surahs; these additions enable audio/passage controls, not new on-screen QuranEnc text content. The production QuranEnc API supports full text.

## Testing
Not run per user instruction. User will test the preview. No commit made.

## 29 October 2026 — full verse text, Bismillah, and Al-Baqarah startup

- The mock VersePreview adapter now uses QuranEnc's public CORS-enabled Surah API for any Surah missing from the five-Surah local fixture. It fetches `german_bubenheim`, `english_rwwad` and `urdu_junagarhi` concurrently; Arabic text comes with the translations. The preview caches successful requests in memory, validates ordered Ayahs and matching counts, and shows a real error and retry option rather than claiming only five Surahs have text. Production already uses the FastAPI QuranEnc text endpoint.
- The Arabic Bismillah is a **separate EveryAyah Ayah-zero** recording: `https://everyayah.com/data/Minshawy_Mujawwad_192kbps/018000.mp3` for Al-Kahf and `002000.mp3` for Al-Baqarah. It is inserted **only when starting the Surah from its first Ayah**, never before every later passage. No added Bismillah for Al-Fatihah (included in its Ayah 1) or At-Tawbah (traditionally begins without it). The Bismillah also appears as a separate unnumbered text heading in the first passage.
- With decoded short Surahs, the small Ayah-zero clip overlaps the next decoded Arabic section by 75 ms using Web Audio gains. For large streaming sources, the next remote MP3 is loaded in parallel and an early, best-effort native handoff fades from Bismillah. A gap-free transition is not guaranteed if network buffering is delayed.
- **Al-Baqarah:** QUL currently advertises a ~293MB recording and HTTP Range support. We removed the long-file *pre-playback* check that rejected the entire source if its physical duration was shorter than QUL's final Ayah timestamp. When starting at time zero, a native media element can begin buffering/playing immediately without waiting for the full 293MB or metadata/seeking at the far end. The player still guards the selected Ayah timestamp boundaries; premature source EOF raises an explicit error. Preparation and media errors now include a diagnostic reason / browser MediaError code.

**No browser test, npm build or playback verification performed** at the user's request; the user will validate the fixes. No commit made.
