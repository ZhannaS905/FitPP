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
 page.on('pageerror',e=>errors.push(e.stack));await page.route('**/cloud.js*',r=>r.fulfill({contentType:'text/javascript',body:cloud}));await page.route(/https:\/\//,r=>r.abort());
 await page.goto(process.env.FITPP_TEST_URL || 'http://127.0.0.1:8766');await page.waitForFunction(()=>window.Alpine && Alpine.$data(document.body).dataReady);
 await page.evaluate(()=>{const d=Alpine.$data(document.body);d.selectedDate='2026-09-29';d.openSubModal(d.clients[0]);});
 await page.locator('select[x-model="subForm.type"]').selectOption('pole');await page.locator('input[x-model="subForm.date"]').fill('2026-09-29');
 // No method or amount must not write or invalidate confirmed data.
 await page.getByRole('button',{name:'Оформить',exact:true}).click();assert.equal(await page.evaluate(()=>Alpine.$data(document.body).dataReady),true);
 assert.equal(await page.evaluate(()=>localStorage.getItem('test-dataset')),null);
 await page.getByLabel('Способ оплаты абонемента').selectOption('cash');await page.getByLabel('Получено за абонемент').fill('4000');if(process.env.FITPP_SCREENSHOTS && width===390)await page.screenshot({path:process.env.FITPP_SCREENSHOTS+'/FitPP-sale-'+engine.name()+'.png'});await page.getByRole('button',{name:'Оформить',exact:true}).click();
 await page.waitForFunction(()=>!Alpine.$data(document.body).showSubModal);assert.equal(await page.evaluate(()=>FitPPStore.balance(Alpine.$data(document.body).clients[0])),200);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.reload();await page.waitForFunction(()=>Alpine.$data(document.body).dataReady);
 assert.equal(await page.evaluate(()=>FitPPStore.balance(Alpine.$data(document.body).clients[0])),200);
 await page.evaluate(()=>{const d=Alpine.$data(document.body);d.selectedDate='2026-10-01';d.openSubModal(d.clients[0]);});await page.locator('select[x-model="subForm.type"]').selectOption('pole');
 assert(await page.getByText('Баланс: 200 ₽ · К оплате: 3600 ₽',{exact:true}).isVisible());await page.getByLabel('Способ оплаты абонемента').selectOption('transfer');await page.getByLabel('Получено за абонемент').fill('3600');await page.getByRole('button',{name:'Оформить',exact:true}).click();await page.waitForFunction(()=>!Alpine.$data(document.body).showSubModal);
 // Actual UI for old subscription and unmigrated old single payment.
 for(let i=0;i<2;i++) {
 await page.evaluate(()=>{const d=Alpine.$data(document.body);d.activeTab='clients';d.detailClient=d.clients[0];d.detailTab='payments';});
 await page.getByRole('button',{name:'Уточнить оплату',exact:true}).first().click();await page.getByRole('dialog',{name:'Оплата',exact:true}).getByLabel('Способ оплаты',{exact:true}).selectOption(i===0?'cash':'transfer');await page.getByRole('dialog',{name:'Оплата',exact:true}).getByRole('button',{name:'Сохранить',exact:true}).click();await page.waitForFunction(()=>!Alpine.$data(document.body).paymentDraft);
 }
 await page.evaluate(()=>{const d=Alpine.$data(document.body);d.detailClient=null;d.activeTab='journal';d.selectedDate='2026-10-06';d.currentLocation='pole';d.chosenWorkout='pole_2026-10-06';});
 await page.getByRole('button',{name:'₽ Разово (600)',exact:true}).click();await page.getByRole('dialog',{name:'Оплата',exact:true}).getByLabel('Способ оплаты',{exact:true}).selectOption('cash');await page.getByLabel('Фактически получено',{exact:true}).fill('700');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole('dialog',{name:'Оплата',exact:true}).getByRole('button',{name:'Сохранить',exact:true}).click();await page.waitForFunction(()=>!Alpine.$data(document.body).paymentDraft);
 await page.reload();await page.waitForFunction(()=>Alpine.$data(document.body).dataReady);
 assert.deepEqual(await page.evaluate(()=>{const d=Alpine.$data(document.body),s=d.sessionDataWithFinances();return {balance:FitPPStore.balance(d.clients[0]),september:FitPPStore.report(s,'2026-09'),october:FitPPStore.report(s,'2026-10')};}),{balance:100,september:{cash:7800,transfer:600,cashRefund:0,transferRefund:0,unknown:0,total:8400},october:{cash:700,transfer:3600,cashRefund:0,transferRefund:0,unknown:0,total:4300}});
 await page.evaluate(()=>{const d=Alpine.$data(document.body);d.activeTab='finances';d.currentMonth='2026-09';});
 await page.getByRole('button',{name:'Детализация финансов',exact:true}).click();
 await page.getByText('Наличные (после возвратов): 7800 ₽',{exact:true}).waitFor({state:'visible'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.FITPP_SCREENSHOTS && width===390)await page.screenshot({path:process.env.FITPP_SCREENSHOTS+'/FitPP-payments-'+engine.name()+'.png',fullPage:true});
 await page.evaluate(()=>{const d=Alpine.$data(document.body);d.activeTab='clients';d.detailClient=d.clients[0];d.detailTab='subs';});
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Отменить продажу',exact:true}).nth(1).click();await page.waitForFunction(()=>FitPPStore.balance(Alpine.$data(document.body).clients[0])===3900);
 await page.evaluate(()=>Alpine.$data(document.body).detailTab='payments');await page.getByRole('button',{name:'Вернуть деньги с баланса',exact:true}).click();
 await page.getByRole('dialog',{name:'Оплата',exact:true}).getByLabel('Способ оплаты',{exact:true}).selectOption('cash');await page.getByLabel('Фактически получено',{exact:true}).fill('3900');await page.getByRole('dialog',{name:'Оплата',exact:true}).getByRole('button',{name:'Сохранить',exact:true}).click();await page.waitForFunction(()=>!Alpine.$data(document.body).paymentDraft);
 await page.reload();await page.waitForFunction(()=>Alpine.$data(document.body).dataReady);assert.equal(await page.evaluate(()=>FitPPStore.balance(Alpine.$data(document.body).clients[0])),0);
 assert.equal(await page.evaluate(()=>FitPPStore.report(Alpine.$data(document.body).sessionDataWithFinances(),'2026-10').cashRefund),3900);
 const backups=await page.evaluate(async()=>{const backup=await FitPPWriteSafety.latest();return (await FitPPBackup.restore(backup))._fitppRevision;});assert(backups>=4);assert.deepEqual(errors,[]);await context.close();
 }
 await browser.close();console.log(engine.name()+': payment forms, September legacy, backup, reload, cash/transfer report, 320/390px PASS');
}
})().catch(e=>{console.error(e);process.exit(1)});
