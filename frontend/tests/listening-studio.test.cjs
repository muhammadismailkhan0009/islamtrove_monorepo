const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

function loadTypeScript(relativePath) {
  const code = fs.readFileSync(path.resolve(__dirname, '../src/features/listening-studio/', relativePath), 'utf8');
  const compiled = typescript.transpileModule(code, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(module, module.exports, spec => {
    if (spec === './audio-boundaries') return loadTypeScript('audio-boundaries.ts');
    if (spec === './audio-loader') return loadTypeScript('audio-loader.ts');
    if (spec === './ayah-monitor') return loadTypeScript('ayah-monitor.ts');
    if (spec === './native-stream-transition') return loadTypeScript('native-stream-transition.ts');
    if (spec === './persistent-blob-cache') return loadTypeScript('../../infrastructure/media/persistent-blob-cache.ts');
    if (spec === '@angular/core') return {InjectionToken: class {}};
    throw new Error('Unexpected test import: ' + spec);
  });
  return module.exports;
}

const { createAudioQueue, createAudioTracks, createIndependentAudioTracks } = loadTypeScript('audio-plan.ts');
const { BufferedAudioPlayer } = loadTypeScript('media-playback.ts');
const { analyzeAudioEdges } = loadTypeScript('audio-boundaries.ts');
const { parseQulRecitation } = loadTypeScript('../../application/ports/continuous-recitation/index.ts');

test('two translations are paired Ayah-by-Ayah while Arabic stays grouped', () => {
  const queue = createAudioQueue('both', [3, 7], 7, ['English', 'German']);
  assert.equal(queue.length, 16);
  const sequence = queue.map(s => [s.passageIndex, s.mode === 'arabic' ? 'Arabic' : s.language, s.start, s.end]);
  assert.deepEqual(sequence, [
    [0, 'Arabic', 1, 3],
    [0, 'English', 1, 1], [0, 'German', 1, 1],
    [0, 'English', 2, 2], [0, 'German', 2, 2],
    [0, 'English', 3, 3], [0, 'German', 3, 3],
    [1, 'Arabic', 4, 7],
    [1, 'English', 4, 4], [1, 'German', 4, 4],
    [1, 'English', 5, 5], [1, 'German', 5, 5],
    [1, 'English', 6, 6], [1, 'German', 6, 6],
    [1, 'English', 7, 7], [1, 'German', 7, 7]
  ]);
});

test('single translations remain passage-grouped and recitation mode restores breakpoints', () => {
  const queue = createAudioQueue('both', [3, 7], 7, 'Urdu');
  assert.deepEqual(queue.map(s => [s.mode, s.start, s.end]), [
    ['arabic', 1, 3], ['translation', 1, 3],
    ['arabic', 4, 7], ['translation', 4, 7]
  ]);
  assert.deepEqual(createAudioQueue('recitation', [3, 7], 7, []).map(s => [s.mode, s.start, s.end]),
    [['arabic', 1, 3], ['arabic', 4, 7]]);
});

test('QUL timestamps define exact Arabic ranges; translations keep their sequence', () => {
  const queue = createAudioQueue('both', [2], 2, ['Urdu', 'German']);
  const reply = name => ({
    surahId: 112,
    recitation: [1, 2].map(ayah => ({ ayah, url: 'https://old-verse.example/' + ayah })),
    translationAudio: [1, 2].map(ayah => ({ ayah, url: 'https://' + name + '.example/' + ayah }))
  });
  const continuous = {
    surahId:112, audioUrl:'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/112.mp3',
    endMs:8380, timings:[{ayah:1,fromMs:0,toMs:4490},{ayah:2,fromMs:4490,toMs:8380}]
  };
  const tracks = createAudioTracks(queue, new Map([['Urdu', reply('urdu')], ['German', reply('german')]]), 112, continuous);
  assert.deepEqual(tracks.map(t => t.url), [
    continuous.audioUrl, 'https://urdu.example/1', 'https://german.example/1',
    'https://urdu.example/2', 'https://german.example/2'
  ]);
  assert.equal(tracks[0].startSeconds, 0);
  assert.equal(tracks[0].endSeconds, 8.38);
  assert.deepEqual(tracks[0].ayahTimings, continuous.timings);
  assert.equal(tracks.length,5);
});

test('Ar-Rahman uses corrected local timings for original CDN recording', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../backend/src/islamtrove/data/alignments/055.json'), 'utf8'));
  const segments = Object.fromEntries(manifest.timings.map(item =>
    [`55:${item.ayah}`, {time_from:item.fromMs,time_to:item.toMs}]));
  const parsed = parseQulRecitation(55,78, {
    audio:{url:manifest.audioUrl},segments
  });
  assert.equal(parsed.audioUrl,
    'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/055.mp3');
  assert.equal(parsed.timings.length,78);
  assert.ok(parsed.timings[6].fromMs > 41000 && parsed.timings[6].fromMs < 46000);
  assert.ok(parsed.endMs > 1262000 && parsed.endMs < 1263000);
  const tracks=createIndependentAudioTracks(createAudioQueue('recitation',[7,78],78,[]),
    55,parsed, async()=>{throw new Error('Arabic does not fetch translations')});
  assert.equal(tracks.length,2);
  assert.equal(tracks[0].endSeconds,parsed.timings[6].toMs/1000);
  assert.equal(tracks[1].startSeconds,tracks[0].endSeconds);
  assert.throws(()=>parseQulRecitation(54,78,{audio:{url:manifest.audioUrl},segments}),
    /audio URL/);
});

