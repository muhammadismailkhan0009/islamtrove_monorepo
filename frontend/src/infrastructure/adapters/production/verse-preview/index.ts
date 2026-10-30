import type {
  VersePreviewPort, VerseText, WrittenTranslationResult, TranslationLanguage
} from '../../../../application/ports/verse-preview';

async function request<T>(url: string, resource: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json() as {detail?: string};
      if (typeof body?.detail === 'string') detail += `: ${body.detail}`;
    } catch { /* A non-JSON provider error still retains the HTTP status. */ }
    throw new Error(`${resource} unavailable (${detail})`);
  }
  return await response.json() as T;
}

export const productionVersePreviewAdapter: VersePreviewPort = {
  async getArabicVerses(surahId): Promise<VerseText[]> {
    const data = await request<unknown>(
      `/api/quran/surahs/${surahId}/arabic-verses`, 'Arabic Quran text'
    );
    if (!Array.isArray(data) || !data.length || !data.every((row, index) =>
      row && row.ayah === index + 1 &&
      typeof row.arabic === 'string' && row.arabic.trim()
    )) throw new Error('Arabic Quran text is incomplete or out of order');
    return data.map(row => ({ayah:row.ayah, arabic:row.arabic, translations:{}}));
  },
  async getTranslationVerses(surahId, language): Promise<WrittenTranslationResult> {
    const query = new URLSearchParams({language});
    const data = await request<unknown>(
      `/api/quran/surahs/${surahId}/translation-text?${query}`,
      `${language} translation`
    );
    const record = data as Partial<WrittenTranslationResult> | null;
    const verses = record?.verses;
    if (!record || record.language !== language ||
        typeof record.attribution !== 'string' || !record.attribution.trim() ||
        typeof record.source !== 'string' || !record.source.trim() ||
        typeof record.edition !== 'string' || !record.edition.trim() ||
        !Array.isArray(verses) || !verses.length ||
        !verses.every((row, index) =>
          row && row.ayah === index + 1 &&
          typeof row.text === 'string' && row.text.trim()
        )) throw new Error(`${language} translation is incomplete or out of order`);
    return record as WrittenTranslationResult;
  },
  async getSurahVerses(surahId): Promise<VerseText[]> {
    const arabic = await this.getArabicVerses(surahId);
    const languages: TranslationLanguage[] = ['German','English','Urdu'];
    const translations = await Promise.allSettled(
      languages.map(lang=>this.getTranslationVerses(surahId,lang))
    );
    return arabic.map((verse, i) => ({
      ...verse,
      translations: Object.fromEntries(translations.flatMap((result, idx) =>
        result.status==='fulfilled' && result.value.verses.length===arabic.length
          ? [[languages[idx], result.value.verses[i].text]] : []
      ))
    }));
  }
};
