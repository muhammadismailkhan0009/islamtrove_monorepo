import type { GroupingLibraryPort, GroupingDocument } from '../../../../application/ports/grouping-library';

/** Design Canvas adapter only. No production data is submitted. */
let document: GroupingDocument = {
  schemaVersion: 1, revision: 1,
  groupings: [
    { surahId: 18, boundaries: [10,26,44,59,70,82,98,110] },
    { surahId: 55, boundaries: [13,27,44,60,78] }
  ]
};
let admin = false;
export const mockGroupingLibraryAdapter: GroupingLibraryPort = {
  previewOnly: true,
  async list() { return structuredClone(document); },
  async authenticate(code) {
    admin = code === '2468';
    return { authorized: admin, message: admin ? undefined : 'Use demo code 2468.' };
  },
  async publish(expectedRevision, groupings) {
    if (!admin) throw new Error('Not authorized in this mock preview');
    if (document.revision !== expectedRevision) throw new Error('Published groupings changed');
    document = {
      schemaVersion:1, revision:document.revision+1,
      groupings:structuredClone(groupings)
    };
    return structuredClone(document);
  }
};