test('Al-Anbiya uses complete locally streamed MP3 with newly aligned Ayahs', () => {
  const metadata = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../backend/src/islamtrove/data/alignments/021.json'), 'utf8'));
  const segments = Object.fromEntries(metadata.timings.map(item =>
    ['21:' + item.ayah, {time_from:item.fromMs, time_to:item.toMs}]));
  const timeline = parseQulRecitation(21,112,{audio:{url:metadata.audioUrl},segments});
  assert.equal(timeline.audioUrl,
    'https://media.assabile.com/assabile/recitations_7892537823/mp3/' +
    'mohamed-seddik-el-menchaoui/' +
    'mohamed-seddik-el-menchaoui-021-al-anbiya-23449-6566.mp3?v=' +
    metadata.audioSha256.slice(0,12));
  assert.equal(metadata.method, 'offline-global-DTW-four-speech-features');
  assert.equal(timeline.endMs, 3517989);
  assert.equal(timeline.timings[1].fromMs, 23772);
  assert.equal(timeline.timings[111].toMs, timeline.endMs);
  const tracks=createIndependentAudioTracks(createAudioQueue('recitation',[20,112],112,[]),
    21,timeline,async()=>{throw Error('No translation needed')});
  assert.equal(tracks[1].endSeconds,timeline.endMs/1000);
  assert.throws(()=>parseQulRecitation(21,112,{
    audio:{url:'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/021.mp3'},
    segments}), /audio URL/);
});

test('Al-Kahf locally verified alignment governs highlighting and passage boundaries', () => {
  const local = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../backend/src/islamtrove/data/alignments/018.json'), 'utf8'));
  const segments = Object.fromEntries(local.timings.map(item =>
    [`18:${item.ayah}`, {time_from:item.fromMs,time_to:item.toMs}]));
  const parsed = parseQulRecitation(18,110,{
    audio:{url:local.audioUrl}, segments
  });
  assert.equal(parsed.timings.length, 110);
  assert.equal(parsed.timings[23].ayah, 24);
  assert.ok(parsed.timings[23].toMs > 1088000);
  assert.equal(parsed.timings[24].fromMs, parsed.timings[23].toMs);
  assert.ok(parsed.endMs > 4023000);
  const queue = createAudioQueue('recitation',[24,110],110,[]);
  const tracks = createIndependentAudioTracks(queue,18,parsed,async () => {
    throw new Error('No translation data needed in Arabic-only playback');
  });
  assert.equal(tracks.length,2);
  assert.equal(tracks[0].endSeconds,parsed.timings[23].toMs/1000);
  assert.equal(tracks[1].startSeconds,tracks[0].endSeconds);
  assert.equal(tracks[1].endSeconds,parsed.endMs/1000);
});

