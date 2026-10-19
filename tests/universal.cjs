const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../persistence.js');
const date='2026-09-07',today='2026-10-19',locations=['zarya','pole','online'];
const sub=(plan,legacy=false)=>({...(legacy?{}:{id:'plan-'+plan,location:plan}),price:plan==='zarya'?4400:3800,left:8,startDate:'2026-09-01',expires:'2026-10-15'});
const fresh=subscriptions=>S.read({clients:[{id:'c',name:'Тест Универсальный',locations,subscriptions}],workouts:Object.fromEntries(locations.map(location=>{const id=location+'_extra_universal';return [id,{id,location,originDate:date,date,time:'12:00',extra:true,cancelled:false}]}))});
const action=(location,status='attended')=>({type:'attendance',clientId:'c',workoutId:location+'_extra_universal',date,location,status});
const run=(d,a)=>S.reduce(d,a,today);
test('both plans, modern and legacy: all locations debit exactly one; read never rewrites old subscriptions or expiry',()=>{
 for(const plan of ['zarya','pole'])for(const legacy of [false,true]){
  const original=sub(plan,legacy),d=fresh([original]);assert.deepEqual(d.clients[0].subscriptions,[original]);
  for(const location of locations){const next=run(d,action(location));assert.equal(next.clients[0].subscriptions[0].left,7);assert.equal(next.clients[0].subscriptions[0].expires,original.expires);assert.deepEqual(next.finances,d.finances);assert.deepEqual(S.ledger(next.clients[0]),[]);assert.equal(d.clients[0].subscriptions[0].left,8);}
 }
});
test('location switching, status change and undo restore the original subscription without extra debits or income',()=>{
 let d=fresh([sub('pole')]);for(const location of locations)d=run(d,action(location));assert.equal(d.clients[0].subscriptions[0].left,5);
 d=run(d,action('zarya','missed'));assert.equal(d.clients[0].subscriptions[0].left,5);
 d=run(d,action('zarya','missed'));assert.equal(d.clients[0].subscriptions[0].left,6);
 d=run(d,action('pole'));assert.equal(d.clients[0].subscriptions[0].left,7);
 d=run(d,action('online'));assert.equal(d.clients[0].subscriptions[0].left,8);assert.deepEqual(d.finances,{});
});
test('every location requires explicit selection when ambiguous; stale and invalid selection is atomic',()=>{
 for(const location of locations)for(const legacy of [false,true]){
  const d=fresh([sub('zarya',legacy),sub('pole',legacy)]),before=S.fingerprint(d);
  assert.throws(()=>run(d,action(location)),/Выберите абонемент/);
  assert.throws(()=>run(d,{...action(location),subscriptionKey:'sub:99'}));assert.equal(S.fingerprint(d),before);
  let next=run(d,{...action(location),subscriptionKey:'sub:1'});assert.deepEqual(next.clients[0].subscriptions.map(s=>s.left),[8,7]);
  next=run(next,action(location,'missed'));assert.deepEqual(next.clients[0].subscriptions.map(s=>s.left),[8,7]);
 }
});
test('new plans have 8 sessions and 28 days across month/year boundaries; old expiry remains untouched',()=>{
 for(const plan of ['zarya','pole'])for(const start of ['2026-09-01','2026-12-20','2028-02-01']){
  const old=sub('pole'),d=fresh([old]),price=plan==='zarya'?4400:3800;
  const next=run(d,{type:'subscription',clientId:'c',subscriptionType:plan,date:start,method:'cash',received:price,paymentDate:date});
  assert.deepEqual(next.clients[0].subscriptions[0],old);const sold=next.clients[0].subscriptions[1];assert.equal(sold.left,8);assert.equal(sold.price,price);assert.equal(sold.expires,S.addDays(start,28));
 }
});
test('universal choice in every location rejects double click, stale token, concurrent edit and backup failure',async()=>{
 for(const location of locations)for(const mode of ['ok','conflict','backup']){
  const action={type:'attendance',clientId:'c',workoutId:location+'_extra_universal',date,location,status:'attended'};
  let raw=fresh([sub('zarya',true),sub('pole',true)]),writes=0,state,release;const gate=new Promise(r=>release=r);
  const snap=()=>({exists:true,metadata:{fromCache:false},data:()=>structuredClone(raw)}),auth={currentUser:{uid:'test'},onAuthStateChanged(cb){cb(this.currentUser);return ()=>{}}};
  const workspace={local:false,check(){},validate(){},reference:()=>({get:async()=>snap()})},db={runTransaction:async cb=>cb({get:async()=>snap(),set(ref,next){raw=next;writes++}})};
  const store=S.create({db,auth,workspace,clock:()=>today,beforeWrite:async()=>{await gate;if(mode==='backup')throw Error('quota');if(mode==='conflict')raw._fitppRevision++;}});store.start(s=>state=s);await new Promise(r=>setImmediate(r));const token=store.token();const pending=store.run({...action,subscriptionKey:'sub:1'},token);assert.equal(await store.run({...action,subscriptionKey:'sub:1'},token),false);release();assert.equal(await pending,mode==='ok');assert.equal(writes,mode==='ok'?1:0);
  if(mode==='ok'){assert.equal(await store.run({...action,subscriptionKey:'sub:1'},token),false);assert.deepEqual(raw.clients[0].subscriptions.map(s=>s.left),[8,7]);}else assert.deepEqual(raw.clients[0].subscriptions.map(s=>s.left),[8,8]);store.stop();
 }
});
