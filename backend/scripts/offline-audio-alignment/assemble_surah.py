#!/usr/bin/env python3
"""Offline-only fallback: assemble a continuous MP3 from matching Ayah recordings.

This does not change app runtime or contain any live download logic. It is
reserved for mismatched QUL CDN audio that cannot be waveform-aligned to its
published timestamps (such as Minshawi Mujawwad Ar-Rahman, Surah 55).

From backend/:
    uv run python scripts/offline-audio-alignment/assemble_surah.py --surah 55
"""

import argparse
import concurrent.futures
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
AUDIO_DIR = ROOT / "backend/src/islamtrove/data/audio"
ALIGNMENTS = ROOT / "backend/src/islamtrove/data/alignments"
EVERYAYAH = "https://everyayah.com/data/Minshawy_Mujawwad_192kbps/"
QUL = "https://qul.tarteel.ai/api/v1/audio/surah_segments/8"
USER_AGENT = "IslamTrove local development alignment research"


def download_clip(surah: int, ayah: int, directory: Path) -> Path:
    target = directory / f"{surah:03d}{ayah:03d}.mp3"
    source = f"{EVERYAYAH}{surah:03d}{ayah:03d}.mp3"
    for attempt in range(4):
        try:
            with urlopen(Request(source, headers={"User-Agent": USER_AGENT}), timeout=30) as r:
                blob = r.read()
            if len(blob) < 1024:
                raise ValueError("Suspiciously small audio recording")
            target.write_bytes(blob)
            return target
        except Exception as exc:
            if attempt == 3:
                raise RuntimeError(f"Cannot download Ayah {surah}:{ayah}") from exc
    raise AssertionError("Unreachable")


def duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        text=True,
        capture_output=True,
        timeout=20,
    )
    return float(result.stdout.strip())


def assemble(surah: int) -> Path:
    if (ROOT / f"backend/review-data/{surah:03d}.json").exists():
        raise ValueError("Refusing to replace audio with existing administrator review history")
    with urlopen(
        Request(f"{QUL}?surah={surah}&per_page=300", headers={"User-Agent": USER_AGENT}), timeout=25
    ) as r:
        source = json.load(r)
    segments = source["segments"]
    count = len(segments)
    if not 1 <= count <= 286 or any(f"{surah}:{i}" not in segments for i in range(1, count + 1)):
        raise ValueError("QUL reference does not cover the Surah")
    with tempfile.TemporaryDirectory(prefix=f"islamtrove-assembly-{surah}-") as temporary:
        tmp = Path(temporary)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            clips = list(pool.map(lambda i: download_clip(surah, i, tmp), range(1, count + 1)))
        lengths = [duration(clip) for clip in clips]
        starts = [0]
        for length in lengths[:-1]:
            starts.append(starts[-1] + length)
        estimated_duration = sum(lengths)
        qulend = segments[f"{surah}:{count}"]["time_to"] / 1000
        if abs(estimated_duration - qulend) > max(4.0, 0.01 * qulend):
            raise ValueError(
                f"Individual clips {estimated_duration:.2f}s differ from QUL {qulend:.2f}s"
            )
        # Concat demuxer concatenates clips in recording order. Re-encoding
        # produces a *single* MP3 encoder timeline (no per-file Xing headers).
        playlist = tmp / "concat.txt"
        playlist.write_text("".join(f"file '{str(clip)}'\n" for clip in clips))
        mp3 = tmp / "assembled.mp3"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-y",
                "-safe",
                "0",
                "-f",
                "concat",
                "-i",
                str(playlist),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "44100",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "192k",
                str(mp3),
            ],
            check=True,
            timeout=180,
        )
        encoded_duration = duration(mp3)
        if abs(encoded_duration - estimated_duration) > 1.5:
            raise ValueError(
                f"Encoded duration {encoded_duration:.2f}s differs from {estimated_duration:.2f}s"
            )
        # Re-encoded file is homogeneous and its timeline closely follows
        # the sequence of per-Ayah decoded durations. Clamp the final end.
        timings = [
            {
                "ayah": i,
                "fromMs": round(starts[i - 1] * 1000),
                "toMs": round(starts[i] * 1000) if i < count else round(encoded_duration * 1000),
            }
            for i in range(1, count + 1)
        ]
        if any(timings[i]["fromMs"] != timings[i - 1]["toMs"] for i in range(1, count)):
            raise ValueError("Output timing gaps")
        filehash = hashlib.sha256(mp3.read_bytes()).hexdigest()
        AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        ALIGNMENTS.mkdir(parents=True, exist_ok=True)
        output = AUDIO_DIR / f"{surah:03d}.mp3"
        # Save an immutable local source with a verified, reproducible SHA.
        output.write_bytes(mp3.read_bytes())
        metadata = {
            "schemaVersion": 1,
            "surahId": surah,
            "reciter": "minshawi-mujawwad",
            "audioUrl": f"/api/quran/verified-audio/{surah:03d}.mp3?v={filehash[:16]}",
            "audioSha256": filehash,
            "audioBytes": output.stat().st_size,
            "audioDurationMs": round(encoded_duration * 1000),
            "source": "Minshawi Mujawwad 192kbps individual recordings from EveryAyah",
            "method": "offline-audio-assembly-exact-clip-durations",
            "validationStatus": "source-assembled",
            "reviewRequired": True,
            "reviewAyahs": [],
            "originalQulAudioIncomplete": True,
            "originalQulPublishedBytes": 10485760,
            "notes": (
                "Rebuilt from EveryAyah verse recordings because QUL 021.mp3 "
                "is truncated at 10 MiB. Ayah starts come from actual clip joins."
            ),
            "referenceQulDurationMs": round(qulend * 1000),
            "timings": timings,
            "endMs": timings[-1]["toMs"],
            "sourceAyahCount": count,
        }
        destination = ALIGNMENTS / f"{surah:03d}.json"
        destination.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n")
        print(
            "Surah",
            surah,
            "Ayahs",
            count,
            "QUL",
            qulend,
            "sum individual",
            estimated_duration,
            "assembled",
            encoded_duration,
            "bytes",
            output.stat().st_size,
            "SHA256",
            filehash,
            "manifest",
            destination,
            "audio",
            output,
            flush=True,
        )
        return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--surah", type=int, required=True, choices=range(1, 115))
    args = parser.parse_args()
    assemble(args.surah)
