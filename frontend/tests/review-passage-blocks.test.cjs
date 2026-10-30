const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relative) {
  const code = fs.readFileSync(path.resolve(__dirname, '../src/features/listening-studio', relative), 'utf8');
  const compiled = ts.transpileModule(code, {
    compilerOptions:{ module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = {exports:{}};
  new Function('module','exports','require',compiled)(module,module.exports,()=>{
    throw Error('Unexpected runtime import in review block helper');
  });
  return module.exports;
}
const {createReviewBlocks} = load('alignment-review-blocks.ts');

test('review blocks always use listening context passages, never a fixed Ayah count', () => {
  const rows = Array.from({length:37},(_,i) => ({
    ayah:i+1, status:i===11?'needs-review':i<5?'verified':'unflagged',
    estimatedStartMs:i*1000
  }));
  const first = [{index:0,start:1,end:10},{index:1,start:11,end:26},{index:2,start:27,end:37}];
  const blocks = createReviewBlocks(rows, first);
  assert.deepEqual(blocks.map(({start,end,total})=>[start,end,total]),[
    [1,10,10],[11,26,16],[27,37,11]
  ]);
  assert.equal(blocks[1].pending,1);
  assert.deepEqual(createReviewBlocks(rows, [{index:0,start:1,end:37}])
    .map(({start,end,total})=>[start,end,total]),[[1,37,37]]);
  const regrouped = createReviewBlocks(rows, [
    {index:0,start:1,end:20},{index:1,start:21,end:37}
  ]);
  assert.deepEqual(regrouped.map(({start,end})=>[start,end]),[[1,20],[21,37]]);
});

test('previously corrected Ayahs count as checked inside passage review', () => {
  const rows = [
    {ayah:1,status:'corrected'}, {ayah:2,status:'verified'},
    {ayah:3,status:'unflagged'}
  ];
  const blocks=createReviewBlocks(rows,[{index:0,start:1,end:2},{index:1,start:3,end:3}]);
  assert.equal(blocks[0].status,'checked');
  assert.equal(blocks[0].checked,2);
  assert.equal(blocks[1].status,'unflagged');
});

test('changing passage boundaries only changes aggregated review progress', () => {
  const items = [
    {ayah:1,status:'verified',verifiedBy:'First reviewer'},
    {ayah:2,status:'corrected',verifiedBy:'Second reviewer',estimatedStartMs:1200},
    {ayah:3,status:'unflagged'},
    {ayah:4,status:'needs-review'},
    {ayah:5,status:'verified',verifiedBy:'First reviewer'}
  ];
  const original = structuredClone(items);
  const originalPassages=[{index:0,start:1,end:2},{index:1,start:3,end:5}];
  const first=createReviewBlocks(items,originalPassages);
  assert.deepEqual(first.map(b=>[b.checked,b.total,b.status]),[
    [2,2,'checked'],[1,3,'pending']
  ]);
  const regrouped=createReviewBlocks(items,[
    {index:0,start:1,end:3},{index:1,start:4,end:5}
  ]);
  assert.deepEqual(regrouped.map(b=>[b.checked,b.total,b.status]),[
    [2,3,'unflagged'],[1,2,'pending']
  ]);
  assert.deepEqual(items,original);
});
