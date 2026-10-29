import { InjectionToken } from '@angular/core';

/** Maps an approved continuous MP3 to a progressively streamable URL.
 * Production uses a same-origin range proxy with persistent chunk caching;
 * design preview keeps the original CDN URL if no API is available. */
export interface StreamingSourcePort {
  resolve(url: string): string;
}
export const STREAMING_SOURCE = new InjectionToken<StreamingSourcePort>('StreamingSourcePort');
