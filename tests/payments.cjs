const {test}=require('node:test');const assert=require('node:assert/strict');
const S=require('../persistence.js'),W=require('../firebase-adapter.js'),B=require('../backup.js');
const today='2026-10-18';
const fresh=()=>S.read({clients:[{id:'c',name:'Клиент',phone:'',locations:['pole'],subscriptions:[]}]});
const run=(d,a)=>S.reduce(d,{clientId:'c',...a},today);
const sale=(d,received=4000,date='2026-09-01',method='cash')=>run(d,{type:'subscription',subscriptionType:'pole',date,method,received});
test('4000 for 3800, then 3600: receipts 7600, no repeated credit income; roundtrip',async()=>{
 let d=sale(fresh());assert.equal(S.balance(d.clients[0]),200);assert.equal(S.report(d,'2026-09').cash,4000);
 d=sale(d,3600,'2026-10-01','transfer');assert.equal(S.balance(d.clients[0]),0);assert.equal(d.finances['2026-10'],3600);
 assert.equal(S.ledger(d.clients[0])[1].used,20000);assert.deepEqual(S.read(JSON.parse(JSON.stringify(d))),d);
 const raw={...d,ownerUid:W.ownerUid,datasetId:W.datasetId,schemaVersion:1};W.validate(raw);assert.deepEqual(await B.restore(await B.create(raw,'firebase')),raw);
});
test('exactly one method, explicit received amount, no underpayment/future/invalid money',()=>{
 for(const received of [undefined,NaN,-1,3799,4000.001,Infinity])assert.throws(()=>sale(fresh(),received===undefined?NaN:received));
 for(const method of ['',null,'unknown',['cash','transfer']])assert.throws(()=>sale(fresh(),4000,'2026-09-01',method));
 assert.throws(()=>sale(fresh(),4000,'2026-10-19'));assert.throws(()=>sale(fresh(),4000,'2026-02-30'));
});
test('credit covers whole purchase; kopecks remain exact; backdated spends refused',()=>{
 let d=sale(fresh(),8000.25);d=sale(d,0,'2026-09-02');assert.equal(S.balance(d.clients[0]),400.25);assert.equal(d.finances['2026-09'],8000.25);
 assert.throws(()=>sale(d,4000,'2026-08-31'),/порядку/);
});
test('unused cancellation credits cost, explicit refund subtracts actual money in refund month',()=>{
 let d=sale(fresh());const sub=d.clients[0].subscriptions[0];d=run(d,{type:'cancelSubscription',subscriptionId:sub.id,expected:S.fingerprint(sub)});
 assert.equal(S.balance(d.clients[0]),4000);assert.equal(d.finances['2026-09'],4000);assert.equal(d.clients[0].subscriptions[0].left,0);
 const cancelled=d.clients[0].subscriptions[0];assert.throws(()=>run(d,{type:'cancelSubscription',subscriptionId:cancelled.id,expected:S.fingerprint(cancelled)}));
 d=run(d,{type:'refund',date:today,received:4000,method:'cash'});assert.equal(S.balance(d.clients[0]),0);assert.equal(d.finances['2026-10'],-4000);assert.equal(S.report(d,'2026-10').cashRefund,4000);
 assert.throws(()=>run(d,{type:'refund',date:today,received:1,method:'cash'}));
 assert.throws(()=>run(d,{type:'deleteClient',confirmName:'Клиент',confirmPhrase:'УДАЛИТЬ НАВСЕГДА'}));
});
test('single visit retains paid amount, credit, cancellation and reselling without double receipts',()=>{
 let d=fresh();const a={type:'attendance',workoutId:'pole_2026-09-01',date:'2026-09-01',location:'pole',status:'razov',method:'transfer',received:700};
 d=run(d,a);assert.equal(S.balance(d.clients[0]),100);assert.equal(d.finances['2026-09'],700);
 d=run(d,a);assert.equal(S.balance(d.clients[0]),700);assert.equal(d.finances['2026-09'],700);assert.equal(d.visits[a.workoutId].c,undefined);
 d=run(d,{...a,paymentDate:today,received:0});assert.equal(S.balance(d.clients[0]),100);assert.equal(d.finances['2026-10'],0);
});
test('used subscription cancellation and editing paid history blocked',()=>{
 let d=sale(fresh());d=run(d,{type:'attendance',workoutId:'pole_2026-09-01',date:'2026-09-01',location:'pole',status:'attended'});
 const sub=d.clients[0].subscriptions[0];assert.throws(()=>run(d,{type:'cancelSubscription',subscriptionId:sub.id,expected:S.fingerprint(sub)}));
 assert.throws(()=>run(sale(fresh()),{type:'editSubscription',subscriptionId:sub.id,expected:S.fingerprint(sub),date:'2026-09-02',price:100}));
});
test('September legacy classification preserves entire client, totals, unknown methods on load',()=>{
 let d=fresh();d.clients[0].subscriptions=[{startDate:'2026-09-01',expires:'2026-09-29',price:3800,left:3}];d.finances['2026-09']=4400;
 d.attendance['2026-09-03']={c:'razov'};d.attendanceOps['2026-09-03']={c:{status:'razov',price:600,location:'pole',operationId:'old'}};
 const before=JSON.stringify(d);const loaded=S.read(d);assert.equal(JSON.stringify(d),before);assert.equal(loaded.clients[0].money,undefined);assert.equal(S.report(d,'2026-09').unknown,4400);
 let row=S.legacyPayments(d,d.clients[0])[0];d=run(d,{type:'classifyLegacy',key:row.key,expected:row.expected,method:'cash'});
 assert.equal(d.clients[0].subscriptions[0].left,3);assert.equal(d.finances['2026-09'],4400);assert.equal(S.report(d,'2026-09').unknown,600);
 row=S.legacyPayments(d,d.clients[0])[0];d=run(d,{type:'classifyLegacy',key:row.key,expected:row.expected,method:'transfer'});
 assert.equal(S.report(d,'2026-09').transfer,600);assert.equal(S.report(d,'2026-09').cash,3800);assert.equal(S.report(d,'2026-09').unknown,0);assert.equal(S.balance(d.clients[0]),0);
 assert.throws(()=>run(d,{type:'classifyLegacy',key:row.key,expected:row.expected,method:'cash'}));
});
test('legacy zero-delta classification can precede later new purchases; missing amounts never guessed',()=>{
 let d=fresh();d.clients[0].subscriptions=[{startDate:'2026-09-01',expires:'2026-09-29',price:3800,left:0}];d.finances['2026-09']=3800;
 d=sale(d,4000,'2026-10-01');const row=S.legacyPayments(d,d.clients[0])[0];d=run(d,{type:'classifyLegacy',key:row.key,expected:row.expected,method:'transfer'});assert.equal(S.balance(d.clients[0]),200);
 d.attendance['2026-09-03']={c:'razov'};const unknown=S.legacyPayments(d,d.clients[0])[0];assert.equal(unknown.price,undefined);assert.throws(()=>run(d,{type:'classifyLegacy',key:unknown.key,expected:unknown.expected,method:'cash'}));
 assert.throws(()=>run(d,{type:'financeMonth',month:'2026-09',expected:3800,amount:0}));
});
test('corrupt ledger blocks load; invalid actions leave source snapshot unchanged',()=>{
 const d=sale(fresh()),before=JSON.stringify(d);assert.throws(()=>sale(d,1,'2026-10-01'));assert.equal(JSON.stringify(d),before);
 d.clients[0].money.entries[0].delta=-1;assert.throws(()=>S.read(d));
});
test('changing unused start date preserves receipt date and amount; legacy links classify only once',()=>{
 let d=sale(fresh()),sub=d.clients[0].subscriptions[0];
 d=run(d,{type:'editSubscription',subscriptionId:sub.id,expected:S.fingerprint(sub),date:'2026-10-01',price:3800});assert.equal(d.finances['2026-09'],4000);assert.equal(d.finances['2026-10'],undefined);assert.equal(S.ledger(d.clients[0])[0].date,'2026-09-01');
 d=fresh();d.finances['2026-09']=600;d.attendance['2026-09-01']={c:'razov'};d.attendanceOps['2026-09-01']={c:{status:'razov',location:'pole',price:600,operationId:'old'}};
 S.migrate(d);const old=S.fingerprint(d.attendanceOps),row=S.legacyPayments(d,d.clients[0])[0];d=run(d,{type:'classifyLegacy',key:row.key,expected:row.expected,method:'cash'});
 assert.equal(S.fingerprint(d.attendanceOps),old);assert.equal(S.legacyPayments(d,d.clients[0]).length,0);assert.doesNotThrow(()=>S.read(d));
});
