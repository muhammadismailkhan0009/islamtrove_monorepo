import type { TranslationAudioManifest, TranslationAudioPort } from '../../../../application/ports/translation-audio';

/** Translation endpoint never requests Arabic recitation metadata or files. */
export const productionTranslationAudioAdapter: TranslationAudioPort = {
  async getSurah(surahId, language) {
    const query = new URLSearchParams({language});
    const response = await fetch(`/api/quran/surahs/${surahId}/translation-audio?${query}`);
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json() as {detail?: string};
        if (typeof body.detail === 'string') detail += `: ${body.detail}`;
      } catch { /* Retain status code if upstream returned non-JSON. */ }
      throw new Error(`${language} audio unavailable (${detail})`);
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' ||
        (value as TranslationAudioManifest).surahId !== surahId ||
        !Array.isArray((value as TranslationAudioManifest).audio) ||
        !Array.isArray((value as TranslationAudioManifest).unavailableAyahs)) {
      throw new Error(`Invalid ${language} translation manifest`);
    }
    return value as TranslationAudioManifest;
  }
};