test('Al-Fatihah selects the verified continuous Page001 recording with QUL timestamps', () => {
  const lengths = [13320, 13060, 18000, 25940, 14920, 10870, 34850];
  let from = 0;
  const segments = {};
  lengths.forEach((duration, i) => {
    segments['1:' + (i+1)] = {time_from:from,time_to:from+duration};
    from += duration;
  });
  assert.equal(from,130960);
  const parsed = parseQulRecitation(1, 7, {
    audio: {url: 'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/001.mp3'},
    segments
  });
  assert.equal(parsed.endMs,130960);
  assert.equal(parsed.audioUrl,
    'https://everyayah.com/data/Minshawy_Mujawwad_192kbps/PageMp3s/Page001.mp3');
});

test('recitation-only passages retain contiguous timestamps from one source', async () => {
  const queue = createAudioQueue('recitation', [4,7], 7, []);
  const times=[0,13320,26380,44380,70320,85240,96110,130960];
  const continuous={surahId:1, audioUrl:'https://everyayah.com/data/Minshawy_Mujawwad_192kbps/PageMp3s/Page001.mp3',
    endMs:130960, timings:times.slice(1).map((end,i)=>({ayah:i+1,fromMs:times[i],toMs:end}))};
  const response={surahId:1,recitation:[],translationAudio:[]};
  const tracks = createAudioTracks(queue,new Map([['',response]]),1,continuous);
  assert.deepEqual(tracks.map(x=>[x.stage,x.startSeconds,x.endSeconds]),[
    [0,0,70.32],[1,70.32,130.96]
  ]);
  const context = new FakeAudioContext();
  context.decodeAudioData = async () => ({duration:130.952,length:6285696});
  const blobs=[];
  const player=new BufferedAudioPlayer(tracks,{
    get:async url=>{blobs.push(url);return {blob:new Blob(['audio'],{type:'audio/mpeg'}),bytes:5}}},
    {onTrack(){},onAyah(){},onPlaying(){},onFinished(){},onError(e){throw Error(e)}},context);
  await player.play();
  assert.equal(blobs.length,1);
  assert.equal(context.nodes.length,2);
  assert.equal(context.nodes[0].when + 70.32,context.nodes[1].when);
  assert.equal(context.nodes[1].offset,70.32);
  assert.ok(Math.abs(context.nodes[1].playDuration - 60.64) < 0.00001);
  assert.strictEqual(context.nodes[0].buffer,context.nodes[1].buffer);
  player.dispose();
});

test('Al-Baqarah sequence plays Arabic and available German without inventing last four MP3s', () => {
  const queue = createAudioQueue('both', [280, 286], 286, ['German']);
  const timings = Array.from({length:286}, (_,i)=>({ayah:i+1, fromMs:i*1500, toMs:(i+1)*1500}));
  const continuous = {surahId:2, audioUrl:'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/002.mp3',
    endMs:429000, timings};
  const available = Array.from({length:282}, (_,i)=>({ayah:i+1,url:'https://example.org/de/'+(i+1)+'.mp3'}));
  const german = {surahId:2, recitation:[], translationAudio:available,
    unavailableTranslationAyahs:[283,284,285,286]};
  const tracks = createAudioTracks(queue, new Map([['German',german]]), 2, continuous);
  assert.deepEqual(tracks.filter(x=>x.phase==='arabic').map(x=>x.ayah),[1,281]);
  assert.deepEqual(tracks.filter(x=>x.phase==='translation' && x.ayah>280).map(x=>x.ayah),[281,282]);
  assert.equal(tracks.some(x=>x.url.includes('/283.mp3') || x.url.includes('/286.mp3')),false);
  const unexpectedlyMissing = {...german, unavailableTranslationAyahs: []};
  assert.throws(() => createAudioTracks(queue,new Map([['German',unexpectedlyMissing]]),2,continuous), /Ayah 283/);
});

