# Offline continuous-Ayah audio alignment

**Purpose.** QUL's individual-Ayah timestamps can differ from the *continuous* Minshawi Mujawwad MP3 when a Surah recording contains repeated/alternate recitation. For Surah 18, its continuous MP3 includes an approximately 105-second additional section after the start of Ayah 24, so the uncorrected QUL metadata highlights Ayah 25 too early and prematurely stops at the end of the Surah.

## One-time generator

From `backend/`, with `ffmpeg`, `ffprobe`, `uv` and internet access:

```bash
uv run --with numpy python scripts/offline-audio-alignment/align_recitation.py --surah 18
# Or attempt every Surah in one offline batch:
uv run --with librosa --with numpy python scripts/offline-audio-alignment/batch.py --all --workers 2
```

`numpy` is only needed for the offline script, **not** when the app serves audio or when a browser plays it. The script:

1. Fetches QUL's original time references and the exact continuous Surah MP3 (for Al-Fatihah, the actual Page001 recording used by IslamTrove).
2. Downloads the continuous MP3 once to an automatically cleaned temporary directory; records its byte count and SHA-256, and decodes mono PCM at 3 kHz. It fetches approximately 17 seconds of each EveryAyah individual-Ayah MP3 concurrently without downloading their entire files.
3. Correlates interior waveform motifs against the actual continuous recording using normalized FFT-based cross-correlation, first near QUL's expected position, then over an expanded search if necessary. A recovered shift from one Ayah is used as the next search anchor.
4. Requires **two non-overlapping waveform confirmations** for each Ayah, verifies monotonic start times, and makes each Ayah end where the next Ayah starts. Additional material between Ayahs is assigned to the preceding Ayah. The final Ayah's end is estimated using the original clip duration, bounded by the MP3's real duration; an unexplained end tail exceeding 12s requires review.
5. Writes safe alignments into `src/islamtrove/data/alignments/SSS.json` and flagged but matched recordings to `scripts/offline-audio-alignment/candidates/SSS.json`. A failed confirmation produces no alignment. Flags must be reviewed before promotion. The historical waveform-only `--all` is **not** used for the Quran-wide batch; use `batch.py` above instead.

**The browser never does waveform analysis.** There is no mobile CPU cost, duplicate Ayah download or runtime alignment process.

## Generated Al-Kahf metadata

- File: `src/islamtrove/data/alignments/018.json`
- All 110 Ayahs matched. Minimum normalized waveform correlation: **0.4772** (the acceptance floor is 0.37).
- Source recording: `https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/018.mp3`
- Recording length: **4025.757 seconds**. Corrected final Ayah endpoint: **4023.993 seconds**.
- Ayah 24: approximately `948.574s` → `1088.635s` (extra recital segment included)
- Ayah 25 begins at approximately **1088.635s** instead of QUL's **985.480s**.
- The SHA-256 and byte length of the source file are included in the JSON to identify the exact recording the alignment was computed against.

## Application integration

`GET /api/quran/surahs/18/continuous-recitation` automatically loads this local JSON and validates its source URL, reciter, count, sequential Ayahs, contiguous boundaries and final duration. The endpoint serves the corrected file **without fetching QUL**. Other Surahs use the locally saved experimental alignment when present; only missing Surahs fall back to raw QUL timestamps. A corrupt local alignment returns an error rather than silently switching back to wrong timestamps.

The existing Angular continuous-recitation adapter accepts the corrected timestamps without a new player API. The UI Ayah monitor, passage playback, Ayah-specific clip seeking, and final stop point all use the corrected timing values. The continuously streamed recording is **not** modified, split or downloaded into browser memory. Recitation and spoken translations remain independent.

## Verification

```bash
cd backend
uv run pytest -q
uv run ruff check .
uv run pyright
cd ../frontend
npm test
npm run build
```

Compare Ayahs **23–26** and then **30, 75, 110** in the frontend. A correction cannot guarantee sub-second alignment if a source provider changes the actual audio file later; on CDN changes, re-run the generator and revalidate the SHA-256. Repeated material is displayed under the last matched Ayah until the next matched Ayah begins. A low-confidence source or a different recital cannot safely inherit this JSON.

## Retirement / implementation status

