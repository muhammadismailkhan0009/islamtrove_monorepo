import type { QuranCatalogPort, SurahSummary } from '../../../../application/ports/quran-catalog';

/**
 * QuranCatalogPort production adapter. The corresponding Python endpoint
 * is planned, not implemented yet; never silently substitute mock content.
 */
export const productionQuranCatalogAdapter: QuranCatalogPort = {
  async listSurahs(): Promise<readonly SurahSummary[]> {
    const response = await fetch('/api/quran/surahs');
    if (!response.ok) throw new Error('Quran catalog unavailable (' + response.status + ')');
    const data: unknown = await response.json();
    if (!Array.isArray(data) || !data.every(s => s && typeof s.id === 'number' &&
      typeof s.name === 'string' && Number.isInteger(s.ayahCount) && s.ayahCount > 0 &&
      typeof s.meaning === 'string' && typeof s.arabicName === 'string' &&
      (s.revelation === 'Meccan' || s.revelation === 'Medinan'))) {
      throw new Error('Quran catalog API returned an invalid response');
    }
    return data as SurahSummary[];
  }
};
