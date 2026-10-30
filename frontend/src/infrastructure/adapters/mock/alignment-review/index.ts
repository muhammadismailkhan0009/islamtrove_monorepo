import type { AlignmentReviewItem, AlignmentReviewPort } from '../../../../application/ports/alignment-review';
import { mockAlignmentReviewRows } from '../../../mock-data/alignment-review/default';

/** In-memory Design Canvas interaction, not a real authorization system. */
const data = new Map<number, AlignmentReviewItem[]>();
let authenticated = false;
export const mockAlignmentReviewAdapter: AlignmentReviewPort = {
  previewOnly: true,
  async list(surahId) {
    if (!data.has(surahId)) data.set(surahId, mockAlignmentReviewRows(surahId));
    return structuredClone(data.get(surahId)!);
  },
  async authenticate(code) {
    authenticated = code === '2468';
    return { authorized: authenticated, message: authenticated ? undefined : 'Incorrect demo code. Try 2468.' };
  },
  async submit(action) {
    if (!authenticated) throw new Error('Not authorized in this design preview');
    const rows = await this.list(action.surahId);
    if (!rows.some(row => row.ayah === action.ayah)) throw new Error('Review record not found');
    if (action.kind === 'correct' && (!Number.isInteger(action.startMs) || action.startMs < 0)) {
      throw new Error('Invalid corrected timestamp');
    }
    const updated = rows.map(row => row.ayah !== action.ayah ? row : {
      ...row, status: action.kind === 'correct' ? 'corrected' as const : 'verified' as const,
      estimatedStartMs: action.kind === 'correct' ? action.startMs : row.estimatedStartMs,
      verifiedBy: 'Demo admin'
    });
    data.set(action.surahId, updated);
    return structuredClone(updated);
  },
  async submitBlock(surahId, ayahs) {
    if (!authenticated) throw new Error('Not authorized in this design preview');
    const rows = await this.list(surahId);
    const selection = [...ayahs];
    if (!selection.length || selection.length > 286 ||
        selection.some((ayah, i) => !rows.some(row => row.ayah === ayah) ||
          (i > 0 && ayah !== selection[i - 1] + 1))) {
      throw new Error('Review block is invalid');
    }
    const ids = new Set(selection);
    const updated = rows.map(row =>
      !ids.has(row.ayah) || row.status === 'corrected' || row.status === 'verified'
        ? row
        : {...row, status: 'verified' as const, verifiedBy: 'Demo admin'}
    );
    data.set(surahId, updated);
    return structuredClone(updated);
  }
};
