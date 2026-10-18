const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict');
const cloud=`globalThis.FitPPCloud={start(){
 const W=FitPPWorkspace,S=FitPPStore;
 const initial={...S.read({clients:[{id:'c',name:'Тестовый клиент',phone:'',locations:['pole'],subscriptions:[{startDate:'2026-09-01',expires:'2026-09-29',left:2,price:3800}]}],finances:{'2026-09':4400},attendance:{'2026-09-03':{c:'razov'}},attendanceOps:{'2026-09-03':{c:{status:'razov',location:'pole',price:600,operationId:'old'}}}}),ownerUid:W.ownerUid,datasetId:W.datasetId,schemaVersion:1};
 let raw=JSON.parse(localStorage.getItem('test-dataset') || JSON.stringify(initial));
 const snapshot=()=>({exists:true,metadata:{fromCache:false},data:()=>structuredClone(raw)});
 const auth={currentUser:{uid:W.ownerUid},onAuthStateChanged(cb){cb(this.currentUser);return ()=>{};},async signOut(){this.currentUser=null;}};
 return {writesEnabled:true,local:false,auth,check(){},validate:W.validate,reference(){return {get:async()=>snapshot()};},db:{async runTransaction(cb){let candidate;const result=await cb({get:async()=>snapshot(),set(ref,next){W.validate(next);candidate=next;}});if(candidate){raw=candidate;localStorage.setItem('test-dataset',JSON.stringify(raw));}return result;}}};
}};`;
(async()=>{
for(const engine of [chromium,webkit]) {
 const browser=await engine.launch();
 for(const width of [320,390]) {
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.stack));
 await page.route('**/cloud.js*',r=>r.fulfill({contentType:'text/javascript',body:cloud.replace("left:2,price:3800","left:0,price:3800")}));
 await page.route(/https:\/\//,r=>r.abort());
 await page.goto(process.env.FITPP_TEST_URL || 'http://127.0.0.1:8766');
 await page.waitForFunction(()=>window.Alpine && Alpine.$data(document.body).dataReady);
 await page.evaluate(()=>{const d=Alpine.$data(document.body);d.selectedDate='2026-09-29';d.currentLocation='pole';d.chosenWorkout='pole_2026-09-29';});
 await page.getByRole('button',{name:'✓ Был (-1)',exact:true}).click();
 await page.getByRole('dialog',{name:'Нет подходящего абонемента'}).getByRole('button',{name:'Отмена',exact:true}).click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('test-dataset')),null);
 await page.getByRole('button',{name:'✓ Был (-1)',exact:true}).click();
 await page.getByRole('button',{name:'Оформить новый абонемент',exact:true}).click();
 assert.equal(await page.locator('input[x-model="subForm.date"]').inputValue(),'2026-09-29');
 assert.equal(await page.locator('select[x-model="subForm.type"]').inputValue(),'pole');
 await page.locator('select[x-model="subForm.type"]').selectOption('zarya');
 await page.getByLabel('Способ оплаты абонемента').selectOption('cash');await page.getByLabel('Получено за абонемент').fill('4400');
 const notices=[];page.on('dialog',async dialog=>{notices.push(dialog.message());await dialog.accept();});
 await page.getByRole('button',{name:'Оформить',exact:true}).click();
 await page.waitForFunction(()=>!Alpine.$data(document.body).showSubModal);
 assert.equal(notices.length,1);assert.match(notices[0],/Посещение не отмечено/);
 assert.equal(await page.evaluate(()=>Alpine.$data(document.body).sessionData().visits['pole_2026-09-29']?.c),undefined);
 await page.getByRole('button',{name:'✓ Был (-1)',exact:true}).click();await page.getByRole('button',{name:'Оформить новый абонемент',exact:true}).click();
 await page.getByLabel('Способ оплаты абонемента').selectOption('transfer');await page.getByLabel('Получено за абонемент').fill('3800');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Оформить');b.click();b.click();});
 await page.waitForFunction(()=>!Alpine.$data(document.body).showSubModal);
 await page.reload();await page.waitForFunction(()=>Alpine.$data(document.body).dataReady);
 const result=await page.evaluate(()=>{const d=Alpine.$data(document.body);return {left:d.clients[0].subscriptions.map(s=>s.left),visit:d.sessionData().visits['pole_2026-09-29'].c,ledger:FitPPStore.ledger(d.clients[0]).length};});
 assert.deepEqual(result,{left:[0,8,7],visit:'attended',ledger:2});assert.deepEqual(errors,[]);
 await context.close();
 }
 await browser.close();console.log(engine.name()+': renewal cancel, September, manual hall, no visit for other hall, double click, reload, 320/390px PASS');
}
})().catch(e=>{console.error(e);process.exit(1)});
