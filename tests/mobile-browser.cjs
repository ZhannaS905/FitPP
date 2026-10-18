const { chromium, webkit } = require('playwright');
const assert=require('node:assert/strict');
(async()=>{
for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 for(const width of [320,375,390,430,844]){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:true,deviceScaleFactor:2,hasTouch:true});
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/cloud.js*',route=>route.fulfill({contentType:'text/javascript',body:`globalThis.FitPPCloud={start(){return {writesEnabled:true,local:false,auth:{currentUser:null,persistenceWarning:'',onAuthStateChanged(cb){cb(null);return ()=>{};}},db:{}}}};`}));
 await page.route(/https:\/\//,r=>r.abort());
 await page.goto(process.env.FITPP_TEST_URL || 'http://127.0.0.1:8766');await page.waitForTimeout(400);
 await page.evaluate(()=>{
 const d=Alpine.$data(document.body);d.clients=[{id:'fixture',name:'Анна Оченьдлиннаяфамилия Дляпроверкипереноса',phone:'+79991234567',locations:['zarya','pole'],subscriptions:[{left:1,expires:FitPPStore.localDate()}]}];
 d.currentUser={uid:FitPPWorkspace.ownerUid,email:'test@example.com'};d.dataReady=true;
});
 for(const tab of ['journal','clients','finances']){
 await page.evaluate(tab=>Alpine.$data(document.body).activeTab=tab,tab);await page.waitForTimeout(50);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${engine.name()} ${width} ${tab} overflow`);
 }
 await page.evaluate(()=>Alpine.$data(document.body).currentUser=null);
 await page.locator('#settings-trigger').click();
 assert(await page.locator('#settings-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),`settings overflow ${width}`);
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.locator('input[type=email]').focus();
 assert.equal(await page.locator('input[type=email]').evaluate(el=>getComputedStyle(el).fontSize),'16px');
 assert.deepEqual(errors,[]);
 if(process.env.FITPP_SCREENSHOTS && width===390)await page.screenshot({path:process.env.FITPP_SCREENSHOTS+`/FitPP-${engine.name()}-mobile.png`});
 await page.evaluate(()=>{const d=Alpine.$data(document.body);d.showAuthModal=false;d.showClientModal=true;});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const result=await page.evaluate(async()=>{
 const data={...FitPPStore.read(),ownerUid:FitPPWorkspace.ownerUid,datasetId:FitPPWorkspace.datasetId,schemaVersion:1};
 await FitPPWriteSafety.save(data); const backup=await FitPPWriteSafety.latest();
 if((await FitPPBackup.restore(backup))._fitppRevision!==0)throw Error('backup failed');
 FitPPWriteSafety.remember(false);let blocked=false;try{await FitPPWriteSafety.save(data);}catch(_){blocked=true;}
 FitPPWriteSafety.remember(true);return blocked;
 });assert(result);
 await page.reload();assert(await page.evaluate(()=>FitPPWriteSafety.intent()));
 await context.close();
 }
 await browser.close();
 console.log(engine.name()+' mobile layouts, backup roundtrip, opt-out, reload: PASS');
}
})().catch(e=>{console.error(e);process.exit(1)});
