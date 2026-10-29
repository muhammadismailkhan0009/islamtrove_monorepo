import type { VersePreviewPort, VerseText, TranslationLanguage } from '../../../../application/ports/verse-preview';
import preview from '../../../mock-data/verse-preview/verses.json';

/**
 * Keep the five-Surah fixture for offline design previews. Everything else
 * loads from QuranEnc's public, CORS-enabled translation API. The Arabic text
 * comes with every QuranEnc translation response.
 */
const EDITIONS: Record<TranslationLanguage, string> = {
  German: 'german_bubenheim',
  English: 'english_rwwad',
  Urdu: 'urdu_junagarhi'
};
interface QuranEncRow {
  aya: string;
  arabic_text: string;
  translation: string;
}
const pending = new Map<number, Promise<VerseText[]>>();

async function requestEdition(surahId: number, language: TranslationLanguage): Promise<QuranEncRow[]> {
  const response = await fetch(
    `https://quranenc.com/api/v1/translation/sura/${EDITIONS[language]}/${surahId}`
  );
  if (!response.ok) throw new Error(`QuranEnc ${language} verses: HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('result' in payload)) {
    throw new Error('QuranEnc returned an invalid verse response');
  }
  const entries = (payload as { result: unknown }).result;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 286) {
    throw new Error('QuranEnc did not return a complete Surah');
  }
  entries.forEach((row, index) => {
    if (!row || String(row.aya) !== String(index + 1) ||
        typeof row.arabic_text !== 'string' || !row.arabic_text.trim() ||
        typeof row.translation !== 'string' || !row.translation.trim()) {
      throw new Error(`Invalid QuranEnc ${language} text at Ayah ${index + 1}`);
    }
  });
  return entries as QuranEncRow[];
}

async function getOnlineVerses(surahId: number): Promise<VerseText[]> {
  const languages: TranslationLanguage[] = ['German', 'English', 'Urdu'];
  const results = await Promise.all(languages.map(language => requestEdition(surahId, language)));
  const count = results[0].length;
  if (results.some(items => items.length !== count)) {
    throw new Error('QuranEnc translation editions have inconsistent Ayah counts');
  }
  return Array.from({ length: count }, (_, index) => ({
    ayah: index + 1,
    arabic: results[0][index].arabic_text,
    translations: Object.fromEntries(
      languages.map((language, languageIndex) =>
        [language, results[languageIndex][index].translation]
      )
    ) as Record<TranslationLanguage, string>
  }));
}

export const mockVersePreviewAdapter: VersePreviewPort = {
  getSurahVerses(surahId: number): Promise<VerseText[]> {
    const fixture = preview.surahs[String(surahId) as keyof typeof preview.surahs];
    if (fixture?.length) return Promise.resolve(fixture as VerseText[]);
    let task = pending.get(surahId);
    if (!task) {
      task = getOnlineVerses(surahId);
      pending.set(surahId, task);
      void task.catch(() => {
        if (pending.get(surahId) === task) pending.delete(surahId);
      });
    }
    return task;
  }
};
