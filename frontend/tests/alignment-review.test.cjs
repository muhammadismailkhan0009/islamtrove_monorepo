const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const base = path.resolve(__dirname,'../src');
function readTS(file, imports={}) {
  const code = fs.readFileSync(path.join(base,file),'utf8');
  const js = ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('module','exports','require',js)(module,module.exports, name=>{
    if (!(name in imports)) throw new Error('Unknown import: '+name);
    return imports[name];
  });
  return module.exports;
}
const fixtures = readTS('infrastructure/mock-data/alignment-review/default.ts');
const {mockAlignmentReviewAdapter: mock} = readTS('infrastructure/adapters/mock/alignment-review/index.ts',{
  '../../../mock-data/alignment-review/default': fixtures
});
const adminSession = readTS('infrastructure/adapters/production/admin-session/index.ts');
const {productionAlignmentReviewAdapter: production} = readTS(
  'infrastructure/adapters/production/alignment-review/index.ts',
  {'../admin-session': adminSession}
);

test('review prototype requires simulated admin access and never invokes a production write',async()=>{
  assert.equal(mock.previewOnly,true);
  assert.equal(production.previewOnly,false);
  const rows = await mock.list(55);
  assert.equal(rows.filter(x=>x.status==='needs-review').length,11);
  assert.equal(rows.filter(x=>x.status==='verified').length,11);
  assert.equal(rows.find(x=>x.ayah===7).status,'verified');
  await assert.rejects(mock.submit({kind:'verify',surahId:55,ayah:6}),/authorized/);
  assert.equal((await mock.authenticate('bad-code')).authorized,false);
  assert.equal((await mock.authenticate('2468')).authorized,true);
  const next=await mock.submit({kind:'correct',surahId:55,ayah:6,startMs:27400});
  assert.equal(next.find(x=>x.ayah===6).status,'corrected');
  assert.equal(next.find(x=>x.ayah===6).estimatedStartMs,27400);
  assert.equal(next.filter(x=>x.status==='needs-review').length,10);
  assert.equal((await mock.list(55)).find(x=>x.ayah===6).verifiedBy,'Demo admin');
  const verified=await mock.submit({kind:'verify',surahId:55,ayah:8});
  assert.equal(verified.find(x=>x.ayah===8).status,'verified');
});

test('production review adapter fetches real status, obtains admin session and sends CSRF on writes', async()=>{
  const originalFetch = global.fetch;
  const requests=[];
  let csrfOK=false;
  try {
    global.fetch=async (url,options={})=>{
      requests.push({url,options});
      if(url.endsWith('/reviews')) return new Response(JSON.stringify([
        {ayah:6,status:'needs-review',estimatedStartMs:27100}
      ]),{status:200,headers:{'content-type':'application/json'}});
      if(url==='/api/admin/verify') return new Response(JSON.stringify({
        authorized:true,csrfToken:'csrf-secret-test-only'
      }),{status:200,headers:{'content-type':'application/json'}});
      if(url==='/api/admin/ayahs/correct') {
        assert.equal(options.headers['X-CSRF-Token'],'csrf-secret-test-only');
        assert.equal(options.credentials,'same-origin');
        const payload=JSON.parse(options.body);
        assert.equal(payload.expectedStartMs,27100);
        assert.equal(payload.startMs,27500);
        csrfOK=true;
        return new Response(JSON.stringify([{
          ayah:6,status:'corrected',estimatedStartMs:27500
        }]),{status:200,headers:{'content-type':'application/json'}});
      }
      throw new Error('Unexpected API path '+url);
    };
    await assert.rejects(production.submit({kind:'correct',surahId:55,ayah:6,startMs:27500}),/expired/);
    assert.equal((await production.list(55))[0].status,'needs-review');
    assert.equal((await production.authenticate('local-admin-code')).authorized,true);
    const updated=await production.submit({kind:'correct',surahId:55,ayah:6,startMs:27500});
    assert.equal(updated[0].status,'corrected');
    assert.ok(csrfOK);
    assert.equal(requests.filter(r=>r.options.method==='POST').length,2);
  } finally {global.fetch=originalFetch;}
});

test('bulk passage verification updates individual Ayahs without rewriting prior verification', async () => {
  assert.equal((await mock.authenticate('2468')).authorized, true);
  const before = await mock.list(55);
  const alreadyVerified = structuredClone(before.find(row => row.ayah === 7));
  assert.equal(alreadyVerified.status, 'verified');
  assert.equal(alreadyVerified.verifiedBy, 'Listening review');

  const first = await mock.submitBlock(55, [6, 7, 8, 9, 10]);
  assert.ok([6, 7, 8, 9, 10].every(n => first.find(row => row.ayah === n).status
    === (n === 6 ? 'corrected' : 'verified')));
  assert.deepEqual(first.find(row => row.ayah === 7), alreadyVerified);
  const previouslyReviewed = structuredClone(first.find(row => row.ayah === 9));

  // Editing breakpoints now groups Ayahs 9–13 into a different passage.
  const regrouped = await mock.submitBlock(55, [9, 10, 11, 12, 13]);
  assert.deepEqual(regrouped.find(row => row.ayah === 9), previouslyReviewed);
  assert.equal(regrouped.find(row => row.ayah === 6).status, 'corrected');
  assert.deepEqual(regrouped.find(row => row.ayah === 7), alreadyVerified);
  assert.equal(regrouped.find(row => row.ayah === 11).status, 'verified');
  assert.equal(regrouped.find(row => row.ayah === 14).status, 'unflagged');
});
