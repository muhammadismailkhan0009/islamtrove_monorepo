import { InjectionToken } from '@angular/core';

/** Browser-session reusable media bytes, independent of any Quran provider. */
export interface MediaCachePort {
  get(url: string): Promise<{ blob: Blob; bytes: number }>;
  readonly usedBytes: number;
  readonly maxBytes: number;
  readonly entries: number;
}

export const MEDIA_CACHE = new InjectionToken<MediaCachePort>('MediaCachePort');
