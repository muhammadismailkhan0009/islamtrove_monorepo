import type { VersePreviewPort, VerseText } from '../../../../application/ports/verse-preview';

/** Planned backend text endpoint; no fabricated text if backend is not ready. */
export const productionVersePreviewAdapter: VersePreviewPort = {
  async getSurahVerses(surahId: number): Promise<VerseText[]> {
    const response = await fetch(`/api/quran/surahs/${surahId}/verses`);
    if (!response.ok) throw new Error(`Verse text unavailable (HTTP ${response.status})`);
    const unknownData: unknown = await response.json();
    if (!Array.isArray(unknownData) || !unknownData.every(
      (verse: unknown) => verse && typeof verse === 'object' &&
        'ayah' in verse && typeof verse.ayah === 'number' &&
        'arabic' in verse && typeof verse.arabic === 'string' &&
        'translations' in verse && typeof verse.translations === 'object'
    )) throw new Error('Verse text response is invalid');
    return unknownData as VerseText[];
  }
};
