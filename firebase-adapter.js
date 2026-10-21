/* Prepared adapter. This file imports no SDK and starts no network connection. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FitPPWorkspace=api;})(globalThis,function(){
'use strict';
const projectId='fitpp-165a2',ownerUid='fGu8QWqBQofTRQ8SxHBonbuEVjr2',datasetId='manual-history-2026-09-v1',schemaVersion=1;
const path=`trainerWorkspaces/${ownerUid}/datasets/${datasetId}`;
const fields=['clients','attendance','finances','rentMonths','attendanceOps','workouts','visits','visitOps','legacyLinks','legacySources','_fitppRevision','ownerUid','schemaVersion','datasetId'];
function validate(raw){
 if(!raw || raw.ownerUid!==ownerUid || raw.datasetId!==datasetId || raw.schemaVersion!==schemaVersion || !Number.isSafeInteger(raw._fitppRevision)||raw._fitppRevision<0 || Object.keys(raw).some(k=>!fields.includes(k) && k!=='taxPayments' && k!=='pricingSettings'))throw Error('Несовместимая схема или dataset. Запись заблокирована.');
 for(const k of fields)if(!Object.hasOwn(raw,k))throw Error('Неполная схема. Запись заблокирована.');
 if(Object.hasOwn(raw,'taxPayments') && (!raw.taxPayments || Array.isArray(raw.taxPayments) || typeof raw.taxPayments!=='object'))throw Error('Некорректная история НПД');
 if(!Array.isArray(raw.clients))throw Error('Некорректные клиенты');
 for(const k of fields.slice(1,10))if(!raw[k]||Array.isArray(raw[k])||typeof raw[k]!=='object')throw Error('Некорректная структура');
 const reader=typeof module==='object'&&module.exports ? require('./persistence.js') : globalThis.FitPPStore;
 if(!reader?.validateCompatibleData)throw Error('Совместимый валидатор не загружен. Запись заблокирована.');
 reader.validateCompatibleData(raw);
 return raw;
}
function financialHooks(raw,auth,check){
 const capture=()=>{check();const user=auth.currentUser,epoch=auth.sessionGeneration;return ()=>{check();if(auth.currentUser!==user||auth.sessionGeneration!==epoch)throw Error('Сессия изменилась');};};
 async function prepareWrite(snapshot,action){
  const guard=capture();
  guard();const client=snapshot.clients.find(c=>c.id===action.clientId);
  const existing=snapshot.visitOps[action.workoutId]?.[action.clientId];
  if((existing?.subscriptionId || existing?.status==='razov') && !existing.workoutId){const witness=raw.doc(`trainerWorkspaces/${ownerUid}/visitWitnesses/${existing.operationId}`);await raw.runTransaction(async tx=>{guard();const snap=await tx.get(witness);guard();if(!snap.exists)tx.set(witness,{workoutId:action.workoutId,clientId:action.clientId,operation:existing})});}
  if(!['subscription','refund','cancelSubscription'].includes(action.type) && action.status!=='razov')return {};
  const entries=client?.money?.entries||[];if(!entries.length)return {};
  async function node(entries,sum,left,right){
   const ids=entries.map(e=>e.id),cancelled=entries.filter(e=>e.kind==='cancel').map(e=>e.ref),data=left?{kind:'join',entries,sum,ids,cancelled,left,right}:{kind:entries.length?'leaf':'empty',entries,sum,ids,cancelled};
   const bytes=new TextEncoder().encode(JSON.stringify(data));
   const digest=await crypto.subtle.digest('SHA-256',bytes);
   const id=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
   const ref=raw.doc(`trainerWorkspaces/${ownerUid}/balanceProofs/${id}`);
   await raw.runTransaction(async tx=>{guard();const snap=await tx.get(ref);guard();if(!snap.exists)tx.set(ref,data)});
   return {id,entries,sum};
  }
  async function tree(rows){if(rows.length<=1)return node(rows,rows[0]?.delta||0);const mid=Math.floor(rows.length/2),l=await tree(rows.slice(0,mid)),r=await tree(rows.slice(mid));return node(rows,l.sum+r.sum,l.id,r.id)}
  const proof=await tree(entries);guard();return {balanceProofId:proof.id};
 }
 async function authorizeWrite(before,after,action){
  const guard=capture();
  guard();const index=before.clients.findIndex(c=>c.id===action.clientId);if(index<0)return;
  const old=before.clients[index].money?.entries||[],next=after.clients[index].money?.entries||[];
  if(next.length!==old.length+1 || !['sale','cancel','refund'].includes(next.at(-1).kind))return;
  const receipt={revision:before._fitppRevision,clientIndex:index,clientId:action.clientId,money:after.clients[index].money,finances:after.finances};
  if(next.at(-1).kind==='cancel')receipt.sourceIndex=old.findIndex(e=>e.id===next.at(-1).ref);
  const ref=raw.doc(`trainerWorkspaces/${ownerUid}/paymentReceipts/${next.at(-1).id}`);
  await raw.runTransaction(async tx=>{guard();const s=await tx.get(ref);guard();if(!s.exists)tx.set(ref,receipt)});guard();
 }
 return Object.freeze({prepareWrite,authorizeWrite});
}
// Explicit activation only. No automatic invocation and no dataset/price writes.
function catalogPolicy(raw,auth,check){
 const policyPath=`trainerWorkspaces/${ownerUid}/salesPolicy/current`;
 const result=status=>Object.freeze({status,message:status==='activated'?'Каталог включён':'Каталог уже включён'});
 function mode(snap){
  if(!snap.exists || snap.metadata?.fromCache!==false || snap.metadata?.hasPendingWrites!==false)throw Error('Нет подтверждённого серверного состояния каталога.');
  const data=snap.data();
  if(data.version!==1 || !['legacy','catalog'].includes(data.mode) || Object.keys(data).length!==2)throw Error('Неизвестный режим каталога. Активация не выполнена.');
  return data.mode;
 }
 async function activateCatalog(){
  if(globalThis.FitPPRuntime?.catalogActivationEnabled!==true)throw Error('Активация каталога выключена в этой сборке.');
  check();const user=auth.currentUser,epoch=auth.sessionGeneration;
  const guard=()=>{check();if(auth.currentUser!==user || auth.sessionGeneration!==epoch)throw Error('Сессия изменилась');};
  const ref=raw.doc(policyPath);
  const confirmed=async()=>{guard();const snap=await ref.get({source:'server'});guard();return mode(snap);};
  if(await confirmed()==='catalog')return result('already-active');
  try{
   const status=await raw.runTransaction(async tx=>{
    guard();const snap=await tx.get(ref);guard();
    if(mode(snap)==='catalog')return 'already-active';
    tx.set(ref,{version:1,mode:'catalog'});return 'activated';
   });
   guard();return result(status);
  }catch(error){
   if(error.code==='permission-denied' || error.code==='firestore/permission-denied'){
    // Exactly one server reconciliation; never retry a denied write.
    try{if(await confirmed()==='catalog')return result('already-active');}catch(_){}
   }
   throw error;
  }
 }
 async function readSalesMode(){
  check();const user=auth.currentUser,epoch=auth.sessionGeneration;
  const snap=await raw.doc(policyPath).get({source:'server'});
  check();if(auth.currentUser!==user || auth.sessionGeneration!==epoch)throw Error('Сессия изменилась');
  return mode(snap);
 }
 async function requireCatalog(){
  if(await readSalesMode()!=='catalog')throw Object.assign(Error('Продажи по шаблонам ещё не включены. Обновите режим после подтверждения каталога.'),{code:'catalog-inactive'});
 }
 return Object.freeze({activateCatalog,requireCatalog,readSalesMode});
}
function bind(app,{local=false}={}){
 if(app.options?.projectId!==projectId)throw Error('Недопустимый Firebase project ID');
 const db=app.firestore(),auth=app.auth();
 const check=()=>{if(app.options?.projectId!==projectId || auth.currentUser?.uid!==ownerUid)throw Error('Недопустимый проект или аккаунт');};
 return Object.freeze({local,production:true,projectId,catalogEnabled:globalThis.FitPPRuntime?.catalogEnabled===true,auth,db,path,check,validate,
 reference(){check();return db.doc(path);},
 ...financialHooks(app.financialFirestore?app.financialFirestore():db,auth,check),
 ...catalogPolicy(app.financialFirestore?app.financialFirestore():db,auth,check),

 });
}
return Object.freeze({projectId,ownerUid,datasetId,schemaVersion,path,validate,bind});
});
