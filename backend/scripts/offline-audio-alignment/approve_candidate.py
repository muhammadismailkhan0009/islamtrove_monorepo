"""Promote a manually reviewed alignment; not part of running IslamTrove.

Example (only AFTER the recording has been audibly checked):
  python3 backend/scripts/offline-audio-alignment/approve_candidate.py --surah 67 \\
    --sha256 <exact SHA-256 of approved recording> --confirmed
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--surah", type=int, required=True)
    parser.add_argument("--sha256", type=str, required=True)
    parser.add_argument(
        "--confirmed",
        action="store_true",
        required=True,
        help="Explicit confirmation that the flagged audio was reviewed",
    )
    args = parser.parse_args()
    if not 1 <= args.surah <= 114:
        parser.error("Invalid Surah number")
    source = HERE / "candidates" / f"{args.surah:03d}.json"
    destination = ROOT / "backend/src/islamtrove/data/alignments" / source.name
    if not source.exists():
        parser.error("No candidate JSON exists for this Surah")
    if destination.exists():
        parser.error("Already approved; refusing to overwrite trusted alignment")
    data = json.loads(source.read_text())
    if data.get("audioSha256") != args.sha256 or len(args.sha256) != 64:
        parser.error("Recording SHA-256 mismatch; approval must match the exact audio version")
    if data.get("surahId") != args.surah or data.get("validationStatus") != "requires-review":
        parser.error("Invalid or already approved candidate")
    timings = data.get("timings", [])
    if not timings or timings[0]["fromMs"] != 0 or len(timings) > 286:
        parser.error("Malformed Ayah timeline")
    for i, item in enumerate(timings):
        if (
            item["ayah"] != i + 1
            or item["toMs"] <= item["fromMs"]
            or i
            and item["fromMs"] != timings[i - 1]["toMs"]
        ):
            parser.error("Malformed or non-contiguous Ayah timeline")
    if timings[-1]["toMs"] != data["endMs"] or data["endMs"] > data["audioDurationMs"]:
        parser.error("Invalid end of recording")
    approvals_file = HERE / "approved-recordings.json"
    approvals = json.loads(approvals_file.read_text())
    approvals[str(args.surah)] = args.sha256
    data["validationStatus"] = "manually-reviewed"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    approvals_file.write_text(json.dumps(approvals, indent=2) + "\n")
    source.unlink()
    print(f"Approved Surah {args.surah} for exactly {args.sha256}.")


if __name__ == "__main__":
    main()
