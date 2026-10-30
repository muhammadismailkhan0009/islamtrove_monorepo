import type { AlignmentReviewItem } from '../../../application/ports/alignment-review';

/** Preview-only data; separate from application and runtime metadata. */
const FLAGS = [6, 8, 9, 10, 11, 12, 13, 34, 61, 62, 74];
const REVIEWED = [7, 15, 21, 22, 23, 24, 25, 26, 27, 40, 78];
const DEMO_STARTS: Record<number, number> = {
  6: 27000, 7: 42100, 8: 61300, 9: 68000, 10: 82500,
  11: 92500, 12: 103800, 13: 115200, 15: 147000, 21: 232800,
  22: 267100, 23: 279500, 24: 300300, 25: 317200, 26: 331300,
  27: 340350, 34: 480200, 40: 599300, 61: 938200, 62: 952400,
  74: 1144200, 78: 1246500
};
export function mockAlignmentReviewRows(surahId: number): AlignmentReviewItem[] {
  // Prototype rows cover every Ayah so block review matches the real API.
  const count = surahId === 55 ? 78 : surahId === 18 ? 110 : surahId === 36 ? 83 : 0;
  const flagged = surahId === 55 ? new Set(FLAGS) : new Set(surahId === 36 ? [80, 81, 82] : []);
  const reviewed = new Set(surahId === 55 ? REVIEWED : surahId === 18 ? [24, 25] : []);
  return Array.from({length: count}, (_, index) => {
    const ayah = index + 1;
    return {
      ayah,
      status: reviewed.has(ayah) ? 'verified' as const
        : flagged.has(ayah) ? 'needs-review' as const : 'unflagged' as const,
      // Synthetic timestamps are visual placeholders in the mock only.
      estimatedStartMs: DEMO_STARTS[ayah] ?? (ayah - 1) * 16_000,
      reason: flagged.has(ayah) ? 'Audio alignment methods disagree on this boundary' : undefined,
      verifiedBy: reviewed.has(ayah) ? 'Listening review' : undefined
    };
  });
}
