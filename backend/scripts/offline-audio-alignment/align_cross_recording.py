#!/usr/bin/env python3
"""OFFLINE ONLY: map Ayahs between differently paced performances of one Surah.

This is intended for review, NOT automatic certification. Four independent
feature representations are globally time-warped, then all suspicious or
mutually inconsistent boundaries are explicitly flagged. On runtime only the
JSON timings and the original CDN recording are used (no NumPy/FFmpeg).

Run from backend/:
  uv run --with librosa --with numpy python \\
    scripts/offline-audio-alignment/align_cross_recording.py --surah 55

Optional --reference and --target allow reusing existing local MP3s; otherwise
the reference is assembled in a temporary directory from EveryAyah clips and
the target comes from the original QUL CDN. No audio is persisted in the repo.
"""

import argparse
import hashlib
import json
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import librosa
import numpy as np
from scipy.spatial.distance import cdist

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "backend/src/islamtrove/data/alignments"
CDN = "https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/"
EVERYAYAH = "https://everyayah.com/data/Minshawy_Mujawwad_192kbps/"
QUL = "https://qul.tarteel.ai/api/v1/audio/surah_segments/8"
ASSABILE_21 = (
    "https://media.assabile.com/assabile/recitations_7892537823/mp3/"
    "mohamed-seddik-el-menchaoui/"
    "mohamed-seddik-el-menchaoui-021-al-anbiya-23449-6566.mp3"
)
ASSABILE_21_SHA = "2c10e77e5f62c2f7039ce18de0e07251c0dad3098afba390c8fa246bdef2d8d6"

SAMPLE_RATE = 8000
HOP = 1600  # 0.2s default for full-corpus throughput, adaptive for very long Surahs


def fetch(url: str) -> bytes:
    for attempt in range(3):
        try:
            with urlopen(
                Request(url, headers={"User-Agent": "IslamTrove offline audio audit"}),
                timeout=60,
            ) as f:
                return f.read()
        except (TimeoutError, URLError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("Unreachable HTTP retry limit")


def pcm(path: Path) -> np.ndarray:
    # The temporary EveryAyah reference is decoded directly to mono f32 PCM
    # in ONE ffmpeg pass. Avoid expensive full-length MP3 re-encoding and then
    # decoding it again, especially for Al-Baqarah and other long Surahs.
    if path.suffix == ".f32le":
        return np.fromfile(path, dtype="float32")
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-i",
        str(path),
        "-ar",
        str(SAMPLE_RATE),
        "-ac",
        "1",
        "-f",
        "f32le",
        "pipe:1",
    ]
    res = subprocess.run(cmd, check=True, capture_output=True, timeout=160)
    return np.frombuffer(res.stdout, dtype="float32").copy()


def seconds(path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    return float(subprocess.run(cmd, text=True, capture_output=True, check=True, timeout=30).stdout)


def assembled_reference(surah: int, count: int, temp: Path) -> tuple[Path, list[int]]:
    # Same reference construction as the standalone archived assembly utility,
    # but the output is always temporary and never shipped with IslamTrove.
    from concurrent.futures import ThreadPoolExecutor

    def clip(i: int) -> Path:
        path = temp / f"{surah:03d}{i:03d}.mp3"
        path.write_bytes(fetch(f"{EVERYAYAH}{surah:03d}{i:03d}.mp3"))
        if path.stat().st_size < 1024:
            raise ValueError(f"Empty reference clip {surah}:{i}")
        return path

    with ThreadPoolExecutor(max_workers=6) as pool:
        paths = list(pool.map(clip, range(1, count + 1)))
    offsets = [0]
    for clip in paths[:-1]:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(clip),
            ],
            check=True,
            text=True,
            capture_output=True,
        )
        offsets.append(offsets[-1] + float(probe.stdout.strip()))
    (temp / "concat.txt").write_text("".join(f"file '{str(path)}'\n" for path in paths))
    target = temp / "reference.f32le"
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-safe",
        "0",
        "-f",
        "concat",
        "-i",
        str(temp / "concat.txt"),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "f32le",
        str(target),
    ]
    subprocess.run(cmd, check=True, timeout=220)
    return target, [round(ms * 1000) for ms in offsets]


