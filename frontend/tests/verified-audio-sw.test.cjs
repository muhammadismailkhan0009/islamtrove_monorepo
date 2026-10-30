const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the original service worker path for remote QUL source audio.
test('Ar-Rahman SW caches remote QUL recording through the range proxy', async () => {
  const registrations = new Map();
  const upstreamRequests = [];
  const originalAudio = 'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/055.mp3';
  const total = 20198605;
  const sandbox = {
    self: {
      location: { origin: 'http://127.0.0.1:4200' },
      navigator: { userAgent: 'test' },
      addEventListener(name, handler) { registrations.set(name, handler); }
    },
    URL, Response, ReadableStream, AbortController, Uint8Array, ArrayBuffer,
    Promise, Date, Number, Map, Math, console, setTimeout,
    async fetch(url, options = {}) {
      upstreamRequests.push({ url, headers: options.headers });
      assert.equal(url, '/api/quran/stream?url=' + encodeURIComponent(originalAudio) + '&chunk=1');
      assert.equal(options.headers.Range, 'bytes=0-262143');
      return new Response(new Uint8Array(262144), {
        status: 206,
        headers: { 'Content-Range': `bytes 0-262143/${total}`, 'ETag': 'verified-055' }
      });
    }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/stream-cache-sw.js'), 'utf8'), sandbox);
  const event = {
    request: new Request('http://127.0.0.1:4200/api/quran/stream?url=' +
      encodeURIComponent(originalAudio), {
      headers: { Range: 'bytes=100-199' }
    }),
    respondWith(promise) { this.response = promise; }
  };
  registrations.get('fetch')(event);
  assert.ok(event.response, 'The worker must intercept the verified recording');
  const response = await event.response;
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), `bytes 100-199/${total}`);
  assert.equal((await response.arrayBuffer()).byteLength, 100);
  assert.equal(upstreamRequests.length, 1);
});

test('Al-Anbiya SW caches verified remote Assabile MP3 ranges', async () => {
  const registrations = new Map();
  const requests = [];
  const audioURL = 'https://media.assabile.com/assabile/recitations_7892537823/mp3/' +
    'mohamed-seddik-el-menchaoui/' +
    'mohamed-seddik-el-menchaoui-021-al-anbiya-23449-6566.mp3?v=2c10e77e5f62';
  const total = 28150205;
  const sandbox = {
    self: {
      location: { origin: 'http://127.0.0.1:4200' },
      navigator: { userAgent: 'test' },
      addEventListener(name, handler) { registrations.set(name, handler); }
    },
    URL, Response, ReadableStream, AbortController, Uint8Array, ArrayBuffer,
    Promise, Date, Number, Map, Math, console, setTimeout,
    async fetch(url, options = {}) {
      requests.push({ url, headers: options.headers });
      assert.equal(url, '/api/quran/stream?url=' + encodeURIComponent(audioURL) + '&chunk=1');
      assert.equal(options.headers.Range, 'bytes=0-262143');
      return new Response(new Uint8Array(262144), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-262143/' + total, 'ETag': '2c10e77e5f62' }
      });
    }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/stream-cache-sw.js'), 'utf8'), sandbox);
  const event = {
    request: new Request('http://127.0.0.1:4200/api/quran/stream?url=' +
      encodeURIComponent(audioURL), {
      headers: { Range: 'bytes=100-199' }
    }),
    respondWith(promise) { this.response = promise; }
  };
  registrations.get('fetch')(event);
  assert.ok(event.response, 'The worker must intercept the complete local recording');
  const response = await event.response;
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 100-199/' + total);
  assert.equal((await response.arrayBuffer()).byteLength, 100);
  assert.equal(requests.length, 1);
});
