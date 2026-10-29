# QUL continuous Minshawi Mujawwad recitation — implementation handoff

**Decision (29 October 2026): QUL's per-Ayah `time_from` / `time_to` intervals are the sole authority for the Arabic playback range.** The full MP3 may be much longer because it contains repeated renditions. We NEVER continue beyond the final selected Ayah's `time_to` merely because the file has more audio.

## Sources and identity

- [QUL resource page, Muhammad Siddiq al-Minshawi, Surah-by-Surah Mujawwad](https://qul.tarteel.ai/resources/recitation/395)
- Per-Surah Ayah/word timestamps: `https://qul.tarteel.ai/api/v1/audio/surah_segments/8?surah=112&per_page=4`
- Continuous audio: `https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/112.mp3`
- Timestamp content: `segments['112:1'] = { time_from: 0, time_to: 4490, ... }` and `segments['112:4'] = { time_from: 20760, time_to: 27730, ... }`.
- The actual Al-Ikhlas CDN recording decoded as ~102.78 s; **only 0–27.73 s is in the four-Ayah timing span**. Test confirmed Web Audio schedules precisely 20.76–27.73 s when independently playing Ayah 4.
- Earlier verification of QUL intervals covered all Ayahs in Surahs 1, 2, 112, 113, 114. Other Surahs are validated dynamically by the app, **not assumed to have been manually audited**.

## Architecture

The new `continuous-recitation` application port has:
- **Mock adapter**: obtains QUL metadata directly in the browser (CORS tested).
- **Production adapter**: obtains normalized metadata from `GET /api/quran/surahs/{id}/continuous-recitation`. The backend checks the exact approved CDN URL, contiguous ordered Ayah numbering, positive millisecond ranges, and correct Surah Ayah count against the primary Quran catalog. Caches one verified response per Surah per running app.
- The frontend port validator checks that each Ayah has non-overlapping integer start/end timestamps, matches the requested Surah, and has the expected count.
- Media API allowlist includes the exact QUL Minshawi Mujawwad full-Surah URL pattern, with `binary/octet-stream` as an accepted source response.

**Playback:** Instead of creating Arabic tracks for every Ayah, the queue creates **one Arabic track per contextual passage**, referencing the same continuous recording but with `startSeconds` from the first Ayah and `endSeconds` from the last Ayah. English/Urdu/German audio sequence remains unchanged, including dual translations paired by Ayah. Individual Arabic Ayah playback uses its own QUL interval. The reading pane tracks the spoken Ayah from the timestamp offsets.

For short Surahs (QUL total Ayah-timed span <= 240 s), the browser downloads/caches the entire MP3 Blob, decodes it, then calls Web Audio `source.start(when, startSeconds, endSeconds - startSeconds)`. No handoffs occur between Arabic Ayahs; extra renditions in the MP3 cannot play. **Decoded recording duration is checked** against the selected Ayah endpoint.

For long Surahs, the browser **streams the single original MP3** and seeks to the selected interval to avoid downloading and decoding hours of PCM into memory. A 40-ms monitor and `timeupdate` guard pause at the selected timestamp. Native HTMLAudioElement timing may be less precise than Web Audio sample scheduling, especially in suspended/background tabs; do not describe native long-file playback as sample-accurate. Full-file cached blobs are not required for huge Surahs.

Existing per-Ayah Arabic files are no longer used for the normal Arabic UI playback, although the legacy audio-media API still returns their references for compatibility. All spoken translations continue to use their existing per-Ayah audio files and cache.

## Tests and limitations

- Unit tests: validated QUL metadata, rejecting missing, inconsistent or malicious source URL, English/German translation order, clipping to 27.73 seconds even if MP3 is 102.78 s.
- Backend tests: timing authority, incorrect/partial metadata rejection, route with a mocked QUL provider, and exact Ayah-count comparison.
- The production QUL endpoint depends on QUL's external availability; QUL can occasionally deny server-side requests. Don't silently substitute a different Arabic performance or guessed timings.
- Further work: verify alignment for all 114 Surahs, audio hosting/reuse permissions, resilience of very large recording seeks and background playback.

**No commit performed.**