test('Arabic sequence is constructed without fetching translation metadata', async () => {
  const queue = createAudioQueue('both',[2],2,['English','German']);
  const continuous = {surahId:2,endMs:8000, audioUrl:'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/002.mp3',
    timings:[{ayah:1,fromMs:0,toMs:4000},{ayah:2,fromMs:4000,toMs:8000}]};
  const requests = [];
  const tracks = createIndependentAudioTracks(queue,2,continuous,async (language,ayah)=>{
    requests.push([language,ayah]);
    return language==='German' ? null : `https://translation.example/${ayah}.mp3`;
  });
  assert.equal(requests.length,0,'Creating and starting Arabic must not fetch a translation');
  assert.deepEqual(tracks.map(t=>t.phase),['arabic','translation','translation','translation','translation']);
  assert.equal(tracks[0].url,continuous.audioUrl);
  assert.equal(tracks[0].startSeconds,0);
  assert.equal(tracks[0].endSeconds,8);
  assert.equal(await tracks[1].resolveUrl(),'https://translation.example/1.mp3');
  assert.deepEqual(requests,[['English',1]]);
  assert.equal(await tracks[2].resolveUrl(),null);
  assert.deepEqual(requests,[['English',1],['German',1]]);
});

test('QUL metadata rejects incomplete, spoofed or contradictory Ayah timestamps', () => {
  const url='https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/112.mp3';
  const data={audio:{url},segments:{
    '112:1':{time_from:0,time_to:4490},
    '112:2':{time_from:4490,time_to:8380},
    '112:3':{time_from:8380,time_to:20760},
    '112:4':{time_from:20760,time_to:27730}
  }};
  const parsed=parseQulRecitation(112,4,data);
  assert.equal(parsed.endMs,27730);
  assert.equal(parsed.timings.length,4);
  assert.throws(()=>parseQulRecitation(112,5,data),/cover every Ayah/);
  assert.throws(()=>parseQulRecitation(112,4,{...data,audio:{url:url.replace('112.mp3','113.mp3')}}),/audio URL/);
  assert.throws(()=>parseQulRecitation(112,4,{...data,segments:{...data.segments,'112:2':{time_from:4490,time_to:4000}}}),/Invalid QUL/);
});

const { MemoryMediaCache, recommendedMemoryBudget } = loadTypeScript('../../infrastructure/media/memory-media-cache.ts');

test('cache deduplicates concurrent downloads and evicts least recently used bytes', async () => {
  let requested = [];
  const download = async url => {
    requested.push(url);
    return new Response(new Blob([new Uint8Array(6)], { type: 'audio/mpeg' }), {
      status: 200, headers: { 'Content-Type': 'audio/mpeg' }
    });
  };
  const cache = new MemoryMediaCache(12, url => url, download);
  const [one, oneAgain] = await Promise.all([cache.get('https://test/1'), cache.get('https://test/1')]);
  assert.equal(one.blob, oneAgain.blob);
  assert.equal(requested.length, 1);
  await cache.get('https://test/2');
  await cache.get('https://test/1'); // LRU touch.
  await cache.get('https://test/3');
  assert.equal(cache.usedBytes, 12);
  assert.equal(cache.has('https://test/1'), true);
  assert.equal(cache.has('https://test/2'), false);
  assert.equal(cache.has('https://test/3'), true);
  assert.ok(recommendedMemoryBudget(8) >= 512 * 1024 * 1024);
});

class FakeAudioContext {
  constructor() { this.currentTime = 5; this.destination = {}; this.nodes = []; this.closed = false; }
  async resume() {}
  async close() { this.closed = true; }
  async decodeAudioData(_data) { return { duration: 2, length: 88200 }; }
  createGain() {
    const events = [];
    this.gains ??= [];
    this.gains.push(events);
    const param = {
      events,
      setValueAtTime(value, time) { events.push({ type: 'set', value, time }); },
      linearRampToValueAtTime(value, time) { events.push({ type: 'ramp', value, time }); }
    };
    return { gain: param, connect() {}, disconnect() {} };
  }
  createBufferSource() {
    const node = {
      buffer: null, onended: null, stopped: false, when: undefined, offset: undefined,
      connect() {}, disconnect() {},
      start(when, offset, duration) { this.when = when; this.offset = offset; this.playDuration = duration; },
      stop() { this.stopped = true; }
    };
    this.nodes.push(node);
    return node;
  }
}

