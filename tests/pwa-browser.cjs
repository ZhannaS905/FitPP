const {chromium,devices}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const target=process.env.FITPP_TEST_URL || 'http://127.0.0.1:8767/FitPP/';
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fitpp-pwa-'));
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,...devices['Pixel 7'],args:['--bypass-app-banner-engagement-checks']});
 try{
 const origin=new URL(target).origin,blocked=[],logs=[];
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){blocked.push(r.request().url());return r.abort();}return r.fallback();});
 await context.route('**/cloud.js*',r=>r.fulfill({contentType:'text/javascript',body:`globalThis.FitPPCloud={start(){return {writesEnabled:false,local:true,auth:{currentUser:null,onAuthStateChanged(cb){cb(null);return ()=>{}}},db:{}}}};`}));
 await context.addInitScript(()=>{window.installPromptSeen=false;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();window.installPromptSeen=true;});});
 const page=await context.newPage();page.on('pageerror',e=>logs.push(e.message));page.on('console',m=>{if(m.type()==='error')logs.push(m.text());});
 await page.goto(target);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller && window.installPromptSeen);
 const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
 const manifest=await cdp.send('Page.getAppManifest'),errors=await cdp.send('Page.getInstallabilityErrors'),m=manifest.manifest;
 assert.deepEqual(manifest.errors,[]);assert.deepEqual(errors.installabilityErrors,[]);assert.equal(m.name,'FitPP');assert.equal(m.display,'kStandalone');assert(m.startUrl.startsWith(m.scope));assert.equal(m.id,m.scope);assert.equal(new URL(m.startUrl).search,'');
 for(const icon of m.icons){const response=await context.request.get(icon.url);assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/image\/png/);}
 const response=await context.request.get(manifest.url);assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/manifest\+json|application\/json/);
 const start=m.startUrl;await page.evaluate(()=>localStorage.setItem('pwa-preserve-test','untouched'));await page.goto(start+'?v=another-version');await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 assert.equal(await page.evaluate(()=>localStorage.getItem('pwa-preserve-test')),'untouched');assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL),new URL('sw.js',start).href);
 const regs=await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,state:r.active?.state})));assert.deepEqual(regs,[{scope:m.scope,state:'activated'}]);assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
 assert.deepEqual(logs,[]);assert.deepEqual(blocked,[]);
 console.log(JSON.stringify({target,manifest:{id:m.id,scope:m.scope,start_url:m.startUrl,display:m.display},installabilityErrors:errors.installabilityErrors,beforeinstallprompt:true,worker:regs,icons:'original 192/512 loaded',cache:'none',firebaseRequests:0},null,2));
 }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});
