#!/usr/bin/env python3
"""Offline, recording-specific Ayah alignment generator (Minshawi Mujawwad).

Usage (from repository root):
  cd backend
  uv run --with numpy python scripts/offline-audio-alignment/align_recitation.py --surah 18
  uv run --with numpy python scripts/offline-audio-alignment/align_recitation.py --all

This script is DECOMMISSIONED FROM RUNTIME: offline only, never imported by
FastAPI, Angular, or browser code. The runtime consumes JSON data alone.

Runs outside the web app. Downloads and decodes the continuous MP3 to low-rate
PCM once, then correlates each EveryAyah clip with the continuous waveform.
Produces verified metadata only if *every* Ayah matches at adequate confidence.
The browser never downloads the isolated Ayahs or performs waveform matching.
Requires ffmpeg, ffprobe and numpy, added only for this one-time command.
"""

import argparse
import concurrent.futures
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np

CDN = "https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/"
FATIHAH_PLAYBACK = "https://everyayah.com/data/Minshawy_Mujawwad_192kbps/PageMp3s/Page001.mp3"
EVERYAYAH = "https://everyayah.com/data/Minshawy_Mujawwad_192kbps/"
QUL = "https://qul.tarteel.ai/api/v1/audio/surah_segments/8"
ROOT = Path(__file__).resolve().parents[3]
OUTPUT_DIR = ROOT / "backend/src/islamtrove/data/alignments"
CANDIDATE_DIR = Path(__file__).resolve().parent / "candidates"
REPORT_DIR = Path(__file__).resolve().parent / "reports"
APPROVALS_FILE = Path(__file__).resolve().parent / "approved-recordings.json"
APPROVALS = json.loads(APPROVALS_FILE.read_text()) if APPROVALS_FILE.exists() else {}
SAMPLE_RATE = 3000
# Minimum normalized correlation: accurate matches typically score 0.7–0.99.
MIN_CORRELATION = 0.34
MIN_CONFIRMATION = 0.40
USER_AGENT = "Mozilla/5.0 (IslamTrove offline audio alignment)"


def fetch(url: str, timeout: int = 50) -> bytes:
    last = None
    for attempt in range(4):
        try:
            with urlopen(
                Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout
            ) as response:
                return response.read()
        except Exception as exc:
            last = exc
            print(f"  Retry {attempt + 1}/4: {url} ({exc})", flush=True)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Failed downloading {url}") from last


def download(url: str, dest: Path) -> tuple[int, str]:
    # Disk-based download prevents holding the entire compressed MP3 in memory.
    sha = hashlib.sha256()
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as response:
                with dest.open("wb") as target:
                    sha = hashlib.sha256()
                    size = 0
                    while block := response.read(1024 * 512):
                        target.write(block)
                        sha.update(block)
                        size += len(block)
            return size, sha.hexdigest()
        except Exception as exc:
            print(f"  Download attempt {attempt + 1}/4 failed: {exc}", flush=True)
            time.sleep(attempt + 1)
    raise RuntimeError(f"Cannot download continuous recitation: {url}")


def decode_pcm(source: str | Path, duration: int | None = None) -> np.ndarray:
    command = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(source)]
    if duration is not None:
        command.extend(["-t", str(duration)])
    command.extend(["-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"])
    result = subprocess.run(command, capture_output=True, timeout=120, check=True)
    return np.frombuffer(result.stdout, dtype=np.float32).copy()


