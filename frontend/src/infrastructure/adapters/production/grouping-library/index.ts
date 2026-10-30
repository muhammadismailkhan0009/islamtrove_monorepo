import { authenticateAdmin, clearAdminCsrfToken, getAdminCsrfToken } from '../admin-session';
import type { GroupingLibraryPort, GroupingDocument } from '../../../../application/ports/grouping-library';

async function body<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clearAdminCsrfToken();
    let message = 'Grouping request failed (' + response.status + ')';
    try {
      const result = await response.json() as { detail?: string };
      if (typeof result.detail === 'string') message = result.detail;
    } catch { /* Keep HTTP error. */ }
    throw new Error(message);
  }
  return await response.json() as T;
}
export const productionGroupingLibraryAdapter: GroupingLibraryPort = {
  previewOnly: false,
  async list() {
    return await body<GroupingDocument>(await fetch('/api/quran/groupings',
      { credentials: 'same-origin', cache: 'no-store' }));
  },
  authenticate: authenticateAdmin,
  async publish(expectedRevision, groupings) {
    const csrf = getAdminCsrfToken();
    if (!csrf) throw new Error('Admin session expired; sign in again.');
    return await body<GroupingDocument>(await fetch('/api/admin/groupings', {
      method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token':csrf },
      body:JSON.stringify({expectedRevision, groupings})
    }));
  }
};
