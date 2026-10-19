const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p));
test('manifest keeps GitHub Pages identity, stable query-free launch and original girl icons',()=>{
 const m=JSON.parse(read('manifest.webmanifest')),base='https://zhannas905.github.io/FitPP/';
 assert.equal(new URL(m.id,base).href,base);assert.equal(new URL(m.start_url,base).href,base);assert.equal(new URL(m.scope,base).href,base);assert.equal(m.display,'standalone');assert.equal(m.name,'FitPP');assert.equal(m.prefer_related_applications,false);
 const hashes={192:'f091a3fa7f8d371bc200e44bc3688e3aff0852cd891e40fa3a4fd099708e2d4f',512:'e89fddf25f4f371568b61f3ac0782c030bd5c1b108cb0dedfba48776bf9a6da0'};
 for(const size of [192,512]){const icon=m.icons.find(i=>i.sizes===`${size}x${size}`);assert(icon);assert.equal(icon.purpose,'any');const b=read(icon.src);assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);assert.equal(createHash('sha256').update(b).digest('hex'),hashes[size]);}
});
test('service worker uses network only for in-scope navigation; no API, cache, storage or background writes',async()=>{
 const handlers={},calls=[],scope='https://zhannas905.github.io/FitPP/';
 vm.runInNewContext(read('sw.js').toString(),{URL,fetch:async r=>{calls.push(r);return 'network'},self:{registration:{scope},addEventListener:(type,cb)=>handlers[type]=cb,skipWaiting:()=>Promise.resolve(),clients:{claim:()=>Promise.resolve()}}});
 for(const type of ['install','activate'])await handlers[type]({waitUntil:p=>p});
 for(const request of [{method:'POST',mode:'cors',url:'https://firestore.googleapis.com/test'},{method:'GET',mode:'cors',url:'https://firestore.googleapis.com/test'},{method:'GET',mode:'navigate',url:'https://zhannas905.github.io/other/'},{method:'GET',mode:'cors',url:scope+'persistence.js'}]){handlers.fetch({request,respondWith(){assert.fail('Must not intercept')}});}
 let result;const request={method:'GET',mode:'navigate',url:scope+'?v=new'};handlers.fetch({request,respondWith:p=>result=p});assert.equal(await result,'network');assert.deepEqual(calls,[request]);
});
