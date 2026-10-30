const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadAdapter(sourcePath, imports={}) {
  const source = fs.readFileSync(path.resolve(__dirname,sourcePath),'utf8');
  const js = ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const m = {exports:{}};
  new Function('module','exports','require',js)(m,m.exports, spec=>{
    if (!(spec in imports)) throw new Error('Unexpected import '+spec);
    return imports[spec];
  });
  return m.exports;
}
const auth = loadAdapter('../src/infrastructure/adapters/production/admin-session/index.ts');
const prod = loadAdapter('../src/infrastructure/adapters/production/grouping-library/index.ts',
  {'../admin-session':auth}).productionGroupingLibraryAdapter;

test('production adapter publishes a single Surah using CSRF and revision',async()=>{
  const oldFetch=global.fetch, calls=[];
  global.fetch=async (url,options={})=>{
    calls.push({url,options});
    if (url==='/api/quran/groupings')
      return Response.json({schemaVersion:1,revision:3,groupings:[]});
    if (url==='/api/admin/verify')
      return Response.json({authorized:true,csrfToken:'test-csrf'});
    if (url==='/api/admin/groupings/surahs/18')
      return Response.json({schemaVersion:1,revision:4,groupings:[
        {surahId:18,boundaries:[10,26,110]},
        {surahId:55,boundaries:[15,78]}
      ]});
    throw new Error('Unexpected URL '+url);
  };
  try{
    const catalog=await prod.list();
    assert.equal(catalog.revision,3);
    assert.equal(calls[0].options.cache,'no-store');
    assert.deepEqual(await prod.authenticate('test'),{authorized:true});
    const updated=await prod.publish(3,{surahId:18,boundaries:[10,26,110]});
    assert.equal(updated.revision,4);
    assert.equal(updated.groupings.length,2);
    assert.equal(calls[2].url,'/api/admin/groupings/surahs/18');
    assert.equal(calls[2].options.headers['X-CSRF-Token'],'test-csrf');
    assert.equal(calls[2].options.credentials,'same-origin');
    assert.deepEqual(JSON.parse(calls[2].options.body),{
      expectedRevision:3,boundaries:[10,26,110]
    });
  }finally{global.fetch=oldFetch;}
});

test('adapter handles stale publication revisions',async()=>{
  const oldFetch=global.fetch;
  global.fetch=async url=>{
    if(url==='/api/admin/verify')
      return Response.json({authorized:true,csrfToken:'test'});
    if(url==='/api/admin/groupings/surahs/18')
      return Response.json({detail:'Published groupings changed. Reload before publishing.'},{status:409});
    throw new Error('Unexpected URL '+url);
  };
  try{
    await prod.authenticate('test');
    await assert.rejects(prod.publish(2,{surahId:18,boundaries:[110]}),/changed/);
  }finally{global.fetch=oldFetch;}
});

test('mock grouping adapter keeps other Surahs intact after publication',async()=>{
  const mock=loadAdapter('../src/infrastructure/adapters/mock/grouping-library/index.ts')
    .mockGroupingLibraryAdapter;
  const before=await mock.list();
  const other=structuredClone(before.groupings.find(g=>g.surahId===55));
  assert.equal((await mock.authenticate('2468')).authorized,true);
  const after=await mock.publish(before.revision,{surahId:18,boundaries:[20,110]});
  assert.equal(after.groupings.find(g=>g.surahId===18).boundaries[0],20);
  assert.deepEqual(after.groupings.find(g=>g.surahId===55),other);
  assert.equal(after.groupings.length,before.groupings.length);
});

test('Angular development proxy preserves the original browser Host',()=>{
  const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../proxy.conf.json'),'utf8'));
  assert.equal(config['/api'].changeOrigin,false);
});
