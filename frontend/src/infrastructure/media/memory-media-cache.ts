import { PersistentBlobCache } from './persistent-blob-cache';
/**
 * Shared, high-capacity, browser-memory-only cache for downloadable media.
 * Stores Blob bytes (not audio elements) and deduplicates concurrent requests.
 * Supports an optional same-origin media bridge for providers without CORS.
 */
export interface CachedMedia {
  blob: Blob;
  bytes: number;
}

const MIB = 1024 * 1024;

export function recommendedMemoryBudget(deviceMemoryGiB?: number): number {
  if (deviceMemoryGiB !== undefined && deviceMemoryGiB <= 2) return 96 * MIB;
  if (deviceMemoryGiB !== undefined && deviceMemoryGiB <= 4) return 192 * MIB;
  if (deviceMemoryGiB !== undefined && deviceMemoryGiB >= 8) return 512 * MIB;
  return 256 * MIB;
}

export class MemoryMediaCache {
  private readonly items = new Map<string, CachedMedia>();
  private readonly pending = new Map<string, Promise<CachedMedia>>();
  private bytes = 0;

  constructor(
    readonly maxBytes = recommendedMemoryBudget(),
    private readonly resolveRequest: (url: string) => string = url => url,
    private readonly download: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly persistent?: PersistentBlobCache
  ) {}

  get usedBytes(): number { return this.bytes; }
  get entries(): number { return this.items.size; }

  has(url: string): boolean { return this.items.has(url); }

  async get(url: string): Promise<CachedMedia> {
    const previous = this.items.get(url);
    if (previous) {
      this.items.delete(url); // Move the cache hit to the most recently used end.
      this.items.set(url, previous);
      return previous;
    }
    const inflight = this.pending.get(url);
    if (inflight) return inflight;

    const promise = (async () => {
      const stored = await this.persistent?.get(url);
      if (stored) {
        this.remember(url, stored);
        return stored;
      }
      const response = await this.download(this.resolveRequest(url), { mode: 'cors' });
      if (!response.ok) throw new Error('Audio download failed: HTTP ' + response.status);
      const blob = await response.blob();
      if (!blob.size || (blob.type && !blob.type.startsWith('audio/') && blob.type !== 'application/octet-stream' && blob.type !== 'binary/octet-stream')) {
        throw new Error('Audio download returned invalid media');
      }
      const item = { blob, bytes: blob.size };
      this.remember(url, item);
      // Persistent writes are asynchronous and never block the initial Play.
      void this.persistent?.put(url, blob).catch(() => {});
      return item;
    })();
    this.pending.set(url, promise);
    try { return await promise; }
    finally { this.pending.delete(url); }
  }

  private remember(url: string, item: CachedMedia): void {
    // A recording larger than the session RAM budget can still be played.
    if (item.bytes > this.maxBytes) return;
    while (this.bytes + item.bytes > this.maxBytes && this.items.size > 0) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.items.set(url, item);
    this.bytes += item.bytes;
  }

  private delete(url: string): void {
    const current = this.items.get(url);
    if (!current) return;
    this.bytes -= current.bytes;
    this.items.delete(url);
  }

  clear(): void {
    this.items.clear();
    this.bytes = 0;
  }
}

/** Retained across player changes/Surah selection while this browser page lives. */
export function createBrowserMediaCache(isProduction: boolean): MemoryMediaCache {
  // Safari generally omits navigator.deviceMemory, including on iPhones.
  // Use a conservative budget for mobile rather than assuming 256 MiB RAM.
  const reported = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const mobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
  const memory = reported ?? (mobile ? 2 : undefined);
  return new MemoryMediaCache(
    recommendedMemoryBudget(memory),
    url => isProduction && new URL(url).hostname !== 'everyayah.com'
      ? '/api/quran/media?url=' + encodeURIComponent(url)
      : url,
    (...args) => globalThis.fetch(...args),
    new PersistentBlobCache(memory)
  );
}
