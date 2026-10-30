import { type ContinuousRecitationPort, parseQulRecitation } from '../../../../application/ports/continuous-recitation';
const pending = new Map<number, Promise<ReturnType<typeof parseQulRecitation>>>();

export const productionContinuousRecitationAdapter: ContinuousRecitationPort = {
  invalidate(surahId) { pending.delete(surahId); },
  getSurah(surahId, expectedAyahCount) {
    let task = pending.get(surahId);
    if (!task) {
      task = fetch(`/api/quran/surahs/${surahId}/continuous-recitation`, {cache:'no-store'})
        .then(response => { if (!response.ok) throw new Error('Continuous recitation unavailable'); return response.json(); })
        .then(body => {
          if (!body || !Array.isArray(body.timings)) throw new Error('Invalid QUL timing payload');
          return parseQulRecitation(surahId, expectedAyahCount, {
            audio: { url: surahId === 1 && body.audioUrl ===
              'https://everyayah.com/data/Minshawy_Mujawwad_192kbps/PageMp3s/Page001.mp3'
              ? 'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/001.mp3'
              : body.audioUrl },
            segments: Object.fromEntries(body.timings.map((x: { ayah: number; fromMs: number; toMs: number }) =>
              [`${surahId}:${x.ayah}`, { time_from: x.fromMs, time_to: x.toMs }]))
          });
        });
      pending.set(surahId, task);
      void task.catch(() => { if (pending.get(surahId) === task) pending.delete(surahId); });
    }
    return task;
  }
};
