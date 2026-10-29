import type { CachedMedia } from './memory-media-cache';

const CACHE_NAME = 'islamtrove-small-mp3-v1';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MIB = 1024 * 1024;

/** Cache Storage complements the in-memory LRU cache for small MP3 clips.
 * It intentionally never stores a 293 MiB continuous Surah: those use the
 * IndexedDB range cache in stream-cache-sw.js instead. */
export class PersistentBlobCache {
  private writes = 0;
  private readonly maxBytes: number;

  constructor(deviceMemoryGiB?: number) {
    this.maxBytes = deviceMemoryGiB !== undefined && deviceMemoryGiB <= 4
      ? 48 * MIB : 128 * MIB;
  }

  private key(url: string): string {
    return new URL('/__islamtrove_cache/clip?url=' + encodeURIComponent(url), location.origin).href;
  }

  private async open(): Promise<Cache | null> {
    if (typeof caches === 'undefined' || !globalThis.isSecureContext) return null;
    try { return await caches.open(CACHE_NAME); }
    catch { return null; }
  }

  async get(url: string): Promise<CachedMedia | null> {
    const cache = await this.open();
    if (!cache) return null;
    try {
      const key = this.key(url);
      const stored = await cache.match(key);
      if (!stored) return null;
      const saved = Number(stored.headers.get('X-IslamTrove-Saved'));
      if (!Number.isFinite(saved) || Date.now() - saved > MAX_AGE_MS) {
        await cache.delete(key);
        return null;
      }
      const blob = await stored.blob();
      if (!blob.size || blob.size > this.maxBytes) {
        await cache.delete(key);
        return null;
      }
      return { blob, bytes: blob.size };
    } catch { return null; }
  }

  async put(url: string, blob: Blob): Promise<void> {
    if (!blob.size || blob.size > this.maxBytes) return;
    const cache = await this.open();
    if (!cache) return;
    try {
      await cache.put(this.key(url), new Response(blob, {
        headers: {
          'Content-Type': blob.type || 'audio/mpeg',
          'X-IslamTrove-Bytes': String(blob.size),
          'X-IslamTrove-Saved': String(Date.now())
        }
      }));
      this.writes++;
      if (this.writes % 8 === 0) await this.prune(cache);
    } catch {
      // Cache quota failure must never prevent audio playback.
      try { await this.prune(cache, true); } catch { /* Private mode. */ }
    }
  }

  private async prune(cache: Cache, force = false): Promise<void> {
    const keys = await cache.keys();
    const entries = await Promise.all(keys.map(async request => {
      const response = await cache.match(request);
      return {
        request,
        bytes: Number(response?.headers.get('X-IslamTrove-Bytes')) || 0,
        saved: Number(response?.headers.get('X-IslamTrove-Saved')) || 0
      };
    }));
    entries.sort((a, b) => a.saved - b.saved);
    let total = entries.reduce((sum, item) => sum + item.bytes, 0);
    const limit = force ? Math.floor(this.maxBytes * 0.6) : this.maxBytes;
    for (const entry of entries) {
      if (total <= limit && Date.now() - entry.saved <= MAX_AGE_MS) break;
      if (await cache.delete(entry.request)) total -= entry.bytes;
    }
  }
}
