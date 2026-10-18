const {test}=require('node:test');
const assert=require('node:assert/strict');
const Store=require('../persistence.js'),W=require('../firebase-adapter.js'),Cloud=require('../cloud.js');
const action={type:'client',newId:'test',form:{name:'Test',phone:'',locations:['zarya']}};
async function fixture(beforeWrite){
 let raw={...Store.read(),ownerUid:W.ownerUid,datasetId:W.datasetId,schemaVersion:1},state,writes=0;
 const auth={currentUser:{uid:W.ownerUid},onAuthStateChanged(cb){cb(this.currentUser);return ()=>{};}};
 const snap=()=>({exists:true,metadata:{fromCache:false},data:()=>structuredClone(raw)});
 const db={runTransaction:async cb=>cb({get:async()=>snap(),set:(ref,next)=>{raw=next;writes++;}})};
 const workspace={local:false,check(){},validate:W.validate,reference:()=>({get:async()=>snap()})};
 const store=Store.create({db,auth,workspace,beforeWrite});store.start(s=>state=s);
 await new Promise(r=>setImmediate(r));
 return {store,get state(){return state},get raw(){return raw},get writes(){return writes},bump(){raw._fitppRevision++},auth};
}
test('backup must finish before each write; consecutive clients require no renewed consent',async()=>{
 const copies=[];const f=await fixture(async d=>copies.push(structuredClone(d)));
 assert(await f.store.run(action));assert(await f.store.run({...action,newId:'test2'}));
 assert.equal(f.writes,2);assert.deepEqual(copies.map(d=>d._fitppRevision),[0,1]);assert.equal(f.raw._fitppRevision,2);
});
test('backup failure blocks write',async()=>{const f=await fixture(async()=>{throw Error('quota');});assert.equal(await f.store.run(action),false);assert.equal(f.writes,0);assert.equal(f.state.dataReady,false);});
test('missing backup guard blocks production write',async()=>{const f=await fixture();assert.equal(await f.store.run(action),false);assert.equal(f.writes,0);});
test('stale server data blocks before backup',async()=>{let backups=0;const f=await fixture(async()=>backups++);f.bump();assert.equal(await f.store.run(action),false);assert.equal(backups,0);assert.equal(f.writes,0);});
test('change during backup is rejected inside transaction',async()=>{const f=await fixture(async()=>f.bump());assert.equal(await f.store.run(action),false);assert.equal(f.writes,0);});
test('account change during backup blocks write',async()=>{const f=await fixture(async()=>{f.auth.currentUser=null});assert.equal(await f.store.run(action),false);assert.equal(f.writes,0);});
test('LOCAL is selected; auth observation and sign-in await persistence; reload does not sign out',async()=>{
 let release,observed=false,signouts=0,persistence,signin=false;
 const rawAuth={currentUser:{uid:W.ownerUid},setPersistence(value){persistence=value;return new Promise(r=>release=r)},onAuthStateChanged(cb){observed=true;cb(this.currentUser);return ()=>{}},async signOut(){signouts++},async signInWithEmailAndPassword(){signin=true;return {user:this.currentUser}}};
 const firebase={auth:{Auth:{Persistence:{LOCAL:'local'}}},initializeApp:()=>({options:{projectId:W.projectId},auth:()=>rawAuth,firestore:()=>({})})};
 const cloud=Cloud.start(firebase,W);let user;cloud.auth.onAuthStateChanged(u=>user=u);const login=cloud.auth.signInWithEmailAndPassword('test','test');
 assert.equal(persistence,'local');assert(!observed);assert(!signin);release();await login;assert.equal(user.uid,W.ownerUid);assert.equal(signouts,0);
});
