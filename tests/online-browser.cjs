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
 for(const width of [320,390])for(const mode of ['zarya','pole','both','blocked','mixed','renew-zarya','renew-pole']){
 const subs=mode==='both'?[sub('zarya'),sub('pole')]:mode==='blocked'?[sub('zarya',{left:0}),sub('pole',{expires:'2026-09-05'})]:mode==='mixed'?[sub('zarya',{left:0}),sub('pole')]:mode.startsWith('renew')?[]:[sub(mode)];
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.stack));
 await page.route('**/cloud.js*',r=>r.fulfill({contentType:'text/javascript',body:cloud(subs)}));
 await page.route(/https:\/\//,r=>{external.push(r.request().url());return r.abort();});
 const open=async()=>{await page.goto(process.env.FITPP_TEST_URL || 'http://127.0.0.1:8766');await page.waitForFunction(()=>window.Alpine && Alpine.$data(document.body).dataReady);await page.evaluate(()=>{const d=Alpine.$data(document.body);d.selectedDate='2026-09-06';d.currentLocation='online';d.chosenWorkout='online_2026-09-06';});};
 const result=()=>page.evaluate(()=>{const d=Alpine.$data(document.body);return {left:d.clients[0].subscriptions.map(s=>s.left),visit:d.sessionData().visits['online_2026-09-06']?.c,finances:d.finances,ledger:FitPPStore.ledger(d.clients[0]).length};});
 await open();await page.getByRole('button',{name:'✓ Был (-1)',exact:true}).click();
 if(mode==='both'){
  const dialog=page.getByRole('dialog',{name:'Выберите абонемент',exact:true});await dialog.waitFor({state:'visible'});assert.equal(await page.evaluate(()=>localStorage.getItem('test-dataset')),null);
  assert(await dialog.getByRole('button',{name:/Заря · 4400/}).isVisible());assert(await dialog.getByRole('button',{name:/Поле чудес · 3800/}).isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.FITPP_SCREENSHOTS && width===390)await page.screenshot({path:process.env.FITPP_SCREENSHOTS+'/FitPP-online-choice-'+engine.name()+'.png'});
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('test-dataset')),null);
  await page.getByRole('button',{name:'✓ Был (-1)',exact:true}).click();await dialog.getByRole('button',{name:/Поле чудес · 3800/}).evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>!Alpine.$data(document.body).subscriptionChoice);
 } else if(mode==='blocked'){
  await page.getByRole('dialog',{name:'Нет подходящего абонемента'}).waitFor({state:'visible'});assert.equal(await page.evaluate(()=>localStorage.getItem('test-dataset')),null);await context.close();continue;
 } else if(mode.startsWith('renew')){
  await page.getByRole('button',{name:'Оформить новый абонемент',exact:true}).click();assert.equal(await page.locator('input[x-model="subForm.date"]').inputValue(),'2026-09-06');
  await page.locator('select[x-model="subForm.type"]').selectOption(mode.slice(6));await page.getByLabel('Способ оплаты абонемента').selectOption('cash');await page.getByLabel('Получено за абонемент').fill(mode.endsWith('zarya')?'4400':'3800');
  await page.getByRole('button',{name:'Оформить',exact:true}).evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>!Alpine.$data(document.body).showSubModal);
 }
 await page.waitForFunction(()=>!Alpine.$data(document.body).saving && Alpine.$data(document.body).sessionData().visits['online_2026-09-06']?.c==='attended');await page.reload();await page.waitForFunction(()=>Alpine.$data(document.body).dataReady);
 const r=await result();assert.deepEqual(r.left,mode==='both'?[8,7]:mode==='mixed'?[0,7]:[7]);assert.equal(r.visit,'attended');assert.equal(r.ledger,mode.startsWith('renew')?1:0);if(!mode.startsWith('renew'))assert.deepEqual(r.finances,{});
 await page.evaluate(()=>{const d=Alpine.$data(document.body);d.selectedDate='2026-09-06';d.currentLocation='online';d.chosenWorkout='online_2026-09-06';});
 await page.getByRole('button',{name:'Сгорело',exact:true}).click();await page.waitForFunction(()=>!Alpine.$data(document.body).saving && Alpine.$data(document.body).sessionData().visits['online_2026-09-06']?.c==='missed');assert.deepEqual((await result()).left,r.left);
 await page.getByRole('button',{name:'Сгорело',exact:true}).click();await page.waitForFunction(()=>!Alpine.$data(document.body).saving && !Alpine.$data(document.body).sessionData().visits['online_2026-09-06']?.c);assert.deepEqual((await result()).left,mode==='both'?[8,8]:mode==='mixed'?[0,8]:[8]);assert.deepEqual((await result()).finances,r.finances);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();
 }
 await browser.close();console.log(engine.name()+': online single/both, choice/cancel/double click, expired/empty, history, renewal both, undo, reload, no external requests, 320/390px PASS');
 }
})().catch(e=>{console.error(e);process.exit(1)});
