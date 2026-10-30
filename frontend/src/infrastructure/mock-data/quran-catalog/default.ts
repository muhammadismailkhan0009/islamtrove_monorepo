import type { SurahSummary } from '../../../application/ports/quran-catalog';

/** Local-only design fixture, not an application or production data source. */
export const SAMPLE_SURAHS: readonly SurahSummary[] = [
  { id: 1, name: 'Al-Fatihah', meaning: 'The Opening', arabicName: 'الفاتحة', revelation: 'Meccan', ayahCount: 7 },
  { id: 2, name: 'Al-Baqarah', meaning: 'The Cow', arabicName: 'البقرة', revelation: 'Medinan', ayahCount: 286 },
  { id: 18, name: 'Al-Kahf', meaning: 'The Cave', arabicName: 'الكهف', revelation: 'Meccan', ayahCount: 110 },
  { id: 36, name: 'Ya-Sin', meaning: 'Ya-Sin', arabicName: 'يس', revelation: 'Meccan', ayahCount: 83 },
  { id: 55, name: 'Ar-Rahman', meaning: 'The Most Merciful', arabicName: 'الرحمن', revelation: 'Meccan', ayahCount: 78 },
  { id: 112, name: 'Al-Ikhlas', meaning: 'Sincerity', arabicName: 'الإخلاص', revelation: 'Meccan', ayahCount: 4 },
  { id: 113, name: 'Al-Falaq', meaning: 'Daybreak', arabicName: 'الفلق', revelation: 'Meccan', ayahCount: 5 },
  { id: 114, name: 'An-Nas', meaning: 'Mankind', arabicName: 'الناس', revelation: 'Meccan', ayahCount: 6 },
  { id: 103, name: 'Al-Asr', meaning: 'Time', arabicName: 'العصر', revelation: 'Meccan', ayahCount: 3 }
];
