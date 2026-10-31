import type {
  VersePreviewPort, VerseText, TranslationLanguage, WrittenTranslationResult
} from '../../../../application/ports/verse-preview';
import preview from '../../../mock-data/verse-preview/verses.json';

const EDITIONS: Record<Exclude<TranslationLanguage, 'Urdu'>, string> = {
  German: 'german_bubenheim',
  English: 'english_rwwad'
};
const arabicCache = new Map<number, Promise<VerseText[]>>();
const translationCache = new Map<string, Promise<WrittenTranslationResult>>();

function fixture(surahId: number): VerseText[] | undefined {
  return preview.surahs[String(surahId) as keyof typeof preview.surahs] as VerseText[] | undefined;
}

function remember<K extends string | number, T>(
  cache: Map<K, Promise<T>>, key: K, load: () => Promise<T>
): Promise<T> {
  let task = cache.get(key);
  if (!task) {
    task = load();
    cache.set(key, task);
    void task.catch(() => { if (cache.get(key) === task) cache.delete(key); });
  }
  return task;
}

async function fetchArabic(surahId: number): Promise<VerseText[]> {
  const response = await fetch(`https://api.alquran.cloud/v1/surah/${surahId}/quran-uthmani`);
  if (!response.ok) throw new Error(`Arabic verses unavailable (HTTP ${response.status})`);
  const payload = await response.json() as {
    code?: number;
    data?: {number?: number; numberOfAyahs?: number; ayahs?: {numberInSurah:number;text:string}[]}
  };
  const data = payload.data;
  const rows = data?.ayahs;
  if (payload.code !== 200 || data?.number !== surahId || !Array.isArray(rows) ||
      rows.length !== data?.numberOfAyahs || !rows.length ||
      !rows.every((row, i) => row.numberInSurah === i + 1 && typeof row.text === 'string' && row.text.trim())) {
    throw new Error('Arabic Quran verses incomplete');
  }
  return rows.map(row => ({ayah:row.numberInSurah,arabic:row.text,translations:{}}));
}

const CLOUD_EDITIONS: Record<TranslationLanguage, {id:string; attribution:string}> = {
  German: {id:'de.bubenheim', attribution:'Bubenheim & Elyas'},
  English: {id:'en.sahih', attribution:'Saheeh International'},
  Urdu: {id:'ur.jalandhry', attribution:'Fateh Muhammad Jalandhari'}
};
const QURANENC_CREDITS: Record<Exclude<TranslationLanguage, 'Urdu'>, string> = {
  German:'Bubenheim & Elyas', English:'Rowwad Translation Center'
};

async function fetchTranslation(surahId: number, language: TranslationLanguage): Promise<WrittenTranslationResult> {
  const primary = CLOUD_EDITIONS[language];
  // Urdu must never silently fall back to a different translator. The alternate
  // Al Quran Cloud host serves the same Jalandhari edition.
  const hosts = language === 'Urdu'
    ? ['https://api.alquran.cloud/v1', 'https://alquran.api.islamic.network/v1']
    : ['https://api.alquran.cloud/v1'];
  for (const host of hosts) {
    try {
      const response = await fetch(`${host}/surah/${surahId}/${primary.id}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as {
        code?:number;
        data?: {number?:number;numberOfAyahs?:number;
          edition?:{identifier?:string};ayahs?:{numberInSurah:number;text:string}[]};
      };
      const rows = payload.data?.ayahs;
      if (payload.code !== 200 || payload.data?.number !== surahId ||
          (payload.data.edition?.identifier && payload.data.edition.identifier !== primary.id) ||
          !Array.isArray(rows) || !rows.length || rows.length !== payload.data?.numberOfAyahs ||
          !rows.every((row,i)=>row.numberInSurah===i+1 &&
            typeof row.text==='string' && row.text.trim())) {
        throw new Error('Al Quran Cloud translation incomplete or mismatched');
      }
      return {language,source:'Al Quran Cloud',edition:primary.id,
        attribution:primary.attribution,
        verses:rows.map(row=>({ayah:row.numberInSurah,text:row.text}))};
    } catch { /* Try the alternate host or, for other languages, QuranEnc. */ }
  }
  if (language === 'Urdu') throw new Error('Urdu Jalandhari translation unavailable');
  const response = await fetch(
    `https://quranenc.com/api/v1/translation/sura/${EDITIONS[language]}/${surahId}`
  );
  if (!response.ok) throw new Error(`${language} translation unavailable (HTTP ${response.status})`);
  const payload = await response.json() as {result?:{aya:string;translation:string}[]};
  const rows = payload.result;
  if (!Array.isArray(rows) || !rows.length ||
      !rows.every((row, i)=>String(row.aya)===String(i+1) &&
        typeof row.translation==='string' && row.translation.trim())) {
    throw new Error(`QuranEnc ${language} translation incomplete`);
  }
  return {language,source:'QuranEnc',edition:EDITIONS[language],
    attribution:QURANENC_CREDITS[language],
    verses:rows.map((row,i)=>({ayah:i+1,text:row.translation}))};
}

export const mockVersePreviewAdapter: VersePreviewPort = {
  getArabicVerses(surahId): Promise<VerseText[]> {
    const items = fixture(surahId);
    if (items?.length) return Promise.resolve(items.map(row=>({...row,translations:{}})));
    return remember(arabicCache,surahId,()=>fetchArabic(surahId));
  },
  getTranslationVerses(surahId, language): Promise<WrittenTranslationResult> {
    const items = fixture(surahId);
    if (language !== 'Urdu' && items?.length && items.every(row => typeof row.translations[language] === 'string')) {
      return Promise.resolve({language,source:'Design fixture',edition:EDITIONS[language],
        attribution:QURANENC_CREDITS[language],
        verses:items.map(row => ({ayah:row.ayah,text:row.translations[language]!}))});
    }
    return remember(translationCache,`${surahId}:${language}`,()=>fetchTranslation(surahId,language));
  },
  async getSurahVerses(surahId): Promise<VerseText[]> {
    const arabic = await this.getArabicVerses(surahId);
    const languages: TranslationLanguage[]=['German','English','Urdu'];
    const responses = await Promise.allSettled(languages.map(lang => this.getTranslationVerses(surahId,lang)));
    return arabic.map((row,i) => ({
      ...row,
      translations: Object.fromEntries(responses.flatMap((response,k)=>
        response.status==='fulfilled' && response.value.verses.length===arabic.length
          ? [[languages[k], response.value.verses[i].text]] : []
      ))
    }));
  }
};
