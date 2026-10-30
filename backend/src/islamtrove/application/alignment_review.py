"""Durable, source-locked administrative Ayah reviews and effective timing overlay.

Generated alignments are immutable. Only validated, administrator-approved
records under backend/review-data are changed by the review API.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from islamtrove.api.continuous import load_verified_alignment


class ReviewConflict(ValueError):
    """A stale source, changed boundary, or invalid adjacent interval."""


class AlignmentReviewStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def _base(self, surah_id: int) -> tuple[dict, dict]:
        if surah_id not in range(1, 115):
            raise ReviewConflict("Invalid Surah")
        base = load_verified_alignment(surah_id)
        if base is None:
            raise ReviewConflict("This Surah has no locally generated alignment to review")
        from islamtrove.api.continuous import _ALIGNMENT_DIRECTORY

        metadata = json.loads((_ALIGNMENT_DIRECTORY / f"{surah_id:03d}.json").read_text())
        return base, metadata

    def _path(self, surah_id: int) -> Path:
        return self.directory / f"{surah_id:03d}.json"

    def _document(self, surah_id: int, source_hash: str) -> dict[str, Any]:
        path = self._path(surah_id)
        if not path.exists():
            return {
                "schemaVersion": 1,
                "surahId": surah_id,
                "audioSha256": source_hash,
                "reviews": {},
                "audit": [],
            }
        data = json.loads(path.read_text(encoding="utf-8"))
        if (
            data.get("schemaVersion") != 1
            or data.get("surahId") != surah_id
            or data.get("audioSha256") != source_hash
            or not isinstance(data.get("reviews"), dict)
            or not isinstance(data.get("audit"), list)
        ):
            raise ReviewConflict("Review metadata is stale or does not match this recording")
        return data

    @staticmethod
    def _apply(base: dict, reviews: dict) -> dict:
        timings = [dict(entry) for entry in base["timings"]]
        for key, review in reviews.items():
            ayah = int(key)
            if not 1 <= ayah <= len(timings) or not isinstance(review, dict):
                raise ReviewConflict("Stored review contains an invalid Ayah")
            if review.get("status") == "corrected":
                if ayah == 1 or type(review.get("startMs")) is not int:
                    raise ReviewConflict("Invalid corrected timestamp in stored review")
                start = review["startMs"]
                timings[ayah - 1]["fromMs"] = start
                timings[ayah - 2]["toMs"] = start
        last = 0
        for item in timings:
            if (
                type(item["fromMs"]) is not int
                or type(item["toMs"]) is not int
                or item["fromMs"] != last
                or item["toMs"] - last < 250
            ):
                raise ReviewConflict("Correction would create an invalid adjacent Ayah interval")
            last = item["toMs"]
        if last != base["endMs"]:
            raise ReviewConflict("Correction would alter the end of the Surah")
        return {**base, "timings": timings}

    def effective(self, surah_id: int) -> dict | None:
        base = load_verified_alignment(surah_id)
        if base is None:
            return None
        _, metadata = self._base(surah_id)
        document = self._document(surah_id, metadata["audioSha256"])
        return self._apply(base, document["reviews"])

    def list(self, surah_id: int) -> list[dict]:
        # Unaligned Surahs simply have no review tasks yet.
        if load_verified_alignment(surah_id) is None:
            return []
        base, metadata = self._base(surah_id)
        doc = self._document(surah_id, metadata["audioSha256"])
        effective = self._apply(base, doc["reviews"])
        flags: dict[int, list[str]] = {}
        for raw in metadata.get("reviewAyahs", []) + metadata.get("alignmentAnomalies", []):
            if not isinstance(raw, dict):
                continue
            ayah = raw.get("ayah")
            if type(ayah) is not int or not 1 <= ayah <= len(base["timings"]):
                continue
            kind = str(raw.get("kind", "Alignment discrepancy")).replace("-", " ")
            flags.setdefault(ayah, []).append(kind)
        entries = []
        for item in effective["timings"]:
            ayah = item["ayah"]
            reviewed = doc["reviews"].get(str(ayah))
            entries.append(
                {
                    "ayah": ayah,
                    "status": (
                        reviewed["status"]
                        if reviewed
                        else "needs-review"
                        if ayah in flags
                        else "unflagged"
                    ),
                    "estimatedStartMs": item["fromMs"],
                    "reason": ", ".join(sorted(set(flags.get(ayah, []))))
                    if ayah in flags
                    else None,
                    "verifiedBy": reviewed.get("reviewedBy") if reviewed else None,
                }
            )
        return entries

    def commit(
        self,
        surah_id: int,
        ayah: int,
        kind: str,
        *,
        start_ms: int | None = None,
        expected_start_ms: int | None = None,
    ) -> list[dict]:
        base, metadata = self._base(surah_id)
        doc = self._document(surah_id, metadata["audioSha256"])
        current = self._apply(base, doc["reviews"])
        if not 1 <= ayah <= len(current["timings"]):
            raise ReviewConflict("Unknown Ayah")
        previous_start = current["timings"][ayah - 1]["fromMs"]
        if expected_start_ms is not None and expected_start_ms != previous_start:
            raise ReviewConflict("Ayah timing changed; reload before submitting a review")
        if kind not in ("verify", "correct"):
            raise ReviewConflict("Invalid review operation")
        if kind == "correct":
            if (
                ayah == 1
                or type(start_ms) is not int
                or start_ms < 0
                or start_ms > current["endMs"]
            ):
                raise ReviewConflict("Invalid Ayah start: the first Ayah must begin at zero")
        old = doc["reviews"].get(str(ayah), {})
        new_entry: dict[str, Any] = {
            "status": (
                "corrected" if kind == "correct" or old.get("status") == "corrected" else "verified"
            ),
            "reviewedBy": "Admin",
            "reviewedAt": datetime.now(UTC).isoformat(),
        }
        if new_entry["status"] == "corrected":
            new_entry["startMs"] = start_ms if kind == "correct" else old["startMs"]
        doc["reviews"][str(ayah)] = new_entry
        self._apply(base, doc["reviews"])  # validate complete, contiguous output before writing
        doc["audit"].append(
            {
                "operation": kind,
                "ayah": ayah,
                "previousStartMs": previous_start,
                "newStartMs": (start_ms if kind == "correct" else previous_start),
                "at": new_entry["reviewedAt"],
                "reviewedBy": "Admin",
            }
        )
        self._save(surah_id, doc)
        return self.list(surah_id)

    def commit_block(
        self, surah_id: int, boundaries: list[tuple[int, int]]
    ) -> list[dict]:
        """Confirm a listening passage by updating individual Ayah review records.

        Existing verified/corrected records (including their original reviewer,
        review time and corrections) are immutable during bulk confirmation.
        Passage boundaries only select Ayahs; they are never stored as status.
        The admin API provides authentication and a per-process write lock.
        """
        if not 1 <= len(boundaries) <= 286:
            raise ReviewConflict("Block must contain 1 to 286 Ayahs")
        ordered = [ayah for ayah, _ in boundaries]
        if any(b != a + 1 for a, b in zip(ordered, ordered[1:], strict=False)):
            raise ReviewConflict("Review block must be contiguous")
        base, metadata = self._base(surah_id)
        document = self._document(surah_id, metadata["audioSha256"])
        current = self._apply(base, document["reviews"])
        for ayah, expected_ms in boundaries:
            if (
                not 1 <= ayah <= len(current["timings"])
                or type(expected_ms) is not int
                or current["timings"][ayah - 1]["fromMs"] != expected_ms
            ):
                raise ReviewConflict("Block timestamps changed; reload before verification")

        # The list of Ayahs is a selection, not a persistent group identity.
        # Only yet-unreviewed Ayahs receive individual verification records.
        # Never replace an existing verified or corrected review when the user
        # changes passage breakpoints or confirms an overlapping passage.
        reviewed = document["reviews"]
        to_verify: list[int] = []
        for ayah in ordered:
            previous = reviewed.get(str(ayah))
            if previous is None:
                to_verify.append(ayah)
            elif previous.get("status") not in ("verified", "corrected"):
                raise ReviewConflict("Existing Ayah review has an invalid status")

        if not to_verify:
            return self.list(surah_id)

        now = datetime.now(UTC).isoformat()
        for ayah in to_verify:
            reviewed[str(ayah)] = {
                "status": "verified",
                "reviewedBy": "Admin",
                "reviewedAt": now,
            }
        self._apply(base, reviewed)  # Do not write an invalid review overlay.
        document["audit"].append({
            "operation": "verify-block",
            "ayahs": to_verify,
            "startAyah": ordered[0],
            "endAyah": ordered[-1],
            "at": now,
            "reviewedBy": "Admin",
        })
        self._save(surah_id, document)
        return self.list(surah_id)

    def _save(self, surah_id: int, document: dict) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        serialized = (json.dumps(document, indent=2, ensure_ascii=False) + "\n").encode()
        handle, temporary = tempfile.mkstemp(
            prefix=f".{surah_id:03d}-", suffix=".tmp", dir=self.directory
        )
        try:
            with os.fdopen(handle, "wb") as file:
                file.write(serialized)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, self._path(surah_id))
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
