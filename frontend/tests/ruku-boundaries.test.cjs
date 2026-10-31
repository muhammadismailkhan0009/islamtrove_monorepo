const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function importModule(file, imports={}) {
  const src = fs.readFileSync(path.resolve(__dirname,file),'utf8');
  const compiled = ts.transpileModule(src, {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const m={exports:{}};
  new Function('module','exports','require',compiled)(m,m.exports,key=>{
    if (!(key in imports)) throw new Error('Unknown import '+key);
    return imports[key];
  });
  return m.exports;
}
const {RUKU_ENDINGS} = importModule('../src/features/listening-studio/ruku-boundaries.ts');
const {suggestedBreakpoints, passagePresetSource} = importModule('../src/features/listening-studio/passage-presets.ts', {
  './ruku-boundaries':{RUKU_ENDINGS},
  './qpc-boundaries':{QPC_ENDINGS:{}} // Force the safety fallback in these tests.
});

test('Rukūʿ metadata covers all 114 Surahs and has 556 proper section endings',()=>{
  const ids=Object.keys(RUKU_ENDINGS).map(Number);
  assert.deepEqual(ids,Array.from({length:114},(_,i)=>i+1));
  assert.equal(ids.reduce((total,id)=>total+RUKU_ENDINGS[id].length,0),556);
  for(const id of ids){
    const boundaries=RUKU_ENDINGS[id];
    assert.ok(boundaries.length>=1,'Surah '+id+' has at least one Rukūʿ');
    assert.ok(boundaries.every(Number.isInteger));
    assert.ok(boundaries.every((end,i)=>end>0 && (i===0 || end>boundaries[i-1])),
      'Surah '+id+' has strictly increasing endings');
    const count=boundaries.at(-1);
    assert.deepEqual(suggestedBreakpoints(id,count),boundaries);
  }
});

test('Rukūʿ fallback has correct contextual sections for common Surahs',()=>{
  assert.deepEqual(suggestedBreakpoints(1,7),[7]);
  assert.deepEqual(suggestedBreakpoints(2,286).slice(0,5),[7,20,29,39,46]);
  assert.deepEqual(suggestedBreakpoints(18,110),
    [12,17,22,31,44,49,53,59,70,82,101,110]);
  assert.equal(passagePresetSource(18,110),'ruku');
  assert.deepEqual(suggestedBreakpoints(55,78),[25,45,78]);
  assert.deepEqual(suggestedBreakpoints(114,6),[6]);
});

test('Rukūʿ fallback never returns mismatched or shared mutable boundaries',()=>{
  assert.deepEqual(suggestedBreakpoints(18,109),[109]);
  assert.equal(passagePresetSource(18,109),'whole');
  assert.deepEqual(suggestedBreakpoints(115,10),[10]);
  const first=suggestedBreakpoints(18,110);
  first[0]=3;
  assert.equal(suggestedBreakpoints(18,110)[0],12);
});
