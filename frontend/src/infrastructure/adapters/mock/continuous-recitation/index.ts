import { type ContinuousRecitationPort, parseQulRecitation } from '../../../../application/ports/continuous-recitation';
const pending = new Map<number, Promise<ReturnType<typeof parseQulRecitation>>>();

/** Live QUL timing API; browser CORS has been verified for the public endpoint. */
export const mockContinuousRecitationAdapter: ContinuousRecitationPort = {
  getSurah(surahId, expectedAyahCount) {
    let task = pending.get(surahId);
    if (!task) {
      task = fetch(`https://qul.tarteel.ai/api/v1/audio/surah_segments/8?surah=${surahId}&per_page=${expectedAyahCount}`)
        .then(response => { if (!response.ok) throw new Error('QUL timings unavailable'); return response.json(); })
        .then(body => parseQulRecitation(surahId, expectedAyahCount, body));
      pending.set(surahId, task);
      void task.catch(() => { if (pending.get(surahId) === task) pending.delete(surahId); });
    }
    return task;
  }
};
