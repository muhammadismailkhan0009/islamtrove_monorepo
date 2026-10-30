#!/usr/bin/env python3
"""Low-confidence last resort for recordings that cannot be feature-aligned.

The output uses original QUL reference start fractions scaled to the actual
continuous MP3 duration. EVERY Ayah is flagged for mandatory listening review.
It is not an acoustic match and is never labeled manually verified.

From backend/: uv run python scripts/offline-audio-alignment/scaled_fallback.py --surah 21
"""

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "backend/src/islamtrove/data/alignments"
COUNTS = ROOT / "backend/src/islamtrove/data/surah_ayah_counts.json"
QUL = "https://qul.tarteel.ai/api/v1/audio/surah_segments/8"
CDN = "https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/"


def build(surah: int) -> None:
    destination = OUT / f"{surah:03d}.json"
    if destination.exists():
        raise ValueError("Refusing to overwrite existing aligned or reviewed source")
    counts = json.loads(COUNTS.read_text())
    count = counts[str(surah)]
    with urlopen(
        Request(
            f"{QUL}?surah={surah}&per_page=300",
            headers={"User-Agent": "IslamTrove offline alignment research"},
        ),
        timeout=35,
    ) as r:
        metadata = json.load(r)
    segments = metadata["segments"]
    audio_url = f"{CDN}{surah:03d}.mp3"
    if metadata["audio"]["url"] != audio_url or len(segments) != count:
        raise ValueError("Cannot use incomplete QUL metadata for duration fallback")
    original = []
    for ayah in range(1, count + 1):
        entry = segments.get(f"{surah}:{ayah}")
        if entry is None or type(entry["time_from"]) is not int:
            raise ValueError(f"Invalid original start at {surah}:{ayah}")
        original.append(entry["time_from"])
    reference_end = segments[f"{surah}:{count}"]["time_to"]
    if (
        original[0] != 0
        or reference_end <= original[-1]
        or any(next_ <= last for last, next_ in zip(original, original[1:], strict=False))
    ):
        raise ValueError("QUL reference is not monotone; do not guess source boundaries")
    with tempfile.TemporaryDirectory(prefix="islamtrove-fallback-") as temporary:
        mp3 = Path(temporary) / "recording.mp3"
        with urlopen(
            Request(audio_url, headers={"User-Agent": "IslamTrove offline alignment research"}),
            timeout=90,
        ) as r:
            mp3.write_bytes(r.read())
        sha = hashlib.sha256(mp3.read_bytes()).hexdigest()
        duration = float(
            subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(mp3),
                ],
                capture_output=True,
                text=True,
                check=True,
                timeout=30,
            ).stdout
        )
        target_end = round(duration * 1000)
        starts = [round(start / reference_end * target_end) for start in original]
        starts[0] = 0
        starts.append(target_end)
        if any(b - a < 250 for a, b in zip(starts, starts[1:], strict=False)):
            raise ValueError("Even the rough time scaling collapsed a short Ayah")
        timings = [
            {"ayah": i + 1, "fromMs": starts[i], "toMs": starts[i + 1]} for i in range(count)
        ]
        manifest = {
            "schemaVersion": 1,
            "surahId": surah,
            "reciter": "minshawi-mujawwad",
            "audioUrl": audio_url,
            "audioSha256": sha,
            "audioBytes": mp3.stat().st_size,
            "audioDurationMs": target_end,
            "endMs": target_end,
            "sourceAyahCount": count,
            "source": "QUL continuous MP3 and unverified source reference durations",
            "method": "offline-linear-duration-fallback-NOT-acoustic-alignment",
            "validationStatus": "experimental-cross-recording",
            "reviewRequired": True,
            "reliability": "unmatched-source-mandatory-all-Ayah-review",
            "reviewAyahs": [
                {"ayah": i, "kind": "no-reliable-acoustic-match-approximate-only"}
                for i in range(1, count + 1)
            ],
            "timings": timings,
        }
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        print(
            "Saved STRICTLY provisional fallback",
            destination,
            f"({count} Ayahs, ALL require review; source {duration:.2f}s vs QUL "
            f"{reference_end / 1000:.2f}s)",
            flush=True,
        )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--surah", type=int, required=True, choices=range(1, 115))
    build(p.parse_args().surah)
