// Exercise the actual cloud/adapter/store code with an in-memory SDK, never Firebase.
const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../persistence.js'),W=require('../firebase-adapter.js'),C=require('../cloud.js');
const day='2026-10-19',base=()=>({...S.read({clients:[{id:'fake',name:'Тест',subscriptions:[]}],finances:{'2026-09':10000,'2026-10':20000}}),ownerUid:W.ownerUid,datasetId:W.datasetId,schemaVersion:1});
const add={type:'taxPayment',mode:'save',paymentId:'tax-readiness',expected:S.fingerprint(null),amount:879,paidDate:'2026-10-14',period:'2026-09'};
function server({denyTax=false,retry=false,loseReply=false}={}){
 let raw=base(),writes=0,chain=Promise.resolve(),lost=false;const backups=[];
 const snapshot=()=>({exists:true,metadata:{fromCache:false,hasPendingWrites:false},data:()=>structuredClone(raw)});
 const rawDB={doc:path=>({path,get:async()=>snapshot()}),runTransaction(callback){
  const run=chain.then(async()=>{let next;const tx={get:async()=>snapshot(),update(ref,value){assert.equal(ref.path,W.path);if(denyTax&&Object.hasOwn(value,'taxPayments'))throw Error('permission-denied');next=structuredClone(value);}};
   if(retry)await callback(tx);next=undefined;const value=await callback(tx);if(next){raw=next;writes++;}if(loseReply&&!lost){lost=true;throw Error('Connection lost after commit');}return value;});chain=run.catch(()=>{});return run;
 }};
 const sdk=()=>({auth:{Auth:{Persistence:{LOCAL:'LOCAL'}}},initializeApp(config){return {options:config,auth:()=>({currentUser:{uid:W.ownerUid},async setPersistence(){},onAuthStateChanged(cb){cb(this.currentUser);return()=>{}},async signOut(){this.currentUser=null}}),firestore:()=>rawDB}}});
 return {get raw(){return structuredClone(raw)},get writes(){return writes},backups,async device(){const workspace=C.start(sdk(),W);let state;const store=S.create({db:workspace.db,auth:workspace.auth,workspace,clock:()=>day,beforeWrite:async data=>backups.push(structuredClone(data))});store.start(s=>state=s);await new Promise(r=>setImmediate(r));assert(state.dataReady);return {store,get state(){return state}}}};
}
test('actual adapter: two devices add/edit/delete; reload synchronizes; stale writes never overwrite another device',async()=>{
 const srv=server(),a=await srv.device(),b=await srv.device(),original=srv.raw;
 assert(await a.store.run(add));assert.equal(srv.writes,1);assert.equal(b.state.taxPayments,undefined); // No realtime subscription in the app.
 assert.equal(await b.store.run({...add,paymentId:'tax-other'}),false);assert.equal(srv.writes,1);assert.equal(b.state.dataReady,false);
 assert(await b.store.load());assert.equal(S.taxTotal(b.state.taxPayments,'2026-10'),879);
 const payment=b.state.taxPayments[add.paymentId];assert(await b.store.run({...add,expected:S.fingerprint(payment),paidDate:'2026-09-30',amount:900.55}));
 assert.equal(S.taxTotal(a.state.taxPayments,'2026-10'),879);assert.equal(await a.store.run({type:'taxPayment',mode:'delete',paymentId:payment.id,expected:S.fingerprint(payment)}),false);
 assert(await a.store.load());assert.equal(S.taxTotal(a.state.taxPayments,'2026-10'),0);assert.equal(S.taxTotal(a.state.taxPayments,'2026-09'),900.55);
 assert(await a.store.run({type:'taxPayment',mode:'delete',paymentId:payment.id,expected:S.fingerprint(a.state.taxPayments[payment.id])}));assert(await b.store.load());assert.deepEqual(b.state.taxPayments,{});
 assert.deepEqual(srv.raw.finances,original.finances);assert.deepEqual(srv.raw.clients,original.clients);assert.equal(srv.writes,3);assert.equal(srv.backups.length,3);a.store.stop();b.store.stop();
});
test('actual adapter: SDK callback retry creates one payment and one revision',async()=>{
 const srv=server({retry:true}),a=await srv.device();assert(await a.store.run(add));assert.equal(srv.writes,1);assert.equal(srv.raw._fitppRevision,1);assert.equal(Object.keys(srv.raw.taxPayments).length,1);assert.equal(srv.backups.length,1);a.store.stop();
});
test('actual adapter: uncertain response after commit cannot duplicate the same operation after reload',async()=>{
 const srv=server({loseReply:true}),a=await srv.device();assert.equal(await a.store.run(add),false);assert.equal(srv.writes,1);assert(await a.store.load());assert.equal(await a.store.run(add),false);assert.equal(srv.writes,1);assert.equal(S.taxTotal(a.state.taxPayments,'2026-10'),879);a.store.stop();
});
test('actual adapter: simulated rules denying new field fail closed without changing old records',async()=>{
 const srv=server({denyTax:true}),a=await srv.device(),before=srv.raw;assert.equal(await a.store.run(add),false);assert.match(a.state.syncError,/permission-denied/);assert.equal(srv.writes,0);assert.deepEqual(srv.raw,before);assert.equal(a.state.dataReady,false);a.store.stop();
});
