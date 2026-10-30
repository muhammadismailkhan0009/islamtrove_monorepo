"""Offline-only validation of two independent waveform motifs (requires numpy)."""

import unittest

import numpy as np
from align_recitation import SAMPLE_RATE, best_match, independent_confirmation


class TwoMotifValidationTests(unittest.TestCase):
    def test_short_two_second_ayah_matches_two_non_overlapping_motifs(self):
        rng = np.random.default_rng(42)
        clip = rng.normal(0, 0.07, int(2.4 * SAMPLE_RATE)).astype(np.float32)
        recording = np.zeros(int(40 * SAMPLE_RATE), dtype=np.float32)
        recording[20 * SAMPLE_RATE : 20 * SAMPLE_RATE + len(clip)] = clip
        position, confidence = best_match(recording, clip, 20, 0, 10, 12)
        self.assertAlmostEqual(position, 20, delta=0.005)
        self.assertGreater(confidence, 0.99)
        self.assertGreater(independent_confirmation(recording, clip, position), 0.99)

    def test_second_motif_rejects_repeated_opening_phrase(self):
        rng = np.random.default_rng(53)
        clip = rng.normal(0, 0.07, 17 * SAMPLE_RATE).astype(np.float32)
        recording = rng.normal(0, 0.002, 85 * SAMPLE_RATE).astype(np.float32)
        # Correct Ayah, slightly noisy, begins at 50 seconds.
        recording[50 * SAMPLE_RATE : 67 * SAMPLE_RATE] += clip
        # Decoy contains ONLY the first 3..12-second motif at 10 seconds.
        recording[13 * SAMPLE_RATE : 22 * SAMPLE_RATE] = clip[3 * SAMPLE_RATE : 12 * SAMPLE_RATE]
        self.assertLess(independent_confirmation(recording, clip, 10), 0.3)
        self.assertGreater(independent_confirmation(recording, clip, 50), 0.98)


if __name__ == "__main__":
    unittest.main()
