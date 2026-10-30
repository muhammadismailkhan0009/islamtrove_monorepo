const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadAdapter() {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../src/infrastructure/adapters/production/grouping-library/index.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const authSource = fs.readFileSync(path.resolve(__dirname,
    '../src/infrastructure/adapters/production/admin-session/index.ts'), 'utf8');
  const authCode = ts.transpileModule(authSource, {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const auth = {exports:{}};
  new Function('module','exports','require',authCode)(
    auth,auth.exports,()=>{throw new Error('Unexpected admin import')}
  );
  const module = {exports:{}};
  new Function('module','exports','require',compiled)(
    module,module.exports,spec=>{
      if (spec === '../admin-session') return auth.exports;
      throw new Error('Unexpected runtime import: '+spec);
    }
  );
  return module.exports.productionGroupingLibraryAdapter;
}

test('grouping adapter reads public catalog and submits whole collection with admin CSRF', async () => {
  const adapter = loadAdapter(), requests = [];
  const originalFetch = global.fetch;
  const collection = [
    {surahId:18,boundaries:[10,26,110]},
    {surahId:55,boundaries:[15,78]}
  ];
  global.fetch = async (url, options={}) => {
    requests.push({url,options});
    if (url === '/api/quran/groupings') return Response.json({
      schemaVersion:1,revision:3,groupings:[]
    });
    if (url === '/api/admin/verify') return Response.json({
      authorized:true,csrfToken:'test-csrf'
    });
    if (url === '/api/admin/groupings') return Response.json({
      schemaVersion:1,revision:4,groupings:collection
    });
    throw new Error('Unexpected URL '+url);
  };
  try {
    const catalog = await adapter.list();
    assert.equal(catalog.revision,3);
    assert.equal(requests[0].options.cache,'no-store');
    assert.deepEqual(await adapter.authenticate('test-secret'),{authorized:true});
    const published = await adapter.publish(3,collection);
    assert.equal(published.revision,4);
    assert.deepEqual(published.groupings,collection);
    assert.equal(requests.length,3);
    assert.equal(requests[1].options.credentials,'same-origin');
    assert.equal(requests[2].options.headers['X-CSRF-Token'],'test-csrf');
    assert.equal(requests[2].options.method,'POST');
    assert.deepEqual(JSON.parse(requests[2].options.body),{
      expectedRevision:3,groupings:collection
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('grouping adapter surfaces stale publication conflicts', async () => {
  const adapter = loadAdapter();
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (url === '/api/admin/verify') return Response.json({authorized:true,csrfToken:'other'});
    if (url === '/api/admin/groupings') return Response.json(
      {detail:'Published groupings changed. Reload before publishing.'},
      {status:409}
    );
    throw new Error('Unexpected URL '+url);
  };
  try {
    await adapter.authenticate('test');
    await assert.rejects(adapter.publish(2,[{surahId:18,boundaries:[110]}]),
      /Published groupings changed/);
  } finally {
    global.fetch = originalFetch;
  }
});
