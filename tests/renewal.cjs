const {test}=require('node:test');const assert=require('node:assert/strict');const S=require('../persistence.js');
const fresh=()=>S.read({clients:[{id:'c',name:'Тест',locations:['zarya','pole'],subscriptions:[]}]});
const visit={workoutId:'pole_2026-09-01',date:'2026-09-01',location:'pole'};
const action={type:'subscription',clientId:'c',subscriptionType:'pole',date:visit.date,method:'cash',received:4000,visit};
const run=(d,a=action)=>S.reduce(d,a,'2026-10-18');
test('September purchase and attendance are atomic; only new matching subscription charged; receipts and credit correct',()=>{
 const d=fresh();d.clients[0].subscriptions=[{id:'empty',price:3800,left:0,expires:'2026-10-01'},{id:'expired',price:3800,left:8,expires:'2026-08-31'},{id:'other',price:4400,left:8,expires:'2026-10-01'}];
 const next=run(d);assert.equal(next.visits[visit.workoutId].c,'attended');assert.deepEqual(next.clients[0].subscriptions.map(s=>s.left),[0,8,8,7]);assert.equal(S.balance(next.clients[0]),200);assert.equal(S.report(next,'2026-09').cash,4000);assert.equal(S.ledger(next.clients[0]).length,1);assert.equal(next.clients[0].subscriptions.at(-1).startDate,visit.date);
 assert.throws(()=>run(next),/уже существует/);assert.equal(S.ledger(next.clients[0]).length,1);assert.equal(d.clients[0].subscriptions.length,3);
});
test('other hall or invalid coverage date saves purchase without attendance',()=>{
 for(const overrides of [{subscriptionType:'zarya',received:4400},{date:'2026-09-02'},{date:'2026-08-01'}]){
 const d=run(fresh(),{...action,...overrides});assert.equal(d.visits[visit.workoutId]?.c,undefined);assert.equal(d.clients[0].subscriptions[0].left,8);assert.equal(S.ledger(d.clients[0]).length,1);
 }
});
test('invalid payment or moved workout cannot partially save purchase or visit',()=>{
 const d=fresh();for(const overrides of [{received:1},{method:''},{visit:{...visit,date:'2026-09-03'}}])assert.throws(()=>run(d,{...action,...overrides}));
 assert.deepEqual(d,fresh());
});
test('legacy subscription hall inferred from price; exhausted, expired, future, cancelled do not cover',()=>{
 const s={price:3800,left:8,startDate:'2026-09-01',expires:'2026-09-29'};
 assert(S.covers(s,'pole',visit.date));assert(!S.covers(s,'zarya',visit.date));
 for(const override of [{left:0},{expires:'2026-08-31'},{startDate:'2026-09-02'},{cancelledAt:'2026-09-01'}])assert(!S.covers({...s,...override},'pole',visit.date));
});
test('combined operation rejects duplicate clicks, stale tokens, concurrent revision and failed backup',async()=>{
 for(const mode of ['success','conflict','backup']) {
 let raw=fresh(),state,writes=0,release;const gate=new Promise(r=>release=r);
 const snap=()=>({exists:true,metadata:{fromCache:false},data:()=>structuredClone(raw)});
 const auth={currentUser:{uid:'test'},onAuthStateChanged(cb){cb(this.currentUser);return ()=>{}}};
 const workspace={local:false,check(){},validate(){},reference:()=>({get:async()=>snap()})};
 const db={async runTransaction(cb){return cb({get:async()=>snap(),set(ref,next){raw=next;writes++}})}};
 const store=S.create({db,auth,workspace,clock:()=> '2026-10-18',beforeWrite:async()=>{await gate;if(mode==='backup')throw Error('backup failed');if(mode==='conflict')raw._fitppRevision++;}});
 store.start(s=>state=s);await new Promise(r=>setImmediate(r));const token=store.token();const pending=store.run(action,token);
 assert.equal(await store.run(action,token),false);release();assert.equal(await pending,mode==='success');
 assert.equal(writes,mode==='success'?1:0);
 if(mode==='success'){assert.equal(await store.run(action,token),false);assert.equal(raw.clients[0].subscriptions.length,1);assert.equal(raw.clients[0].subscriptions[0].left,7);assert.equal(raw._fitppRevision,1);}
 else {assert.equal(raw.clients[0].subscriptions.length,0);assert.equal(raw.visits[visit.workoutId]?.c,undefined);}
 store.stop();
 }
});
