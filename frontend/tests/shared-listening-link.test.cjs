const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/features/listening-studio/shared-listening-link.ts'), 'utf8'
);
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const loaded = {};
new Function('exports', 'require', js)(loaded, spec => {
  throw new Error('Unexpected runtime dependency: ' + spec);
});
const { parseSharedListeningLink, createSharedListeningUrl } = loaded;
const surahs = [1, 18, 55, 114];
const languages = ['English', 'Urdu', 'German'];
const parse = url => parseSharedListeningLink(new URL(url).searchParams, surahs, languages);

test('shared link configures Surah, spoken Urdu, and requested autoplay', () => {
  assert.deepEqual(parse('https://islamtrove.example/?surah=18&translation_lang=ur&autoplay=true'), {
    surahId: 18, languages: ['Urdu'], autoplay: true
  });
});

test('dual spoken audio translations are ordered; autoplay false never requests playback', () => {
  assert.deepEqual(parse('https://islamtrove.example/?surah=55&translation_lang=UR,de&autoplay=false'), {
    surahId: 55, languages: ['Urdu', 'German'], autoplay: false
  });
  assert.deepEqual(parse('https://islamtrove.example/?surah=1&translation_lang=en'), {
    surahId: 1, languages: ['English'], autoplay: false
  });
});

test('Surah-only links use existing language selection, not arbitrary URL values', () => {
  assert.deepEqual(parse('https://islamtrove.example/?surah=114'), {
    surahId: 114, languages: null, autoplay: false
  });
  assert.equal(parse('https://islamtrove.example/?autoplay=true'), null);
});

test('unknown Surahs and invalid spoken languages do not override preferences', () => {
  for (const query of [
    '?surah=0&translation_lang=ur', '?surah=115&translation_lang=ur',
    '?surah=018&translation_lang=ur', '?surah=18.5&translation_lang=ur',
    '?surah=18&translation_lang=fr', '?surah=18&translation_lang=ur,ur',
    '?surah=18&translation_lang=de,en,ur', '?surah=18&translation_lang='
  ]) {
    assert.equal(parse('https://islamtrove.example/' + query), null, query);
  }
  assert.equal(parseSharedListeningLink(
    new URLSearchParams('surah=18&translation_lang=de'), surahs, ['Urdu']
  ), null);
});

test('share action creates a real, clean URL with exactly three settings', () => {
  const url = createSharedListeningUrl(
    'https://quran.example/?groups-demo=publish&link-demo=blocked#other', 18, ['Urdu']
  );
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://quran.example');
  assert.equal(parsed.pathname, '/');
  assert.equal(parsed.hash, '');
  assert.deepEqual([...parsed.searchParams.keys()], ['surah','translation_lang','autoplay']);
  assert.deepEqual(parse(url), {surahId:18, languages:['Urdu'], autoplay:true});
  assert.equal(parsed.searchParams.get('translation_lang'),'ur');
});

test('share action preserves audio translation order and optional autoplay', () => {
  const url = createSharedListeningUrl('https://quran.example/',55,['German','English'],false);
  assert.deepEqual(parse(url), {surahId:55,languages:['German','English'],autoplay:false});
  assert.equal(new URL(url).searchParams.get('translation_lang'),'de,en');
});

test('share URL rejects invalid configurations', () => {
  assert.throws(() => createSharedListeningUrl('https://quran.example/',0,['Urdu']));
  assert.throws(() => createSharedListeningUrl('https://quran.example/',18,[]));
  assert.throws(() => createSharedListeningUrl('https://quran.example/',18,['Urdu','Urdu']));
});