All offline source-code lives in `backend/scripts/offline-audio-alignment/`; it is **never imported by FastAPI**. The original short-clip waveform matcher remains for specialized cases, while the Quran-wide generator uses cross-recording DTW. Review markers and administrator overrides are stored independently from generator files. The initial 10-Surah pilot results described above are historical; the current coverage is reported in `scripts/offline-audio-alignment/reports/corpus-status.json` after running `audit.py`. See [current batch methodology](../scripts/offline-audio-alignment/README.md).

### Ar-Rahman fallback (55): preserve QUL's original recording

QUL 55's original continuous file lasts ~1262.38 seconds, while the published QUL Ayah timestamps and faster EveryAyah clips total ~1043.33 seconds. QUL's source timings additionally move backward at 55:46. Therefore a constant offset or simple time scaling cannot give reliable boundaries.

`scripts/offline-audio-alignment/align_cross_recording.py` performs **offline global dynamic time warping**, constrained to preserve Ayah order, between a temporarily compiled reference and the original continuous CDN MP3. It checks four distinct speech features (MFCC, MFCC + delta, mel, chroma) and saves the provisional, recording-specific 055.json. Differences among methods are flagged for listening review; 20 Ayahs are currently flagged, especially 21–27. The browser continues to stream the **unmodified QUL MP3** through the existing audio proxy, and does not perform analysis. No audio file is bundled or served from application disk.

The 055.json explicitly has `validationStatus: experimental-cross-recording` and `reviewRequired: true`; it is active only for manual frontend evaluation. It should not be represented as fully verified or submitted upstream until someone checks the flagged sections by listening.

## Surah 21 (Al-Anbiya): full Assabile streaming source

QUL's 021.mp3 returned an incomplete 10 MiB file. Its timestamps must NOT be
used for this source. IslamTrove now streams the full 58:38 Minshawi Mujawwad
recitation directly from Assabile through the existing range-aware
/api/quran/stream proxy and browser IndexedDB chunk cache.

Source URL:

    https://media.assabile.com/assabile/recitations_7892537823/mp3/mohamed-seddik-el-menchaoui/mohamed-seddik-el-menchaoui-021-al-anbiya-23449-6566.mp3

The entire remote MP3 was fetched and SHA256-compared to the complete locally
provisioned reference at backend/src/islamtrove/data/audio/21.mp3:

- Bytes: 28,150,205
- SHA256: 2c10e77e5f62c2f7039ce18de0e07251c0dad3098afba390c8fa246bdef2d8d6
- Duration: 3,517,989 ms
- Provider supports HEAD/GET with HTTP byte ranges and 206 responses.

Playback URL carries ?v=2c10e77e5f62 so browser caches cannot mix versions.
The backend only proxies this exact URL (in addition to existing QUL sources).
It checks the provider ETag and byte length to prevent serving another
recording under the same immutable timeline.

The 112 timestamp boundaries in the 021.json manifest were NOT changed.
Their status is still experimental, pending manual listening review. No MP3
needs to be stored on the application server or shipped in Git; the existing
gitignored local audio file is only needed for future offline alignment.

Regenerate metadata only after verifying that the audio source is unchanged:

    cd backend
    uv run --with librosa --with scipy --with numpy python scripts/offline-audio-alignment/align_cross_recording.py --surah 21 --target src/islamtrove/data/audio/21.mp3 --serve-assabile --overwrite

The --serve-assabile option rejects local MP3s with the wrong SHA256 and
publishes the verified remote source URL. Never overwrite metadata while
existing admin corrections require source-specific migration. If the remote
file changes, first verify its full bytes and regenerate the corresponding
timings; then update the backend allowlist, ETag, and source fingerprint.

## Unified backend full-Quran batch

The offline tools and review reports have been consolidated under
`backend/scripts/offline-audio-alignment/`. For original-QUL cross-recording
alignment, use the resumable batch:

```sh
cd backend
uv run --with librosa --with numpy python scripts/offline-audio-alignment/batch.py --all --workers 2
python3 scripts/offline-audio-alignment/audit.py
```

The batch keeps previously reviewed/verified alignments immutable; only missing
Surahs are generated. Source-specific JSONs are kept in
`backend/src/islamtrove/data/alignments/`, and all provisional alignments
retain `reviewAyahs` flags for the admin verification UI. See the tools README
for details. `full-quran-batch.json` lists download/alignment failures for retry.
