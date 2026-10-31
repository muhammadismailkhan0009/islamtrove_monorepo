const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath, imports={}) {
  const source = fs.readFileSync(path.resolve(__dirname,relativePath),'utf8');
  const compiled = ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText;
  const m = {exports:{}};
  new Function('module','exports','require',compiled)(m,m.exports,name=>{
    if (!(name in imports)) throw new Error('Unexpected runtime import: '+name);
    return imports[name];
  });
  return m.exports;
}

function cloudResponse(edition='ur.jalandhry') {
  return Response.json({
    code:200,
    data:{number:1,numberOfAyahs:2,edition:{identifier:edition},
      ayahs:[{numberInSurah:1,text:'Jalandhari 1'},
        {numberInSurah:2,text:'Jalandhari 2'}]
    }
  });
}

test('production written Urdu reads from backend without stale caching',async()=>{
  const adapter=load('../src/infrastructure/adapters/production/verse-preview/index.ts')
    .productionVersePreviewAdapter;
  const old=global.fetch,calls=[];
  global.fetch=async (url,opts)=>{
    calls.push({url,opts});
    return Response.json({
      language:'Urdu',source:'Al Quran Cloud',edition:'ur.jalandhry',
      attribution:'Fateh Muhammad Jalandhari',
      verses:[{ayah:1,text:'Jalandhari 1'}]
    });
  };
  try{
    const result=await adapter.getTranslationVerses(1,'Urdu');
    assert.equal(result.edition,'ur.jalandhry');
    assert.equal(result.attribution,'Fateh Muhammad Jalandhari');
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'/api/quran/surahs/1/translation-text?language=Urdu');
    assert.equal(calls[0].opts.cache,'no-store');
  }finally{global.fetch=old;}
});

test('Design Canvas Urdu does not use outdated Junagarhi fixture or fallback',async()=>{
  const fixture=JSON.parse(fs.readFileSync(
    path.resolve(__dirname,'../src/infrastructure/mock-data/verse-preview/verses.json'),'utf8'));
  const adapter=load('../src/infrastructure/adapters/mock/verse-preview/index.ts',{
    '../../../mock-data/verse-preview/verses.json':fixture
  }).mockVersePreviewAdapter;
  const old=global.fetch,calls=[];
  global.fetch=async url=>{
    calls.push(url);
    if(url==='https://api.alquran.cloud/v1/surah/1/ur.jalandhry')
      return Response.json({detail:'temporary outage'},{status:503});
    if(url==='https://alquran.api.islamic.network/v1/surah/1/ur.jalandhry')
      return cloudResponse();
    throw new Error('Unexpected URL '+url);
  };
  try{
    const result=await adapter.getTranslationVerses(1,'Urdu');
    assert.equal(result.attribution,'Fateh Muhammad Jalandhari');
    assert.equal(result.verses[1].text,'Jalandhari 2');
    assert.equal(calls.length,2);
    assert.ok(calls.every(url=>url.endsWith('/ur.jalandhry')));
  }finally{global.fetch=old;}
});
