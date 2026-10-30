"""Validate and summarize the local Quran alignment corpus without network requests.

From backend/: python3 scripts/offline-audio-alignment/audit.py
"""

import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[3]
APPROVED = BASE / "backend/src/islamtrove/data/alignments"
CANDIDATES = BASE / "backend/scripts/offline-audio-alignment/candidates"
REVIEWS = BASE / "backend/review-data"
CANONICAL = BASE / "backend/src/islamtrove/data/surah_ayah_counts.json"
REPORT = BASE / "backend/scripts/offline-audio-alignment/reports/corpus-status.json"


def main() -> None:
    counts = json.loads(CANONICAL.read_text())
    assert len(counts) == 114 and sum(counts.values()) == 6236
    status: dict[str, list[int]] = {
        "verified": [],
        "experimental": [],
        "requiresReview": [],
        "notGenerated": [],
    }
    details: dict[str, dict] = {}
    matched_ayahs = 0
    pending = 0
    checked = 0
    for surah in range(1, 115):
        name = f"{surah:03d}.json"
        path = APPROVED / name
        if path.exists():
            manifest = json.loads(path.read_text())
            category = (
                "experimental"
                if manifest.get("validationStatus")
                in ("experimental-cross-recording", "qul-published")
                else "verified"
            )
        else:
            path = CANDIDATES / name
            category = "requiresReview" if path.exists() else "notGenerated"
        status[category].append(surah)
        if category == "notGenerated":
            continue
        data = json.loads(path.read_text())
        timings = data["timings"]
        if (
            len(timings) != counts[str(surah)]
            or data.get("sourceAyahCount", len(timings)) != counts[str(surah)]
        ):
            raise ValueError(f"Incomplete Ayah metadata: {name}")
        previous = 0
        for i, entry in enumerate(timings, start=1):
            if (
                entry["ayah"] != i
                or entry["fromMs"] != previous
                or entry["toMs"] <= entry["fromMs"]
            ):
                raise ValueError(f"Malformed Ayah {surah}:{i}")
            previous = entry["toMs"]
        if previous != data["endMs"] or previous > data["audioDurationMs"]:
            raise ValueError(f"Invalid end of recording: {name}")
        matched_ayahs += len(timings) if category != "requiresReview" else 0
        flags = {
            r["ayah"]
            for r in data.get("reviewAyahs", []) + data.get("alignmentAnomalies", [])
            if isinstance(r, dict) and isinstance(r.get("ayah"), int)
        }
        review_path = REVIEWS / name
        reviewed: set[int] = set()
        if review_path.is_file():
            review_data = json.loads(review_path.read_text())
            if review_data["audioSha256"] != data["audioSha256"]:
                raise ValueError(f"Review refers to a different source: {name}")
            reviewed = {int(i) for i in review_data["reviews"]}
        pending += len(flags - reviewed) if category != "requiresReview" else 0
        checked += len(reviewed) if category != "requiresReview" else 0
        details[str(surah)] = {
            "ayahCount": len(timings),
            "sourceHash": data["audioSha256"],
            "status": data.get("validationStatus"),
            "reviewFlagCount": len(flags),
            "pendingReviewCount": len(flags - reviewed),
            "adminCheckedCount": len(reviewed),
            "timingResolutionMs": data.get("alignmentResolutionMs"),
            "sourceDurationSeconds": round(data["audioDurationMs"] / 1000, 2),
        }
    summary = {
        "generatedCount": len(status["verified"]) + len(status["experimental"]),
        "verifiedCount": len(status["verified"]),
        "experimentalCount": len(status["experimental"]),
        "oldCandidatesCount": len(status["requiresReview"]),
        "notGeneratedCount": len(status["notGenerated"]),
        "generatedAyahCount": matched_ayahs,
        "expectedQuranAyahCount": 6236,
        "pendingReviewCount": pending,
        "adminCheckedCount": checked,
        "complete": len(status["notGenerated"]) == 0 and len(status["requiresReview"]) == 0,
        "surahs": status,
        "details": details,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print("Saved Surahs:", summary["generatedCount"], "/ 114")
    print("Ayah starts:", matched_ayahs, "/ 6236")
    print("Verified Surahs:", status["verified"])
    print("Experimental Surahs:", len(status["experimental"]))
    print("Missing Surahs:", status["notGenerated"])
    print("Pending Ayah reviews:", pending, "already checked:", checked)
    print("Audit:", REPORT)


if __name__ == "__main__":
    main()