def normalize(data: np.ndarray) -> np.ndarray:
    result = data.copy()
    result -= np.mean(result, axis=1, keepdims=True)
    result /= np.maximum(1e-4, np.std(result, axis=1, keepdims=True))
    return result


def transform(signal: np.ndarray, method: str) -> np.ndarray:
    if method == "mel":
        features = librosa.feature.melspectrogram(
            y=signal, sr=SAMPLE_RATE, n_mels=30, n_fft=1024, hop_length=HOP
        )
        return normalize(np.log(1e-7 + features))
    if method == "chroma":
        return normalize(
            librosa.feature.chroma_stft(y=signal, sr=SAMPLE_RATE, n_fft=1024, hop_length=HOP)
        )
    mfcc = librosa.feature.mfcc(y=signal, sr=SAMPLE_RATE, n_mfcc=26, n_fft=1024, hop_length=HOP)[1:]
    if method == "mfcc-delta":
        return normalize(np.vstack([mfcc, librosa.feature.delta(mfcc) * 1.3]))
    if method == "mfcc":
        return normalize(mfcc)
    raise ValueError("Unsupported audio features")


def map_timings(
    reference: np.ndarray, target: np.ndarray, boundaries_ms: list[int], method: str
) -> tuple[list[float], float]:
    ref = transform(reference, method)
    dst = transform(target, method)
    # DTW preserves global sequence, important for Ar-Rahman's frequent refrain.
    distances = cdist(ref.T, dst.T, metric="cosine").astype("float32")
    total, path = librosa.sequence.dtw(
        C=distances, backtrack=True, global_constraints=True, band_rad=0.24
    )
    path = path[::-1]
    reference_frames = path[:, 0]
    destination_frames = path[:, 1]
    mapped = []
    for ms in boundaries_ms:
        index = int(round(ms / (1000 * HOP / SAMPLE_RATE)))
        locations = destination_frames[reference_frames == index]
        frame = (
            float(np.median(locations))
            if len(locations)
            else float(np.interp(index, reference_frames, destination_frames))
        )
        mapped.append(frame * HOP / SAMPLE_RATE)
    return mapped, float(total[-1, -1] / len(path))


