import type { AlignmentReviewItem } from '../../application/ports/alignment-review';
import type { Passage } from './audio-plan';

export interface ReviewBlock {
  start: number;
  end: number;
  pending: number;
  checked: number;
  total: number;
  status: 'pending' | 'checked' | 'unflagged';
}

/** Existing listening passages are the review blocks: never invent boundaries. */
export function createReviewBlocks(
  rows: readonly AlignmentReviewItem[], passages: readonly Passage[]
): ReviewBlock[] {
  const byAyah = new Map(rows.map(row => [row.ayah, row]));
  return passages.map(({ start, end }) => {
    const section = Array.from({ length: end - start + 1 }, (_, i) => byAyah.get(start + i));
    const pending = section.filter(row => row?.status === 'needs-review').length;
    const checked = section.filter(row => row?.status === 'verified' || row?.status === 'corrected').length;
    return {
      start, end, pending, checked, total: section.length,
      status: checked === section.length ? 'checked' : pending > 0 ? 'pending' : 'unflagged'
    };
  });
}
