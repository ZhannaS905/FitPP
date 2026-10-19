const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../persistence.js'),W=require('../firebase-adapter.js'),B=require('../backup.js');
const today='2026-10-19',fresh=()=>S.read({clients:[{id:'test',name:'Тест',subscriptions:[]}],finances:{'2026-09':10000,'2026-10':20000}});
const add={type:'taxPayment',mode:'save',paymentId:'tax-example',expected:S.fingerprint(null),amount:879,paidDate:'2026-10-14',period:'2026-09'};
const run=(d,a=add)=>S.reduce(d,a,today);
test('old data has no new field; tax belongs only to actual payment month, preserving all old maps and client money',()=>{
 const old=fresh();assert(!Object.hasOwn(old,'taxPayments'));const d=run(old);assert.equal(S.taxTotal(d.taxPayments,'2026-09'),0);assert.equal(S.taxTotal(d.taxPayments,'2026-10'),879);assert.equal(S.taxTotal(undefined,'2026-10'),0);
 const {taxPayments,...rest}=d;assert.deepEqual(rest,old);assert.deepEqual(S.report(d,'2026-10'),S.report(old,'2026-10'));assert.equal(taxPayments['tax-example'].amount,87900);assert(!Object.hasOwn(old,'taxPayments'));
});
test('edit changes actual payment month, including kopecks; delete restores totals; stale changes and repeat create refused',()=>{
 const d=run(fresh()),payment=d.taxPayments['tax-example'];assert.throws(()=>run(d));const edit={...add,expected:S.fingerprint(payment),paidDate:'2026-09-30',amount:879.55};const next=run(d,edit);
 assert.equal(S.taxTotal(next.taxPayments,'2026-10'),0);assert.equal(S.taxTotal(next.taxPayments,'2026-09'),879.55);assert.throws(()=>run(next,edit));
 assert.throws(()=>run(next,{type:'taxPayment',mode:'delete',paymentId:payment.id,expected:S.fingerprint(payment)}));
 const removed=run(next,{type:'taxPayment',mode:'delete',paymentId:payment.id,expected:S.fingerprint(next.taxPayments[payment.id])});assert.equal(S.taxTotal(removed.taxPayments,'2026-09'),0);assert.deepEqual(removed.finances,d.finances);
});
test('invalid dates, future payments, invalid periods, zero/negative/fractional/nonfinite amounts and malformed history are rejected atomically',()=>{
 const d=fresh(),before=S.fingerprint(d);
 for(const patch of [{amount:0},{amount:-1},{amount:1.001},{amount:Infinity},{amount:NaN},{paidDate:'2026-02-30'},{paidDate:'2026-10-20'},{period:'2026-13'},{paymentId:'constructor'},{mode:'bad'}])assert.throws(()=>run(d,{...add,...patch}));
 assert.equal(S.fingerprint(d),before);for(const taxPayments of [null,[],{'tax-bad':{id:'tax-bad',amount:87900,paidDate:'2026-10-14',period:'2026-09'}}])assert.throws(()=>S.read({...d,taxPayments}));
});
test('optional NPD data survives existing backup/restore, while old datasets stay compatible',async()=>{
 for(const data of [fresh(),run(fresh())]){const raw={...data,ownerUid:W.ownerUid,datasetId:W.datasetId,schemaVersion:1};W.validate(raw);assert.deepEqual(await B.restore(await B.create(raw,'local-simulation')),raw);}
});
test('transactions block double click, stale token, conflict and backup failure; one write only and no writes on read',async()=>{
 for(const mode of ['ok','conflict','backup']){
 let raw=fresh(),writes=0,release;const gate=new Promise(r=>release=r),snap=()=>({exists:true,metadata:{fromCache:false},data:()=>structuredClone(raw)}),auth={currentUser:{uid:'test'},onAuthStateChanged(cb){cb(this.currentUser);return()=>{}}};
 const workspace={local:false,check(){},validate(){},reference:()=>({get:async()=>snap()})},db={runTransaction:async cb=>cb({get:async()=>snap(),set(ref,next){raw=next;writes++}})};
 const store=S.create({db,auth,workspace,clock:()=>today,beforeWrite:async()=>{await gate;if(mode==='backup')throw Error('quota');if(mode==='conflict')raw._fitppRevision++;}});store.start(()=>{});await new Promise(r=>setImmediate(r));assert.equal(writes,0);
 const token=store.token(),pending=store.run(add,token);assert.equal(await store.run(add,token),false);release();assert.equal(await pending,mode==='ok');assert.equal(writes,mode==='ok'?1:0);if(mode==='ok'){assert.equal(await store.run(add,token),false);assert.equal(Object.keys(raw.taxPayments).length,1);assert.equal(S.taxTotal(raw.taxPayments,'2026-10'),879);}store.stop();
 }
});
test('client sale/cancellation preserve NPD history; NPD never changes receipts or cash/transfer reports',()=>{
 let d=run(fresh());const taxes=structuredClone(d.taxPayments),oldTax=S.taxTotal(taxes,'2026-10');
 d=S.reduce(d,{type:'subscription',clientId:'test',subscriptionType:'pole',date:today,method:'cash',received:4000},today);
 assert.deepEqual(d.taxPayments,taxes);assert.equal(d.finances['2026-10'],24000);assert.equal(S.balance(d.clients[0]),200);
 const sub=d.clients[0].subscriptions[0];d=S.reduce(d,{type:'cancelSubscription',clientId:'test',subscriptionId:sub.id,expected:S.fingerprint(sub)},today);assert.deepEqual(d.taxPayments,taxes);assert.equal(S.taxTotal(d.taxPayments,'2026-10'),oldTax);assert.equal(d.finances['2026-10'],24000);
});
test('tax history is discarded on logout, session reset and reload of an old-format document',async()=>{
 let raw=run(fresh()),state,authChanged,writes=0;
 const auth={currentUser:{uid:'test'},onAuthStateChanged(cb){authChanged=cb;cb(this.currentUser);return()=>{}},async signOut(){this.currentUser=null;authChanged(null)}};
 const workspace={local:true,check(){},validate(){},reference:()=>({get:async()=>({exists:true,metadata:{fromCache:false},data:()=>structuredClone(raw)})})};
 const store=S.create({auth,workspace,db:{async runTransaction(){writes++;throw Error('No writes permitted')}}});store.start(s=>state=s);await new Promise(r=>setImmediate(r));assert.equal(S.taxTotal(state.taxPayments,'2026-10'),879);
 await store.logout();assert.equal(state.dataReady,false);assert.equal(Object.hasOwn(state,'taxPayments'),false);
 raw=fresh();auth.currentUser={uid:'test'};authChanged(auth.currentUser);await new Promise(r=>setImmediate(r));assert.equal(state.dataReady,true);assert.equal(Object.hasOwn(state,'taxPayments'),false);assert.equal(S.taxTotal(state.taxPayments,'2026-10'),0);
 raw=run(fresh());assert(await store.load());assert.equal(S.taxTotal(state.taxPayments,'2026-10'),879);raw=fresh();assert(await store.load());assert.equal(Object.hasOwn(state,'taxPayments'),false);assert.equal(writes,0);store.stop();
});
