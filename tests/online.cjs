const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../persistence.js');
const today='2026-10-18',date='2026-09-06';
const sub=(location,extra={})=>({location,price:location==='zarya'?4400:3800,left:8,startDate:'2026-09-01',expires:'2026-09-29',...extra});
const fresh=(subs)=>S.read({clients:[{id:'c',name:'Онлайн',locations:['online','zarya','pole'],subscriptions:subs}]});
const action={type:'attendance',clientId:'c',workoutId:'online_'+date,date,location:'online',status:'attended'};
const run=(d,a=action)=>S.reduce(d,a,today);
test('both modern and legacy subscriptions cover all three locations',()=>{
 for(const hall of ['zarya','pole'])for(const legacy of [false,true]){
  const s=sub(hall);if(legacy)delete s.location;
  assert(S.covers(s,'online',date));assert(S.covers(s,hall,date));assert(S.covers(s,hall==='pole'?'zarya':'pole',date));
  const d=run(fresh([s]));assert.equal(d.clients[0].subscriptions[0].left,7);assert.equal(d.visits[action.workoutId].c,'attended');assert.deepEqual(d.finances,{});assert.equal(S.ledger(d.clients[0]).length,0);
  const undo=run(d);assert.equal(undo.clients[0].subscriptions[0].left,8);assert.equal(undo.visits[action.workoutId].c,undefined);
 }
});
test('expiry and start boundaries use workout date, not today; empty/cancelled/frozen rejected',()=>{
 for(const hall of ['zarya','pole']){
  const s=sub(hall);assert(S.covers(s,'online',s.startDate));assert(S.covers(s,'online',s.expires));
  for(const override of [{left:0},{startDate:'2026-09-07'},{expires:'2026-09-05'},{cancelledAt:date}]){
   const d=fresh([{...s,...override}]),before=S.fingerprint(d);assert.throws(()=>run(d));assert.equal(S.fingerprint(d),before);
  }
  const frozen={...s,expires:'2026-10-01',freezes:[{version:1,start:'2026-09-05',end:'2026-09-07',returnDate:'2026-09-07',baseExpires:'2026-09-29'}]};assert(!S.covers(frozen,'online',date));assert.throws(()=>run(fresh([frozen])));
 }
 assert(!S.covers({...sub('pole'),price:123,location:undefined},'online',date));
});
test('ambiguous online charge requires explicit choice including legacy without IDs; invalid choices are atomic',()=>{
 for(const legacy of [true,false]){
  const subs=[sub('zarya'),sub('pole')];if(legacy)subs.forEach(s=>delete s.location);
  const d=fresh(subs),before=S.fingerprint(d);assert.throws(()=>run(d),/Выберите абонемент/);assert.equal(S.fingerprint(d),before);
  for(const key of ['sub:0','sub:1']){let next=run(d,{...action,subscriptionKey:key});const chosen=Number(key.at(-1));assert.deepEqual(next.clients[0].subscriptions.map(s=>s.left),chosen?[8,7]:[7,8]);assert(next.visitOps[action.workoutId].c.subscriptionId);
   next=run(next,{...action,status:'missed'});assert.deepEqual(next.clients[0].subscriptions.map(s=>s.left),chosen?[8,7]:[7,8]);next=run(next,{...action,status:'missed'});assert.deepEqual(next.clients[0].subscriptions.map(s=>s.left),[8,8]);
  }
  for(const subscriptionKey of ['sub:9','',null])assert.throws(()=>run(d,{...action,subscriptionKey}));assert.equal(S.fingerprint(d),before);
 }
});
test('expired/empty first does not mask valid second and last-session status change retains original',()=>{
 let d=fresh([sub('zarya',{left:0}),sub('pole',{left:1})]);d=run(d);assert.deepEqual(d.clients[0].subscriptions.map(s=>s.left),[0,0]);
 d=run(d,{...action,status:'missed'});assert.deepEqual(d.clients[0].subscriptions.map(s=>s.left),[0,0]);d=run(d,{...action,status:'missed'});assert.deepEqual(d.clients[0].subscriptions.map(s=>s.left),[0,1]);
});
test('sale from online journal charges only explicitly sold subscription; no repeated sale; income unchanged by visit undo',()=>{
 for(const hall of ['zarya','pole']){
  const price=hall==='zarya'?4400:3800,other=hall==='zarya'?'pole':'zarya';
  const sale={type:'subscription',clientId:'c',subscriptionType:hall,date,method:'cash',received:price,visit:action};
  let d=run(fresh([sub(other)]),sale);assert.deepEqual(d.clients[0].subscriptions.map(s=>s.left),[8,7]);assert.equal(d.finances['2026-09'],price);assert.equal(S.balance(d.clients[0]),0);assert.equal(S.ledger(d.clients[0]).length,1);assert.throws(()=>run(d,sale),/уже существует/);
  const sold=d.clients[0].subscriptions[1];assert.throws(()=>run(d,{type:'cancelSubscription',clientId:'c',subscriptionId:sold.id,expected:S.fingerprint(sold)}));
  d=run(d);assert.equal(d.clients[0].subscriptions[1].left,8);assert.equal(d.finances['2026-09'],price);const unused=d.clients[0].subscriptions[1];
  d=run(d,{type:'cancelSubscription',clientId:'c',subscriptionId:unused.id,expected:S.fingerprint(unused)});assert.equal(S.balance(d.clients[0]),price);
  d=run(d,{type:'refund',clientId:'c',date:today,method:'cash',received:price});assert.equal(d.finances['2026-09'],price);assert.equal(d.finances['2026-10'],-price);assert.equal(S.balance(d.clients[0]),0);
 }
});
test('chosen attendance store rejects double click, stale token, concurrent edit, backup failure',async()=>{
 for(const mode of ['ok','conflict','backup']){
  let raw=fresh([sub('zarya'),sub('pole')]),writes=0,state,release;const gate=new Promise(r=>release=r);
  const snap=()=>({exists:true,metadata:{fromCache:false},data:()=>structuredClone(raw)}),auth={currentUser:{uid:'test'},onAuthStateChanged(cb){cb(this.currentUser);return ()=>{}}};
  const workspace={local:false,check(){},validate(){},reference:()=>({get:async()=>snap()})},db={runTransaction:async cb=>cb({get:async()=>snap(),set(ref,next){raw=next;writes++}})};
  const store=S.create({db,auth,workspace,clock:()=>today,beforeWrite:async()=>{await gate;if(mode==='backup')throw Error('quota');if(mode==='conflict')raw._fitppRevision++;}});store.start(s=>state=s);await new Promise(r=>setImmediate(r));const token=store.token();const pending=store.run({...action,subscriptionKey:'sub:1'},token);assert.equal(await store.run({...action,subscriptionKey:'sub:1'},token),false);release();assert.equal(await pending,mode==='ok');assert.equal(writes,mode==='ok'?1:0);
  if(mode==='ok'){assert.equal(await store.run({...action,subscriptionKey:'sub:1'},token),false);assert.deepEqual(raw.clients[0].subscriptions.map(s=>s.left),[8,7]);}else assert.deepEqual(raw.clients[0].subscriptions.map(s=>s.left),[8,8]);store.stop();
 }
});
