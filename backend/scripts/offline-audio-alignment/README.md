# Offline whole-Quran recitation alignment

**All source preparation is offline.** This directory belongs to the backend
repository for maintaining the corpus, but nothing here is imported by
FastAPI at runtime. Production serves the saved JSON files under
`backend/src/islamtrove/data/alignments/` and streams the original QUL MP3s.

## Batch generation

From `backend/` (requires online audio sources, ffmpeg/ffprobe, and `uv`):

```bash
uv run --with librosa --with numpy python scripts/offline-audio-alignment/batch.py --all --workers 2
uv run --with librosa --with numpy python scripts/offline-audio-alignment/batch.py --surahs 108,67
python3 scripts/offline-audio-alignment/audit.py
```

The batch **skips all existing JSON** and thus never overwrites approved
recordings, manual corrections, or Ar-Rahman's existing listening-confirmed
timestamps. Partial failures are recorded in
`reports/full-quran-batch.json`; repeated runs resume missing Surahs.

### How the cross-recording generator works

1. Fetch QUL's actual continuous recording and its Ayah count for each Surah.
2. Download corresponding EveryAyah Minshawi Mujawwad 192kbps individual Ayahs
   *to a temporary directory* and assemble a reference with clip-derived
   boundaries. QUL's existing timestamps are **not** used to calculate these
   boundaries because they can be incorrect or even out of order.
3. Extract audio features from both versions; perform monotonic dynamic time
   warping, independently using MFCC, MFCC + deltas, mel spectrogram and chroma.
4. Compare estimated boundaries between feature methods. Flag significant
   disagreement or abnormal Ayah durations. The global original/alternate
   recording tempo difference and coarse alignment in longer recordings can
   trigger review markers for all Ayahs.
5. Store the original QUL URL, exact downloaded MP3 SHA-256, source byte count,
   real duration, timing ranges, confidence disagreements and review flags.
   Audio is **not** bundled into the application.

Surahs with a very long recording use a coarser global analysis grid to stay
within memory limits. These estimates are flagged for human listening review,
not presented as precision-verified matches. A generated file has
`validationStatus: experimental-cross-recording`, **not** `manually-reviewed`.

### Exceptions and safety

- Existing Al-Fatihah, Al-Kahf and An-Nas assets remain verified unchanged.
- Existing Ar-Rahman 055.json and its `backend/review-data/055.json` stay intact.
- Older `align_recitation.py` (same-waveform matching), `assemble_surah.py`,
  `approve_candidate.py` and their unapproved `candidates/` are retained here
  for maintenance. The whole-Quran batch uses `align_cross_recording.py`.
- Failed downloads or inadequate matches never create silent fabricated audio
  boundaries. They remain reported as unresolved Surahs for retry/investigation.
- Review/override data lives separately in `backend/review-data/NNN.json`,
  keyed by the **original MP3 SHA-256**. Recalculation against a new recording
  must not reuse old corrections without a source review.
- The frontend shows red markers for ambiguous Ayahs, and only authenticated
  admins can mark a timestamp verified or correct it. A correction updates the
  preceding Ayah's end and the playback API's effective timeline.

Read `backend/docs/ADMIN_ALIGNMENT_REVIEW.md` for admin authentication and
persistence behavior. The batch status can be audited without redownloading
any audio.