def analyze(
    surah: int,
    reference_path: Path | None,
    target_path: Path | None,
    *,
    local_audio: bool = False,
    overwrite: bool = False,
    serve_assabile: bool = False,
) -> Path:
    global HOP
    # Existing generated and manually reviewed files are immutable; the
    # administrator must explicitly migrate reviews when changing sources.
    existing = DATA / f"{surah:03d}.json"
    if existing.exists() and not overwrite:
        print("Preserved existing alignment", existing, flush=True)
        return existing
    if local_audio and (surah != 21 or target_path is None):
        raise ValueError("Local recording mode requires Surah 21 and --target")
    expected_counts = json.loads(
        (ROOT / "backend/src/islamtrove/data/surah_ayah_counts.json").read_text()
    )
    count = expected_counts[str(surah)]
    incomplete_qul_reference = False
    # QUL metadata belongs to its own incomplete 021.mp3: never use it for
    # the full Assabile 21.mp3. EveryAyah clips are an independent reference.
    qurl = ("/api/quran/verified-audio/021.mp3"
            if local_audio else f"{CDN}{surah:03d}.mp3")
    if not local_audio:
        response = json.loads(fetch(f"{QUL}?surah={surah}&per_page=300"))
        segments = response["segments"]
        incomplete_qul_reference = len(segments) != count
        if response["audio"]["url"] != qurl:
            raise ValueError("Recording URL mismatch")
        if incomplete_qul_reference:
            print(f"QUL segments: {len(segments)} vs expected {count}", flush=True)
    with tempfile.TemporaryDirectory(prefix=f"islamtrove-cross-timing-{surah}-") as d:
        temp = Path(d)
        if reference_path is not None:
            # This option accepts the previously assembled reference asset.
            # Its clip-derived timestamps are stored in the corresponding
            # 'source-assembled' 055.json, not the malformed QUL timestamps.
            previous = json.loads((DATA / f"{surah:03d}.json").read_text())
            if previous.get("validationStatus") != "source-assembled":
                raise ValueError("Existing reference JSON must describe assembled source")
            starts = [int(row["fromMs"]) for row in previous["timings"]]
            ref = reference_path
        else:
            ref, starts = assembled_reference(surah, count, temp)
        if (
            len(starts) != count
            or starts[0] != 0
            or any(x >= y for x, y in zip(starts, starts[1:], strict=False))
        ):
            raise ValueError("Reference clip-derived timestamps are invalid")
        dst = target_path or temp / "qul-source.mp3"
        if not target_path:
            dst.write_bytes(fetch(qurl))
        sha = hashlib.sha256(dst.read_bytes()).hexdigest()
        if serve_assabile and sha != ASSABILE_21_SHA:
            raise ValueError("Local recording is not the byte-identical Assabile source")
        if not ref.is_file() or not dst.is_file():
            raise ValueError("Audio sources missing")
        reference = pcm(ref)
        target = pcm(dst)
        length = max(len(reference), len(target)) / SAMPLE_RATE
        # Limit the full DTW matrix to ~15 million cells when necessary;
        # long/low-resolution results are explicitly marked for review.
        HOP = max(1600, int(np.ceil(length * SAMPLE_RATE / 3700)))
        HOP = min(HOP, 16000)
        print(
            f"Reference {len(reference) / SAMPLE_RATE:.2f}s, "
            f"{'local MP3' if local_audio else 'QUL MP3'} {len(target) / SAMPLE_RATE:.2f}s",
            flush=True,
        )
        mapped = {}
        costs = {}
        for method in ["mfcc", "mfcc-delta", "mel", "chroma"]:
            mapped[method], costs[method] = map_timings(reference, target, starts, method)
            print("  ", method, "DTW cost", round(costs[method], 4), flush=True)
        main = np.array(mapped["mfcc-delta"])
        secondary = np.array(mapped["mfcc"])
        mel = np.array(mapped["mel"])
        chroma = np.array(mapped["chroma"])
        # Extremely short recitations can collapse to the same DTW frame.
        # Restore only the minimum viable interval, but FLAG each repaired
        # boundary for mandatory review rather than claiming audio certainty.
        repaired: list[int] = []
        for i in range(1, count):
            if main[i] - main[i - 1] < 0.45:
                main[i] = main[i - 1] + 0.45
                repaired.append(i + 1)
        if main[-1] >= seconds(dst) - 0.45:
            raise ValueError("Warp cannot fit ordered Ayahs before source audio end")
        # All four features are measured independently. Do not hide ambiguous
        # boundaries: this is an experimental correction for listening review.
        flags = [
            {"ayah": ayah, "kind": "low-confidence-interpolated-boundary"} for ayah in repaired
        ]
        if incomplete_qul_reference:
            flags.extend(
                {"ayah": ayah, "kind": "incomplete-provider-reference"}
                for ayah in range(1, count + 1)
            )
        agreements = []
        for i in range(count):
            values = np.array([main[i], secondary[i], mel[i], chroma[i]])
            spread = float(max(values) - min(values))
            two = float(abs(main[i] - secondary[i]))
            agreements.append(round(spread, 2))
            if spread > 3.0 or two > 1.5:
                flags.append(
                    {
                        "ayah": i + 1,
                        "kind": "different-feature-alignment",
                        "timeSpreadSeconds": round(spread, 2),
                        "mfccDisagreementSeconds": round(two, 2),
                    }
                )
            if i > 0:
                prev_duration = (starts[i] - starts[i - 1]) / 1000
                mapped_duration = main[i] - main[i - 1]
                # Sustained tempo changes are normal; extreme jumps are
                # reviewed rather than quietly accepted.
                if mapped_duration > max(prev_duration * 2.3, prev_duration + 20):
                    flags.append(
                        {
                            "ayah": i + 1,
                            "kind": "large-duration-ratio",
                            "ratio": round(mapped_duration / prev_duration, 2),
                        }
                    )
        # End from the physical recording, never truncate the final Ayah.
        # Long recordings get deliberately explicit review markers when their
        # alignment grid is too coarse for reliable word-level highlighting.
        reference_seconds = len(reference) / SAMPLE_RATE
        target_seconds = len(target) / SAMPLE_RATE
        if HOP >= 4000 or not 0.85 <= target_seconds / reference_seconds <= 1.15:
            reason = (
                "coarse-long-surah-timing" if HOP >= 4000 else "large-recording-duration-difference"
            )
            for ayah in range(1, count + 1):
                flags.append({"ayah": ayah, "kind": reason})
        end_ms = round(seconds(dst) * 1000)
        boundaries = [0] + [round(float(value) * 1000) for value in main[1:]] + [end_ms]
        if boundaries[-1] - boundaries[-2] < 1000:
            raise ValueError("Implausibly short last Ayah")
        timings = [
            {"ayah": i + 1, "fromMs": boundaries[i], "toMs": boundaries[i + 1]}
            for i in range(count)
        ]
        if serve_assabile:
            qurl = f"{ASSABILE_21}?v={sha[:12]}"
        elif local_audio:
            qurl = f"{qurl}?v={sha[:12]}"  # Version a local recording as well.
        out = {
            "schemaVersion": 1,
            "surahId": surah,
            "reciter": "minshawi-mujawwad",
            "audioUrl": qurl,
            "audioSha256": sha,
            "audioBytes": dst.stat().st_size,
            "audioDurationMs": end_ms,
            "endMs": end_ms,
            "sourceAyahCount": count,
            "alignmentResolutionMs": round(HOP / SAMPLE_RATE * 1000),
            "source": (
                "Full Assabile Minshawi Mujawwad recording, verified byte-for-byte "
                "against local reference; EveryAyah individual Ayahs for alignment"
                if serve_assabile
                else "Complete local Minshawi Mujawwad 21.mp3; reference EveryAyah individual Ayahs"
                if local_audio
                else "QUL original CDN MP3; reference EveryAyah faster individual clips"
            ),
            "method": "offline-global-DTW-four-speech-features",
            "validationStatus": "experimental-cross-recording",
            "reviewRequired": True,
            "reviewAyahs": flags,
            "featureAgreementSecondsByAyah": agreements,
            "dtwCosts": costs,
            "timings": timings,
        }
        DATA.mkdir(parents=True, exist_ok=True)
        path = DATA / f"{surah:03d}.json"
        path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
        print("Saved", path, "flagged Ayahs", sorted({x["ayah"] for x in flags}), flush=True)
        return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--surah", type=int, default=55, choices=range(1, 115))
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--target", type=Path)
    parser.add_argument("--serve-local", action="store_true",
                        help="align Surah 21's provisioned full MP3, not QUL's incomplete CDN file")
    parser.add_argument("--serve-assabile", action="store_true",
                        help="publish the verified, full Assabile URL for Surah 21")
    parser.add_argument("--overwrite", action="store_true",
                        help="explicitly replace the previous experimental manifest")
    args = parser.parse_args()
    analyze(args.surah, args.reference, args.target,
            local_audio=args.serve_local or args.serve_assabile,
            overwrite=args.overwrite, serve_assabile=args.serve_assabile)
