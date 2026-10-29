import type { AudioOptions, AudioOptionsPort } from '../../../../application/ports/audio-options';

/** AudioOptionsPort production adapter. API is a future Python backend boundary. */
export const productionAudioOptionsAdapter: AudioOptionsPort = {
  async listAudioOptions(): Promise<AudioOptions> {
    const response = await fetch('/api/quran/audio-options');
    if (!response.ok) throw new Error('Audio options unavailable (' + response.status + ')');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('reciters' in data) ||
      !('translationLanguages' in data) || !Array.isArray(data.reciters) ||
      !Array.isArray(data.translationLanguages) ||
      !data.reciters.every(r => typeof r === 'string') ||
      !data.translationLanguages.every(l => typeof l === 'string')) {
      throw new Error('Audio options API returned an invalid response');
    }
    return data as AudioOptions;
  }
};
