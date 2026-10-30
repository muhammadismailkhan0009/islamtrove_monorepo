import type { AlignmentReviewItem, AlignmentReviewPort } from '../../../../application/ports/alignment-review';

import { authenticateAdmin, clearAdminCsrfToken, getAdminCsrfToken } from '../admin-session';

/** Review records and corrections always come from the protected backend. */
const bySurah = new Map<number, AlignmentReviewItem[]>();
async function responseData<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Administration request failed (${response.status})`;
    try {
      const body = await response.json() as {detail?: string};
      if (body.detail) message = body.detail;
    } catch { /* Keep HTTP status. */ }
    if (response.status === 401 || response.status === 403) clearAdminCsrfToken();
    throw new Error(message);
  }
  return await response.json() as T;
}
export const productionAlignmentReviewAdapter: AlignmentReviewPort = {
  previewOnly: false,
  async list(surahId) {
    const result = await responseData<AlignmentReviewItem[]>(await fetch(
      `/api/admin/surahs/${surahId}/reviews`,
      {credentials:'same-origin',cache:'no-store'}
    ));
    bySurah.set(surahId,result);
    return result;
  },
  authenticate: authenticateAdmin,
  async submit(action) {
    const csrfToken = getAdminCsrfToken();
    if (!csrfToken) throw new Error('Admin session expired; sign in again.');
    const previous = bySurah.get(action.surahId)?.find(row => row.ayah === action.ayah);
    const path = action.kind === 'correct' ? '/api/admin/ayahs/correct' : '/api/admin/ayahs/verify';
    const rows = await responseData<AlignmentReviewItem[]>(await fetch(path,{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},
      body:JSON.stringify({...action,expectedStartMs:previous?.estimatedStartMs})
    }));
    bySurah.set(action.surahId,rows);
    return rows;
  },
  async submitBlock(surahId, ayahs) {
    const csrfToken = getAdminCsrfToken();
    if (!csrfToken) throw new Error('Admin session expired; sign in again.');
    const existing = bySurah.get(surahId);
    if (!existing) throw new Error('Load the current review block before confirming.');
    const boundaries = ayahs.map(ayah => {
      const row = existing.find(item => item.ayah === ayah);
      if (!row) throw new Error('Review block is incomplete');
      return {ayah, expectedStartMs: row.estimatedStartMs};
    });
    const rows = await responseData<AlignmentReviewItem[]>(await fetch(
      '/api/admin/blocks/verify', {
        method:'POST', credentials:'same-origin', cache:'no-store',
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},
        body:JSON.stringify({surahId,boundaries})
      }
    ));
    bySurah.set(surahId, rows);
    return rows;
  }
};
