#!/usr/bin/env python3
"""Unit tests for the offline QPC first-passage-wins generator."""
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("generate_qpc_boundaries.py")
spec = importlib.util.spec_from_file_location("generate_qpc_boundaries", SCRIPT)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class QpcNormalizationTests(unittest.TestCase):
    def test_overlap_chain_prioritizes_first_passage(self):
        # 41-44, 42-48, 45-49 -> 41-44, 45-48, 49.
        rows = [(33, 41, 44), (33, 42, 48), (33, 45, 49)]
        # The normalizer intentionally rejects missing preceding Ayahs.
        normalized, overlaps = module.normalize_passages(
            [(33, 1, 40), *rows], {33: 49}
        )
        self.assertEqual(normalized[33], [40, 44, 48, 49])
        self.assertEqual(overlaps, [(33, 42, 48, 45), (33, 45, 49, 49)])

    def test_fully_consumed_passage_is_discarded(self):
        normalized, overlaps = module.normalize_passages(
            [(1, 1, 4), (1, 2, 4), (1, 3, 7)], {1: 7}
        )
        self.assertEqual(normalized[1], [4, 7])
        self.assertEqual(overlaps, [(1, 2, 4, 5), (1, 3, 7, 5)])

    def test_gaps_are_errors_not_automatically_filled(self):
        with self.assertRaisesRegex(ValueError, "gap"):
            module.normalize_passages([(1, 1, 3), (1, 5, 7)], {1: 7})

    def test_missing_final_ayah_is_error(self):
        with self.assertRaisesRegex(ValueError, "final covered Ayah"):
            module.normalize_passages([(1, 1, 6)], {1: 7})

    def test_out_of_range_is_error(self):
        with self.assertRaisesRegex(ValueError, "exceeds Ayah count"):
            module.normalize_passages([(1, 1, 8)], {1: 7})

    def test_cannot_reorder_surahs(self):
        with self.assertRaisesRegex(ValueError, "ordered by Surah"):
            module.normalize_passages([(2, 1, 1), (1, 1, 7)], {1: 7, 2: 1})


if __name__ == "__main__":
    unittest.main()
