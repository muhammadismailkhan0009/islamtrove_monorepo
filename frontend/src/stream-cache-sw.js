/* IslamTrove persistent range cache, scoped to the approved same-origin
 * /api/quran/stream endpoint. Plain JavaScript so it runs without Angular. */
const DB_NAME = 'islamtrove-stream-cache-v1';
const CHUNK_BYTES = 256 * 1024;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DESKTOP_BYTES = 384 * 1024 * 1024;
const MAX_MOBILE_BYTES = 96 * 1024 * 1024;
const inflight = new Map();
let cachedBytesSinceSweep = 0;
let openDbPromise;
let sweepPromise;

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function openDatabase() {
  if (!openDbPromise) {
    openDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('chunks', { keyPath: 'id' });
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('lastAccess', 'lastAccess');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => { openDbPromise = undefined; throw error; });
  }
  return openDbPromise;
}

async function readCached(id) {
  try {
    const db = await openDatabase();
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction('chunks', 'readonly').objectStore('chunks').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!value || Date.now() - value.savedAt > CACHE_TTL_MS) return null;
    // Update only lightweight metadata, never rewrite the 256 KiB audio bytes.
    void new Promise(resolve => {
      const tx = db.transaction('entries', 'readwrite');
      const request = tx.objectStore('entries').get(id);
      request.onsuccess = () => {
        if (request.result) tx.objectStore('entries').put({ ...request.result, lastAccess: Date.now() });
      };
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
    return value;
  } catch { return null; } // Private mode, unavailable IndexedDB, etc.
}

async function saveCached(entry) {
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['chunks', 'entries'], 'readwrite');
      tx.objectStore('chunks').put(entry);
      tx.objectStore('entries').put({
        id: entry.id, bytes: entry.data.byteLength, lastAccess: Date.now()
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    cachedBytesSinceSweep += entry.data.byteLength;
    if (cachedBytesSinceSweep >= 4 * 1024 * 1024) {
      cachedBytesSinceSweep = 0;
      void pruneCache().catch(() => {});
    }
  } catch {
    // Storage quota/denial never stops recitation. Evict older chunks and
    // keep downloading without persistence if storage remains unavailable.
    void pruneCache(true).catch(() => {});
  }
}

async function budgetBytes() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(self.navigator.userAgent);
  const cap = mobile ? MAX_MOBILE_BYTES : MAX_DESKTOP_BYTES;
  try {
    const estimate = await self.navigator.storage?.estimate?.();
    if (estimate?.quota) return Math.max(16 * 1024 * 1024, Math.min(cap, estimate.quota * 0.20));
  } catch { /* Storage estimates are advisory. */ }
  return cap;
}

async function pruneCache(force = false) {
  if (sweepPromise) return sweepPromise;
  sweepPromise = (async () => {
    const db = await openDatabase();
    const entries = await new Promise((resolve, reject) => {
      const result = [];
      const req = db.transaction('entries', 'readonly')
        .objectStore('entries').index('lastAccess').openCursor();
      req.onsuccess = () => {
        if (!req.result) { resolve(result); return; }
        result.push(req.result.value);
        req.result.continue();
      };
      req.onerror = () => reject(req.error);
    });
    let total = entries.reduce((sum, item) => sum + item.bytes, 0);
    const budget = await budgetBytes();
    const target = force ? budget * 0.6 : budget;
    if (total <= target && !entries.some(e => Date.now() - e.lastAccess > CACHE_TTL_MS)) return;
    const removals = [];
    for (const entry of entries) {
      if (total <= target && Date.now() - entry.lastAccess <= CACHE_TTL_MS) break;
      total -= entry.bytes;
      removals.push(entry.id);
    }
    if (!removals.length) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['chunks', 'entries'], 'readwrite');
      for (const id of removals) {
        tx.objectStore('chunks').delete(id);
        tx.objectStore('entries').delete(id);
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  })();
  try { await sweepPromise; }
  finally { sweepPromise = undefined; }
}

function contentRange(header) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header || '');
  if (!match) throw new Error('Source does not advertise a valid byte range');
  const [, start, end, total] = match.map(Number);
  if (start > end || end >= total) throw new Error('Invalid source range');
  return { start, end, total };
}

