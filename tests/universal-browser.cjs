const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict');
const sub=(location,extra={})=>({location,price:location==='zarya'?4400:3800,left:8,startDate:'2026-09-01',expires:'2026-09-29',...extra});
const cloud=subs=>`globalThis.FitPPCloud={start(){
 const W=FitPPWorkspace,S=FitPPStore;
 const initial={...S.read({clients:[{id:'c',name:'Тест онлайн',phone:'',locations:['online','zarya','pole'],subscriptions:${JSON.stringify(subs)}}]}),ownerUid:W.ownerUid,datasetId:W.datasetId,schemaVersion:1};
 let raw=JSON.parse(localStorage.getItem('test-dataset') || JSON.stringify(initial));
 const snapshot=()=>({exists:true,metadata:{fromCache:false},data:()=>structuredClone(raw)});
 const auth={currentUser:{uid:W.ownerUid},onAuthStateChanged(cb){cb(this.currentUser);return ()=>{};},async signOut(){this.currentUser=null;}};
 return {writesEnabled:true,local:false,auth,check(){},validate:W.validate,reference(){return {get:async()=>snapshot()};},db:{async runTransaction(cb){let candidate;const result=await cb({get:async()=>snapshot(),set(ref,next){W.validate(next);candidate=next;}});if(candidate){raw=candidate;localStorage.setItem('test-dataset',JSON.stringify(raw));}return result;}}};
}};`;
(async()=>{
 for(const engine of [chromium,webkit]){
 const browser=await engine.launch();
 for(const width of [320,390])for(const location of ['zarya','pole'])for(const mode of ['zarya','pole','both']){
 const subs=mode==='both'?[sub('zarya'),sub('pole')]:[sub(mode)];
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.stack));
 await page.route('**/cloud.js*',r=>r.fulfill({contentType:'text/javascript',body:cloud(subs)}));
 await page.route(/https:\/\//,r=>{external.push(r.request().url());return r.abort();});
 const open=async()=>{await page.goto(process.env.FITPP_TEST_URL || 'http://127.0.0.1:8766');await page.waitForFunction(()=>window.Alpine && Alpine.$data(document.body).dataReady);await page.evaluate(location=>{const d=Alpine.$data(document.body);d.selectedDate=location==='zarya'?'2026-09-07':'2026-09-08';d.currentLocation=location;d.chosenWorkout=location+'_'+d.selectedDate;},location);};
 const result=()=>page.evaluate(location=>{const d=Alpine.$data(document.body);return {left:d.clients[0].subscriptions.map(s=>s.left),visit:d.sessionData().visits[location+'_'+(location==='zarya'?'2026-09-07':'2026-09-08')]?.c,finances:d.finances,ledger:FitPPStore.ledger(d.clients[0]).length};},location);
 await open();await page.getByRole('button',{name:'✓ Был (-1)',exact:true}).click();
 if(mode==='both'){
  const dialog=page.getByRole('dialog',{name:'Выберите абонемент',exact:true});await dialog.waitFor({state:'visible'});assert.equal(await page.evaluate(()=>localStorage.getItem('test-dataset')),null);
  assert(await dialog.getByRole('button',{name:/Заря · 4400/}).isVisible());assert(await dialog.getByRole('button',{name:/Поле чудес · 3800/}).isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.FITPP_SCREENSHOTS && width===390)await page.screenshot({path:process.env.FITPP_SCREENSHOTS+'/FitPP-universal-choice-'+engine.name()+'.png'});
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('test-dataset')),null);
  await page.getByRole('button',{name:'✓ Был (-1)',exact:true}).click();
  await page.evaluate(()=>{const d=Alpine.$data(document.body);d.currentLocation='online'});
  await dialog.getByRole('button',{name:/Поле чудес · 3800/}).click();
  await page.waitForFunction(()=>!Alpine.$data(document.body).subscriptionChoice);
  assert.equal(await page.evaluate(()=>localStorage.getItem('test-dataset')),null);
  await page.evaluate(location=>{Alpine.$data(document.body).currentLocation=location},location);
  await page.getByRole('button',{name:'✓ Был (-1)',exact:true}).click();await dialog.getByRole('button',{name:/Поле чудес · 3800/}).evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>!Alpine.$data(document.body).subscriptionChoice);
 }
 await page.waitForFunction(location=>{const d=Alpine.$data(document.body);return !d.saving&&d.sessionData().visits[location+'_'+d.selectedDate]?.c==='attended'},location);await page.reload();await page.waitForFunction(()=>Alpine.$data(document.body).dataReady);
 const r=await result();assert.deepEqual(r.left,mode==='both'?[8,7]:[7]);assert.equal(r.visit,'attended');assert.equal(r.ledger,0);assert.deepEqual(r.finances,{});
 await page.evaluate(location=>{const d=Alpine.$data(document.body);d.selectedDate=location==='zarya'?'2026-09-07':'2026-09-08';d.currentLocation=location;d.chosenWorkout=location+'_'+d.selectedDate;},location);
 await page.getByRole('button',{name:'Сгорело',exact:true}).click();await page.waitForFunction(location=>{const d=Alpine.$data(document.body);return !d.saving&&d.sessionData().visits[location+'_'+d.selectedDate]?.c==='missed'},location);assert.deepEqual((await result()).left,r.left);
 await page.getByRole('button',{name:'Сгорело',exact:true}).click();await page.waitForFunction(location=>{const d=Alpine.$data(document.body);return !d.saving&&!d.sessionData().visits[location+'_'+d.selectedDate]?.c},location);assert.deepEqual((await result()).left,mode==='both'?[8,8]:[8]);assert.deepEqual((await result()).finances,r.finances);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();
 }
 await browser.close();console.log(engine.name()+': both halls, both universal plans, explicit choice/cancel/double click, status change, undo, reload, no external requests, 320/390px PASS');
 }
})().catch(e=>{console.error(e);process.exit(1)});
