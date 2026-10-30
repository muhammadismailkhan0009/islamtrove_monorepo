"""Validated, atomically-published Surah passage groupings."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from islamtrove.api.continuous import _AYAH_COUNTS


class GroupingConflict(ValueError):
    """Invalid or stale grouping publication."""


class GroupingStore:
    def __init__(self, directory: Path) -> None:
        self.path = directory / "groupings.json"

    def read(self) -> dict[str, Any]:
        if not self.path.is_file():
            return {"schemaVersion": 1, "revision": 0, "groupings": []}
        doc = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict) or doc.get("schemaVersion") != 1:
            raise ValueError("Unsupported published grouping format")
        if type(doc.get("revision")) is not int or doc["revision"] < 0:
            raise ValueError("Invalid grouping revision")
        self._validate(doc.get("groupings"))
        return doc

    @staticmethod
    def _validate(groupings: Any) -> None:
        if not isinstance(groupings, list) or len(groupings) > 114:
            raise GroupingConflict("A complete collection may contain at most 114 Surahs")
        seen: set[int] = set()
        for entry in groupings:
            if not isinstance(entry, dict):
                raise GroupingConflict("Each grouping must be an object")
            surah = entry.get("surahId")
            boundaries = entry.get("boundaries")
            if type(surah) is not int or str(surah) not in _AYAH_COUNTS or surah in seen:
                raise GroupingConflict("Invalid or duplicate Surah grouping")
            seen.add(surah)
            count = _AYAH_COUNTS[str(surah)]
            if not isinstance(boundaries, list) or not 1 <= len(boundaries) <= count:
                raise GroupingConflict(f"Invalid boundaries for Surah {surah}")
            last = 0
            for ayah in boundaries:
                if type(ayah) is not int or ayah <= last or ayah > count:
                    raise GroupingConflict(
                        f"Boundaries must be ordered, unique Ayahs in Surah {surah}"
                    )
                last = ayah
            if last != count:
                raise GroupingConflict(f"Grouping for Surah {surah} must end on Ayah {count}")

    def publish(self, groupings: list[dict], expected_revision: int) -> dict[str, Any]:
        current = self.read()
        if expected_revision != current["revision"]:
            raise GroupingConflict("Published groupings changed. Reload before publishing.")
        self._validate(groupings)
        updated = {
            "schemaVersion": 1, "revision": expected_revision + 1,
            "groupings": sorted(groupings, key=lambda x: x["surahId"]),
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.path.parent,
                prefix=".groupings-", suffix=".json", delete=False,
            ) as output:
                tmp = output.name
                json.dump(updated, output, ensure_ascii=False, indent=2)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(tmp, self.path)
        finally:
            if tmp and os.path.exists(tmp):
                os.unlink(tmp)
        return updated