test('conservative edge trimming cuts only short low-level padding at joins', () => {
  const sampleRate = 1000, duration = 2, samples = sampleRate * duration;
  const mono = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    if (i > 70 && i < samples - 120) mono[i] = 0.12;
  }
  const buffer = {
    sampleRate, duration, length: samples, numberOfChannels: 1,
    getChannelData: () => mono
  };
  assert.deepEqual(analyzeAudioEdges(buffer, false, false), {start:0,end:2});
  const edges = analyzeAudioEdges(buffer, true, true);
  assert.ok(edges.start >= 0.05 && edges.start <= 0.075, JSON.stringify(edges));
  assert.ok(edges.end >= 1.88 && edges.end <= 1.91, JSON.stringify(edges));
  const first = analyzeAudioEdges(buffer, false, true);
  assert.equal(first.start, 0);
  const last = analyzeAudioEdges(buffer, true, false);
  assert.equal(last.end, 2);
});

test('continuous Al-Ikhlas limits playback to final Ayah timestamp even when MP3 is longer', async () => {
  const context = new FakeAudioContext();
  context.decodeAudioData = async () => ({duration:102.78,length:48000*103});
  const track={ stage:0,ayah:1,phase:'arabic',passageIndex:0,
    url:'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/112.mp3',
    startSeconds:4.49,endSeconds:27.73,ayahTimings:[
      {ayah:2,fromMs:4490,toMs:8380},{ayah:3,fromMs:8380,toMs:20760},{ayah:4,fromMs:20760,toMs:27730}
    ]};
  const player=new BufferedAudioPlayer([track], {
    get:async()=>({blob:new Blob(['mp3'],{type:'audio/mpeg'}),bytes:3})
  }, {onTrack(){},onAyah(){},onPlaying(){},onFinished(){},onError(e){throw Error(e)}},context);
  await player.play();
  assert.equal(context.nodes.length,1);
  assert.equal(context.nodes[0].offset,4.49);
  assert.ok(Math.abs(context.nodes[0].playDuration-(27.73-4.49))<1e-5);
  player.dispose();
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test('Web Audio overlaps the next decoded Ayah and schedules gains before the old one ends', async () => {
  const context = new FakeAudioContext();
  const downloaded = [];
  const tracks = [
    ...[1,2,3].map(ayah => ({ stage: 0, ayah, url: 'https://arabic/' + ayah, phase: 'arabic', passageIndex: 0 })),
    ...[1,2].map((n,i) => ({ stage: i+1, ayah: 1, url: 'https://translation/' + n, phase: 'translation', passageIndex: 0 }))
  ];
  const positions = [];
  const player = new BufferedAudioPlayer(tracks, {
    get: async url => { downloaded.push(url); return { blob: new Blob([url], { type:'audio/mpeg' }), bytes: url.length }; }
  }, {
    onTrack: track => positions.push([track.phase,track.ayah]),
    onPlaying() {}, onFinished() {}, onError(msg) { throw Error(msg || 'unexpected error'); }
  }, context);
  await player.play();
  assert.deepEqual(downloaded, ['https://arabic/1','https://arabic/2']);
  assert.equal(context.nodes.length, 2);
  assert.ok(context.nodes[1].when < context.nodes[0].when + 2);
  assert.ok(Math.abs(context.nodes[1].when - (context.nodes[0].when + 2 - 0.032)) < 0.0001);
  assert.deepEqual(context.gains[0].slice(-2).map(e=>[e.type,e.value]), [['set',1],['ramp',0]]);
  assert.deepEqual(context.gains[1].slice(0,2).map(e=>[e.type,e.value]), [['set',0],['ramp',1]]);
  assert.equal(context.nodes[0].onended instanceof Function, true);
  context.currentTime = context.nodes[1].when;
  context.nodes[0].onended();
  await settle();
  assert.equal(player.currentIndex, 1);
  assert.equal(context.nodes.length, 3);
  assert.ok(Math.abs(context.nodes[2].when - (context.nodes[1].when + 2 - 0.032)) < 0.0001);
  assert.deepEqual(downloaded, ['https://arabic/1','https://arabic/2','https://arabic/3']);
  assert.equal(downloaded.some(url=>url.includes('translation')), false);
  context.currentTime = context.nodes[2].when;
  context.nodes[1].onended();
  await settle();
  assert.equal(player.currentIndex, 2);
  assert.equal(downloaded.some(url=>url.includes('translation')), false);
  context.currentTime = context.nodes[2].when + 2;
  context.nodes[2].onended();
  await settle();
  assert.equal(player.currentIndex, 3);
  assert.deepEqual(downloaded.slice(-2), ['https://translation/1','https://translation/2']);
  player.dispose();
});

test('seek, pause and resume retain a correct decoded offset without overlap', async () => {
  const context = new FakeAudioContext();
  const player = new BufferedAudioPlayer([
    { stage: 0, ayah: 1, url: 'https://arabic/1', phase: 'arabic', passageIndex: 0 }
  ], { get: async () => ({ blob:new Blob(['mp3'],{type:'audio/mpeg'}), bytes:3 }) }, {
    onTrack() {}, onPlaying() {}, onFinished() {}, onError(msg) { throw Error(msg || 'unexpected'); }
  }, context);
  await player.play();
  context.currentTime = context.nodes[0].when + 0.7;
  player.pause();
  assert.equal(context.nodes[0].stopped, true);
  await player.play();
  assert.ok(Math.abs(context.nodes[1].offset - 0.7) < 0.00001);
  player.seek(0);
  assert.equal(context.nodes[1].stopped, true);
  player.dispose();
});

test('long Surah streams the full source rather than downloading hours of PCM', async () => {
  const { prepareAudio } = loadTypeScript('audio-loader.ts');
  const original = globalThis.Audio;
  const sources = [];
  class FakeAudio {
    constructor(url) { this.src = url; this.preload = ''; sources.push(this); }
    load() {} pause() {} removeAttribute() {}
  }
  globalThis.Audio = FakeAudio;
  try {
    const prepared = await prepareAudio({
      url: 'https://audio-cdn.tarteel.ai/quran/surah/minshawy/mujawwad/mp3/002.mp3',
      phase: 'arabic', stage: 0, passageIndex: 0, ayah: 1,
      startSeconds: 0, endSeconds: 8.78, recordingEndSeconds: 18342.53
    }, {get:()=>{throw new Error('Full Surah must never be downloaded')}}, new FakeAudioContext(), ()=>false);
    assert.equal(prepared.kind,'element');
    assert.equal(prepared.audio.preload,'auto');
    assert.equal(sources.length,1);
  } finally { globalThis.Audio = original; }
});

test('CORS-blocked host falls back to native playback without claiming gapless audio', async () => {
  const original = globalThis.Audio;
  const instances = [];
  class FakeAudio {
    constructor(src) { this.src=src; this.played=0; instances.push(this); }
    pause() {} load() {} removeAttribute() {} play(){this.played++; return Promise.resolve();}
  }
  globalThis.Audio = FakeAudio;
  const context = new FakeAudioContext();
  try {
    const player = new BufferedAudioPlayer([
      {stage:0,ayah:1,url:'https://no-cors.example/001001.mp3',phase:'translation',passageIndex:0}
    ], {get: async()=>{throw new TypeError('CORS blocked');}}, {
      onTrack() {}, onPlaying() {}, onFinished() {}, onError(msg){throw Error(msg || 'unexpected');}
    }, context);
    await player.play();
    assert.equal(context.nodes.length, 0);
    assert.equal(instances[0].src,'https://no-cors.example/001001.mp3');
    assert.equal(instances[0].played,1);
    player.dispose();
  } finally { globalThis.Audio = original; }
});
