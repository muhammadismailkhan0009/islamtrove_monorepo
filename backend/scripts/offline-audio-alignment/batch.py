#!/usr/bin/env python3
"""Run the OFFLINE source-specific Quran alignment corpus, with resume + error report.

From backend/:
    uv run --with librosa --with numpy python scripts/offline-audio-alignment/batch.py --all

Existing verified/experimental JSON and administrator reviews are NEVER
replaced. Failed Surahs are retained in the report for a later retry.
"""

import argparse
import concurrent.futures
import json
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ALIGNMENTS = HERE.parents[1] / "src/islamtrove/data/alignments"
REPORTS = HERE / "reports"


def run(surah: int, timeout: int) -> tuple[int, str, str, float]:
    begin = time.monotonic()
    proc = subprocess.run(
        [sys.executable, str(HERE / "align_cross_recording.py"), "--surah", str(surah)],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    status = (
        "completed"
        if proc.returncode == 0 and (ALIGNMENTS / f"{surah:03d}.json").exists()
        else "failed"
    )
    message = (
        proc.stdout[-1000:] if status == "completed" else (proc.stderr + "\n" + proc.stdout)[-2000:]
    )
    return surah, status, message, round(time.monotonic() - begin, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--surahs", type=str, default="")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=420)
    args = ap.parse_args()
    if not args.all and not args.surahs:
        ap.error("Specify --all or --surahs")
    if args.workers not in (1, 2, 3):
        ap.error("workers must be 1, 2 or 3 to avoid overloading audio providers")
    selection = list(range(1, 115)) if args.all else [int(x) for x in args.surahs.split(",")]
    if any(not 1 <= x <= 114 for x in selection):
        ap.error("Surah IDs must be 1..114")
    existing = [n for n in selection if (ALIGNMENTS / f"{n:03d}.json").is_file()]
    todo = [n for n in selection if n not in existing]
    # Shorter Surahs first: generate the widest coverage before large downloads.
    todo.sort(reverse=True)
    report = {
        "attempted": selection,
        "preserved": existing,
        "completed": [],
        "failed": {},
        "startedAt": datetime.now(UTC).isoformat(),
        "method": "offline-global-DTW-four-speech-features",
    }
    REPORTS.mkdir(exist_ok=True, parents=True)

    def save():
        (REPORTS / "full-quran-batch.json").write_text(json.dumps(report, indent=2) + "\n")

    save()
    print(
        f"Batch: {len(todo)} pending, {len(existing)} protected, workers={args.workers}", flush=True
    )
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks = {pool.submit(run, n, args.timeout): n for n in todo}
        for i, future in enumerate(concurrent.futures.as_completed(tasks), 1):
            n = tasks[future]
            try:
                surah, status, message, elapsed = future.result()
            except Exception as exc:
                surah, status, message, elapsed = n, "failed", f"{type(exc).__name__}: {exc}", 0
            if status == "completed":
                report["completed"].append(surah)
            else:
                report["failed"][str(surah)] = message
            save()
            print(
                f"[{i}/{len(todo)}] {surah:03d}: {status} in {elapsed}s - {message.strip()[-260:]}",
                flush=True,
            )
    report["finishedAt"] = datetime.now(UTC).isoformat()
    save()
    print(
        f"Batch finished: {len(report['completed'])} generated, "
        f"{len(existing)} protected, {len(report['failed'])} failed",
        flush=True,
    )
    if report["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
