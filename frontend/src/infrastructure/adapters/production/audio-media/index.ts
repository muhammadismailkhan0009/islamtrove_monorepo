import type { AudioMediaPort, SurahAudio } from '../../../../application/ports/audio-media';

/** The Python backend owns Quran provider selection; the browser only consumes media URLs. */
export const productionAudioMediaAdapter: AudioMediaPort = {
  async getSurahAudio(surahId, reciter, translation): Promise<SurahAudio> {
    const query = new URLSearchParams({ reciter });
    if (translation) query.set('translation', translation);
    const response = await fetch(`/api/quran/surahs/${surahId}/audio?${query}`);
    if (!response.ok) throw new Error(`Audio API unavailable (HTTP ${response.status})`);
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('recitation' in value) ||
        !('translationAudio' in value) || !Array.isArray(value.recitation) ||
        !Array.isArray(value.translationAudio)) {
      throw new Error('Audio API returned an invalid response');
    }
    // Backend Pydantic models validate actual payload content and media URL hosts.
    return value as SurahAudio;
  }
};