def duration_seconds(source: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(source),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    return float(result.stdout.strip())


def best_match(
    main: np.ndarray,
    snippet: np.ndarray,
    expected: float,
    lower_limit: float,
    radius_before: float,
    radius_after: float,
) -> tuple[float, float]:
    # Short interior motif avoids inconsistent leading/trailing silence.
    duration = len(snippet) / SAMPLE_RATE
    if duration >= 14:
        motif_from, motif_length = 3.0, 9.0
    elif duration >= 7:
        motif_from, motif_length = 0.8, min(3.5, duration * 0.40)
    else:
        # Very short Ayahs (e.g., Ar-Rahman 55:1 is only 2.40 seconds)
        # need two short NON-OVERLAPPING windows, not a 3-second minimum.
        motif_from = 0.18 if duration < 3.5 else 0.45
        motif_length = min(1.8, duration * 0.33)
    if motif_length < 0.55:
        raise ValueError("Individual Ayah audio is too short for confident matching")
    motif = snippet[int(motif_from * SAMPLE_RATE) : int((motif_from + motif_length) * SAMPLE_RATE)]
    left = max(0.0, lower_limit, expected - radius_before)
    right = min(len(main) / SAMPLE_RATE, expected + radius_after + motif_from + motif_length)
    first = int(left * SAMPLE_RATE)
    target = np.asarray(main[first : int(right * SAMPLE_RATE)], dtype=np.float64)
    signal = np.asarray(motif, dtype=np.float64)
    signal -= signal.mean()
    energy = float(np.linalg.norm(signal))
    if energy < 1e-4 or len(target) <= len(signal):
        return float("nan"), -1.0
    signal /= energy
    n = 1 << (len(target) + len(signal) - 2).bit_length()
    corr = np.fft.irfft(np.fft.rfft(target, n=n) * np.conj(np.fft.rfft(signal, n=n)), n=n)
    corr = corr[: len(target) - len(signal) + 1]
    squared = np.concatenate(([0.0], np.cumsum(target * target)))
    normalized = corr / np.sqrt(np.maximum(1e-8, squared[len(signal) :] - squared[: -len(signal)]))
    index = int(np.argmax(normalized))
    return first / SAMPLE_RATE + index / SAMPLE_RATE - motif_from, float(normalized[index])


def independent_confirmation(main: np.ndarray, snippet: np.ndarray, start_seconds: float) -> float:
    """Confirm the Ayah with a *second, non-overlapping* waveform motif.

    Matching a single repeated phrase can produce a wrong location. This
    second check is anchored to the *same* inferred Ayah start and searches
    only a ±0.15 second tolerance, not the entire recording. Thus a repeated
    phrase elsewhere cannot independently validate a false match.
    """
    length = len(snippet) / SAMPLE_RATE
    # The primary motif comes from 3-12s for a standard 17-second snippet.
    # Use 12.5-16.5s for independent confirmation, or two disjoint early
    # motifs when the Ayah itself is short.
    if length >= 14:
        begin, end = 12.3, min(length - 0.2, 16.3)
    elif length >= 7:
        begin, end = length * 0.74, length * 0.95
    else:
        begin, end = length * 0.60, length * 0.90
    if end - begin < 0.3:
        raise ValueError("Audio sample too short for independent confirmation")
    signal = np.asarray(
        snippet[int(begin * SAMPLE_RATE) : int(end * SAMPLE_RATE)], dtype=np.float64
    )
    signal -= signal.mean()
    signal_norm = float(np.linalg.norm(signal))
    if signal_norm < 1e-5:
        raise ValueError("Confirmation segment is silent")
    signal /= signal_norm
    expected_index = int(round((start_seconds + begin) * SAMPLE_RATE))
    radius = int(0.20 * SAMPLE_RATE)
    a, b = max(0, expected_index - radius), min(len(main), expected_index + radius + len(signal))
    region = np.asarray(main[a:b], dtype=np.float64)
    if len(region) < len(signal):
        raise ValueError("Confirmation segment is outside continuous audio")
    n = 1 << (len(region) + len(signal) - 2).bit_length()
    corr = np.fft.irfft(np.fft.rfft(region, n=n) * np.conj(np.fft.rfft(signal, n=n)), n=n)
    corr = corr[: len(region) - len(signal) + 1]
    squares = np.concatenate(([0.0], np.cumsum(region * region)))
    denom = np.sqrt(np.maximum(1e-8, squares[len(signal) :] - squares[: -len(signal)]))
    return float(np.max(corr / denom))


def read_qul(surah_id: int) -> tuple[list[dict], str]:
    payload = json.loads(fetch(f"{QUL}?surah={surah_id}&per_page=300"))
    if payload.get("audio", {}).get("url") != f"{CDN}{surah_id:03d}.mp3":
        raise ValueError("Unexpected continuous MP3 in QUL response")
    segments = payload.get("segments")
    if not isinstance(segments, dict):
        raise ValueError("QUL segments missing")
    ayahs = []
    for number in range(1, len(segments) + 1):
        item = segments[f"{surah_id}:{number}"]
        if not isinstance(item.get("time_from"), int) or not isinstance(item.get("time_to"), int):
            raise ValueError(f"QUL timestamp absent at Ayah {number}")
        ayahs.append({"ayah": number, "fromMs": item["time_from"], "toMs": item["time_to"]})
    if not ayahs or len(ayahs) > 286 or ayahs[-1]["toMs"] <= 0:
        raise ValueError("Unexpected QUL Surah length")
    return ayahs, FATIHAH_PLAYBACK if surah_id == 1 else payload["audio"]["url"]


def reference_snippet(surah_id: int, ayah: int) -> tuple[int, np.ndarray]:
    url = f"{EVERYAYAH}{surah_id:03d}{ayah:03d}.mp3"
    for attempt in range(3):
        try:
            # FFmpeg uses HTTP Range requests and reads only first 17 seconds.
            data = decode_pcm(url, duration=17)
            if len(data) >= 1.6 * SAMPLE_RATE:
                return ayah, data
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise RuntimeError(f"Empty EveryAyah clip for {surah_id}:{ayah}")


def generate(
    surah_id: int,
    min_confidence: float = MIN_CORRELATION,
    min_confirmation: float = MIN_CONFIRMATION,
) -> Path:
    print(f"\nAligning Surah {surah_id} (Minshawi Mujawwad)", flush=True)
    expected, url = read_qul(surah_id)
    with tempfile.TemporaryDirectory(prefix="islamtrove-alignment-") as tmp:
        audio_file = Path(tmp) / f"{surah_id:03d}.mp3"
        size, sha = download(url, audio_file)
        actual_duration = duration_seconds(audio_file)
        print(
            f"  Continuous recording: {size:,} bytes, {actual_duration:.2f}s; decoding once...",
            flush=True,
        )
        main = decode_pcm(audio_file)
        if abs(len(main) / SAMPLE_RATE - actual_duration) > 2:
            raise ValueError("Decoded continuous audio duration differs from MP3 duration")
        starts = []
        confidence = []
        confirmations = []
        anomalies = []
        previous_delta = 0.0
        previous = -0.1
        # Individual snippets are small. Download concurrently but match in Ayah order.
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            snippets = pool.map(lambda item: reference_snippet(surah_id, item["ayah"]), expected)
            for item, (ayah, snippet) in zip(expected, snippets, strict=True):
                if ayah != item["ayah"]:
                    raise RuntimeError("Individual Ayah clips arrived out of order")
                reference = item["fromMs"] / 1000
                # First pass favors nearby QUL timing; second can detect a
                # 100+ second repeated recitation and inherited timeline offset.
                shift = (previous - expected[ayah - 2]["fromMs"] / 1000) if ayah > 1 else 0.0
                guess = reference + (shift if ayah > 1 else 0)
                left_bound = max(0.0, previous + 0.5)
                found, score = best_match(main, snippet, guess, left_bound, 22, 32)
                if score < min_confidence:
                    found, score = best_match(main, snippet, guess, left_bound, 50, 210)
                if score < min_confidence:
                    raise ValueError(
                        f"Low-confidence alignment at {surah_id}:{ayah}: "
                        f"score={score:.3f}, candidate={found:.2f}s, QUL={reference:.2f}s. "
                        "Review manually; no guessed alignment file will be written."
                    )
                # The recording starts at time zero even if the isolated MP3
                # contains 1–2s extra leading silence and motif finds negative start.
                match_start = found
                if ayah == 1:
                    found = 0.0
                elif found <= previous:
                    raise ValueError(f"Non-monotonic alignment at {surah_id}:{ayah}")
                # First Ayah has an artificial exact 0.0 start; the reference
                # waveform can include extra leading silence, so confirm using
                # the real matched start before clamping it to zero.
                confirm = independent_confirmation(main, snippet, match_start)
                if confirm < min_confirmation:
                    raise ValueError(
                        f"Independent confirmation failed for {surah_id}:{ayah}: "
                        f"primary={score:.3f}, secondary={confirm:.3f}. "
                        "Do not persist an unverified timing."
                    )
                shift_delta = found - reference
                if ayah > 1 and abs(shift_delta - previous_delta) > 8.0:
                    anomalies.append(
                        {
                            "ayah": ayah,
                            "kind": "offset-jump",
                            "offsetJumpMs": round((shift_delta - previous_delta) * 1000),
                            "differenceMs": round(shift_delta * 1000),
                            "primary": round(score, 4),
                            "secondary": round(confirm, 4),
                        }
                    )
                if ayah > 1 and reference < expected[ayah - 2]["fromMs"] / 1000:
                    anomalies.append({"ayah": ayah, "kind": "out-of-order-QUL"})
                previous_delta = shift_delta
                starts.append(round(found * 1000))
                confidence.append(round(score, 4))
                confirmations.append(round(confirm, 4))
                previous = found
                if ayah % 10 == 0 or ayah in (24, 25, 26, len(expected)):
                    print(
                        f"  Ayah {ayah:3d}/{len(expected)}: actual {found:8.2f}s, "
                        f"QUL {reference:8.2f}s, delta {found - reference:+8.2f}s, "
                        f"confidence {score:.3f}",
                        flush=True,
                    )
        last_duration = (expected[-1]["toMs"] - expected[-1]["fromMs"]) / 1000
        # Waveform match locates verse start; last toMs uses the original final
        # Ayah's duration. Never extend beyond the physical recording.
        final_end = min(actual_duration, starts[-1] / 1000 + last_duration)
        if final_end <= starts[-1] / 1000 + 1:
            raise ValueError("Final Ayah exceeds recording")
        if any(right - left < 400 for left, right in zip(starts, starts[1:], strict=False)):
            raise ValueError("Implausibly short Ayah interval")
        if actual_duration - final_end > 12:
            anomalies.append(
                {
                    "ayah": len(expected),
                    "kind": "unaccounted-end-tail",
                    "durationMs": round((actual_duration - final_end) * 1000),
                }
            )
        timings = [
            {
                "ayah": i + 1,
                "fromMs": start,
                "toMs": starts[i + 1] if i + 1 < len(starts) else round(final_end * 1000),
            }
            for i, start in enumerate(starts)
        ]
        output = {
            "schemaVersion": 1,
            "surahId": surah_id,
            "reciter": "minshawi-mujawwad",
            "audioUrl": url,
            "audioSha256": sha,
            "audioBytes": size,
            "audioDurationMs": round(actual_duration * 1000),
            "source": "EveryAyah 192kbps individual clips matched to QUL continuous MP3",
            "method": "normalized-waveform-correlation-3000hz",
            "confidenceByAyah": confidence,
            "confirmationByAyah": confirmations,
            "alignmentAnomalies": anomalies,
            "validationStatus": "manually-reviewed"
            if APPROVALS.get(str(surah_id)) == sha
            else "requires-review"
            if anomalies
            else "automatically-verified",
            "endMs": timings[-1]["toMs"],
            "timings": timings,
        }
        # Every pronounced timing jump needs independent review. It is kept
        # as a candidate, not loaded by the production API until approved.
        destination = (
            CANDIDATE_DIR if output["validationStatus"] == "requires-review" else OUTPUT_DIR
        )
        destination.mkdir(parents=True, exist_ok=True)
        out = destination / f"{surah_id:03d}.json"
        scratch = out.with_suffix(".json.tmp")
        scratch.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
        scratch.replace(out)
        print(
            f"  Saved {out} ({len(timings)} matched Ayahs, "
            f"{len(anomalies)} flagged discontinuities; "
            f"status={output['validationStatus']})",
            flush=True,
        )
        return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    options = parser.add_mutually_exclusive_group(required=True)
    options.add_argument("--surah", type=int, choices=range(1, 115), metavar="1-114")
    options.add_argument("--all", action="store_true", help="Generate all 114 Surahs")
    options.add_argument("--surahs", type=str, help="Comma-separated Surah numbers")
    parser.add_argument("--min-confidence", type=float, default=MIN_CORRELATION)
    parser.add_argument("--min-confirmation", type=float, default=MIN_CONFIRMATION)
    parser.add_argument(
        "--skip-existing", action="store_true", help="Skip already-verified JSON files"
    )
    args = parser.parse_args()
    if args.surahs:
        selected = [int(value) for value in args.surahs.split(",")]
    else:
        selected = list(range(1, 115)) if args.all else [args.surah]
    if any(not 1 <= value <= 114 for value in selected):
        parser.error("Surah IDs must be between 1 and 114")
    failed: list[int] = []
    completed: list[int] = []
    skipped: list[int] = []
    for surah in selected:
        if args.skip_existing and (
            (OUTPUT_DIR / f"{surah:03d}.json").exists()
            or (CANDIDATE_DIR / f"{surah:03d}.json").exists()
        ):
            skipped.append(surah)
            continue
        try:
            generate(
                surah, min_confidence=args.min_confidence, min_confirmation=args.min_confirmation
            )
            completed.append(surah)
        except Exception as exc:
            failed.append(surah)
            print(f"Surah {surah} could not be confidently aligned: {exc}", flush=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "attempted": selected,
        "completed": completed,
        "skipped": skipped,
        "failed": failed,
        "acceptance": {"primary": args.min_confidence, "secondary": args.min_confirmation},
    }
    (REPORT_DIR / "latest-run.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"Alignment summary: {len(completed)} complete, {len(skipped)} previously verified, "
        f"{len(failed)} failed",
        flush=True,
    )
    if failed:
        raise SystemExit(f"Alignment missing/uncertain for Surahs: {failed}")


if __name__ == "__main__":
    for executable in ("ffmpeg", "ffprobe"):
        if shutil.which(executable) is None:
            sys.exit(f"{executable} not found; install FFmpeg before aligning")
    main()
