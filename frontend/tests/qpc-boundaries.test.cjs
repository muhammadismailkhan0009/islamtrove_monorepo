const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {execFileSync} = require('node:child_process');
const ROOT = path.resolve(__dirname,'..');

function loadTS(relativePath, imports={}) {
  const source=fs.readFileSync(path.join(ROOT,relativePath),'utf8');
  const js=ts.transpileModule(source, {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const mod={exports:{}};
  new Function('module','exports','require',js)(mod,mod.exports,name=>{
    if (!(name in imports)) throw new Error('Unexpected module '+name);
    return imports[name];
  });
  return mod.exports;
}

const {QPC_ENDINGS}=loadTS('src/features/listening-studio/qpc-boundaries.ts');
const {RUKU_ENDINGS}=loadTS('src/features/listening-studio/ruku-boundaries.ts');
const {suggestedBreakpoints,passagePresetSource}=loadTS(
  'src/features/listening-studio/passage-presets.ts',{
    './qpc-boundaries':{QPC_ENDINGS},
    './ruku-boundaries':{RUKU_ENDINGS},
  }
);

test('QPC provides nonoverlapping complete-Ayah sequences for every Surah',()=>{
  assert.deepEqual(Object.keys(QPC_ENDINGS).map(Number),
    Array.from({length:114},(_,i)=>i+1));
  let passages=0, ayahs=0;
  for (const [id,ends] of Object.entries(QPC_ENDINGS)) {
    const total=RUKU_ENDINGS[id].at(-1);
    assert.ok(ends.length>=1, 'no missing Surah '+id);
    assert.equal(ends.at(-1),total, 'full Ayah coverage for Surah '+id);
    assert.ok(ends.every((end,i) => Number.isSafeInteger(end)
      && end>0 && end<=total && (i===0 || end>ends[i-1])));
    assert.deepEqual(suggestedBreakpoints(Number(id),total),ends);
    assert.equal(passagePresetSource(Number(id),total),'qpc');
    passages+=ends.length;
    ayahs+=total;
  }
  assert.equal(passages,1266);
  assert.equal(ayahs,6236);
});

test('QPC exactly resolves source overlaps with earlier passage precedence',()=>{
  // Surah 4: 11-12 followed by 12-14 => 11-12 and 13-14
  const s4=QPC_ENDINGS[4];
  assert.ok(s4.includes(12));
  assert.ok(s4.includes(14));
  assert.equal(s4[s4.indexOf(12)+1],14);
  // Surah 33: 41-44 followed by 42-48 => 41-44 and 45-48
  const s33=QPC_ENDINGS[33];
  assert.ok(s33.includes(44));
  assert.equal(s33[s33.indexOf(44)+1],48);
  assert.deepEqual(QPC_ENDINGS[1],[4,6,7]);
  assert.equal(QPC_ENDINGS[18].length,22);
  assert.equal(QPC_ENDINGS[21].length,24);
});

test('QPC mismatch cannot introduce invalid passage boundaries',()=>{
  assert.equal(passagePresetSource(18,109),'whole');
  assert.deepEqual(suggestedBreakpoints(18,109),[109]);
  assert.deepEqual(suggestedBreakpoints(115,10),[10]);
  const ownCopy=suggestedBreakpoints(18,110);
  ownCopy[0]=999;
  assert.notEqual(suggestedBreakpoints(18,110)[0],999);
});

test('offline generator output exactly matches the vendored source',()=>{
  const msg=execFileSync('python3',[
    path.join(ROOT,'tools/generate_qpc_boundaries.py'),'--check'
  ],{encoding:'utf8'});
  assert.match(msg,/114 Surahs, 1266 passages, 6236 Ayahs, 2 overlap corrections/);
});