async function fetchChunk(audioURL, start, signal) {
  const id = audioURL + '#' + start;
  const cached = await readCached(id);
  if (cached) return cached;
  if (inflight.has(id)) return inflight.get(id);
  const task = (async () => {
    const endpoint = '/api/quran/stream?url=' + encodeURIComponent(audioURL) + '&chunk=1';
    const response = await fetch(endpoint, {
      headers: { Range: `bytes=${start}-${start + CHUNK_BYTES - 1}` }, signal,
      cache: 'no-store'
    });
    if (response.status !== 206) throw new Error('Audio server did not return HTTP 206');
    const range = contentRange(response.headers.get('Content-Range'));
    if (range.start !== start || range.end - range.start + 1 > CHUNK_BYTES) {
      throw new Error('Audio server returned the wrong chunk');
    }
    const data = await response.arrayBuffer();
    if (data.byteLength !== range.end - range.start + 1) {
      throw new Error('Audio chunk was truncated');
    }
    const record = {
      id, total: range.total, start, data,
      etag: response.headers.get('ETag') || null,
      savedAt: Date.now()
    };
    await saveCached(record);
    return record;
  })();
  inflight.set(id, task);
  try { return await task; }
  finally { inflight.delete(id); }
}

async function handleStream(request) {
  const url = new URL(request.url);
  const audioURL = url.searchParams.get('url');
  if (!audioURL || !/^https:\/\/audio-cdn\.tarteel\.ai\/quran\/surah\/minshawy\/mujawwad\/mp3\/\d{3}\.mp3$/.test(audioURL)) {
    return fetch(request);
  }
  const rangeText = request.headers.get('Range');
  const match = rangeText ? /^bytes=(\d+)-(\d*)$/.exec(rangeText.trim()) : null;
  if (rangeText && !match) return fetch(request); // Unsupported/suffix ranges fall back to the server.
  const requestedStart = match ? Number(match[1]) : 0;
  const requestedEnd = match && match[2] ? Number(match[2]) : null;
  if (!Number.isSafeInteger(requestedStart) ||
      requestedEnd !== null && (!Number.isSafeInteger(requestedEnd) || requestedEnd < requestedStart)) {
    return fetch(request);
  }
  const firstOffset = Math.floor(requestedStart / CHUNK_BYTES) * CHUNK_BYTES;
  const controller = new AbortController();
  let first = await fetchChunk(audioURL, firstOffset, controller.signal);
  if (requestedStart >= first.total) {
    return new Response(null, {
      status: 416, headers: { 'Content-Range': `bytes */${first.total}` }
    });
  }
  const last = Math.min(requestedEnd ?? (first.total - 1), first.total - 1);
  let cursor = requestedStart;
  const firstTotal = first.total;
  const firstTag = first.etag;
  const fullLength = last - requestedStart + 1;
  const stream = new ReadableStream({
    async pull(output) {
      if (cursor > last) { output.close(); return; }
      try {
        const offset = Math.floor(cursor / CHUNK_BYTES) * CHUNK_BYTES;
        const chunk = first && first.start === offset
          ? first : await fetchChunk(audioURL, offset, controller.signal);
        first = null;
        if (chunk.total !== firstTotal ||
            firstTag && chunk.etag && firstTag !== chunk.etag) {
          throw new Error('Source audio changed during playback');
        }
        const begin = cursor - offset;
        const available = Math.min(chunk.data.byteLength - begin, last - cursor + 1);
        if (available <= 0) throw new Error('Invalid streaming audio chunk boundary');
        output.enqueue(new Uint8Array(chunk.data, begin, available));
        cursor += available;
      } catch (error) { output.error(error); controller.abort(); }
    },
    cancel() { controller.abort(); }
  });
  const headers = {
    'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes',
    'Content-Length': String(fullLength),
    'Cache-Control': 'no-store', 'X-IslamTrove-Stream-Cache': 'chunks'
  };
  if (rangeText) headers['Content-Range'] = `bytes ${requestedStart}-${last}/${firstTotal}`;
  return new Response(stream, { status: rangeText ? 206 : 200, headers });
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname !== '/api/quran/stream' || url.searchParams.has('chunk')) return;
  event.respondWith(handleStream(event.request).catch(() => fetch(event.request)));
});
