import type { TranslationLanguage } from '../../application/ports/verse-preview';

export interface SharedListeningLink {
  surahId: number;
  languages: readonly TranslationLanguage[] | null;
  autoplay: boolean;
}

const LANGUAGE_CODES: Readonly<Record<string, TranslationLanguage>> = {
  ur: 'Urdu',
  en: 'English',
  de: 'German'
};
const AUDIO_CODES: Readonly<Record<TranslationLanguage, string>> = {
  Urdu: 'ur',
  English: 'en',
  German: 'de'
};

/** Generate a portable link with exactly the supported listening parameters. */
export function createSharedListeningUrl(
  currentUrl: string,
  surahId: number,
  spokenLanguages: readonly TranslationLanguage[],
  autoplay = true
): string {
  if (!Number.isInteger(surahId) || surahId < 1 || surahId > 114 ||
      !spokenLanguages.length || spokenLanguages.length > 2 ||
      new Set(spokenLanguages).size !== spokenLanguages.length) {
    throw new Error('Invalid shared listening configuration');
  }
  const url = new URL(currentUrl);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set('surah', String(surahId));
  url.searchParams.set('translation_lang', spokenLanguages.map(lang => AUDIO_CODES[lang]).join(','));
  url.searchParams.set('autoplay', String(autoplay));
  return url.toString();
}

/** Parse a listening link without allowing arbitrary values to reach the audio providers. */
export function parseSharedListeningLink(
  query: URLSearchParams,
  validSurahs: readonly number[],
  availableLanguages: readonly TranslationLanguage[]
): SharedListeningLink | null {
  const rawSurah = query.get('surah');
  if (!rawSurah || !/^[1-9]\d{0,2}$/.test(rawSurah)) return null;
  const surahId = Number(rawSurah);
  if (!validSurahs.includes(surahId)) return null;

  const rawLanguages = query.get('translation_lang');
  let languages: TranslationLanguage[] | null = null;
  if (rawLanguages !== null) {
    const codes = rawLanguages.toLowerCase().split(',').map(value => value.trim());
    if (!codes.length || codes.length > 2 || new Set(codes).size !== codes.length) return null;
    const mapped = codes.map(code => LANGUAGE_CODES[code]);
    if (mapped.some(language => !language || !availableLanguages.includes(language))) return null;
    languages = mapped as TranslationLanguage[];
  }

  return { surahId, languages, autoplay: query.get('autoplay')?.toLowerCase() === 'true' };
}
