import type { QuranCatalogPort } from '../../../../application/ports/quran-catalog';
import { SAMPLE_SURAHS } from '../../../mock-data/quran-catalog/default';

/** QuranCatalogPort mock adapter: stable samples for Design Canvas previews. */
export const mockQuranCatalogAdapter: QuranCatalogPort = {
  async listSurahs() { return SAMPLE_SURAHS; }
};
