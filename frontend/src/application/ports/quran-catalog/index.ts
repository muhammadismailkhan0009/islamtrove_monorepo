import { InjectionToken } from '@angular/core';

export interface SurahSummary {
  id: number;
  name: string;
  meaning: string;
  arabicName: string;
  revelation: 'Meccan' | 'Medinan';
  ayahCount: number;
}

/** Domain-facing boundary: the feature never imports a source-specific dataset. */
export interface QuranCatalogPort {
  listSurahs(): Promise<readonly SurahSummary[]>;
}

export const QURAN_SURAHS = new InjectionToken<readonly SurahSummary[]>('QuranCatalogPort: surahs');
