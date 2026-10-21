/* Durable journal: one durable, revision-checked record per operation. */
(function () {
'use strict';
const key=FitPPRuntime.namespace+':fGu8QWqBQofTRQ8SxHBonbuEVjr2:manual-history-2026-09-v1';
const recordKey=id=>key+':'+id;
let database;
function validate(j){
 if(!j)return null;
 if(j.version!==1||!['draft','pending','confirmed','conflict','resolved'].includes(j.phase)||!/^[-a-zA-Z0-9]{1,80}$/.test(j.operationId)||!j.id||!j.draft||!Number.isSafeInteger(j.expectedRevision))throw Error('Повреждён журнал операции. Сохранение заблокировано.');
 if(j.action&&(j.action.templateId!==j.id||j.action.operationId!==j.operationId||j.action.expectedRevision!==j.expectedRevision))throw Error('Несогласованный журнал операции.');
 return j;
}
function db(){
 if(!database)database=new Promise((resolve,reject)=>{
  const r=indexedDB.open(FitPPRuntime.namespace+'-operations-v1',2);
  r.onupgradeneeded=()=>{
   const d=r.result,records=d.createObjectStore('operationRecords');
   // Migrate the old singleton without deleting the original or changing its IDs.
   if(d.objectStoreNames.contains('operations')){
    const old=r.transaction.objectStore('operations').get(key);
    old.onsuccess=()=>{if(old.result){try{const j=validate(old.result);records.add({...j,scope:key,_journalRevision:1,createdAt:j.createdAt||Date.now()},recordKey(j.operationId));}catch{r.transaction.abort();}}};
   }
  };
  r.onsuccess=()=>{const d=r.result;d.onversionchange=()=>d.close();resolve(d);};
  r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Закройте старые окна для обновления журнала. Черновики не удалены.'));
 });return database;
}
async function read(id){if(!id)return (await list()).find(j=>!['confirmed','resolved'].includes(j.phase))||(await list()).at(-1)||null;const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('operationRecords','readonly'),r=tx.objectStore('operationRecords').get(recordKey(id));let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>{try{resolve(validate(result))}catch(e){reject(e)}};tx.onabort=()=>reject(tx.error||Error('Ошибка чтения журнала'));});}
async function list(){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('operationRecords','readonly'),r=tx.objectStore('operationRecords').getAll();let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>{try{resolve(result.filter(j=>j.scope===key).map(validate).sort((a,b)=>a.createdAt-b.createdAt||a.operationId.localeCompare(b.operationId)))}catch(e){reject(e)}};tx.onabort=()=>reject(tx.error||Error('Ошибка чтения журнала'));});}
async function write(j){
 validate(j);const snapshot=structuredClone(j),d=await db();
 return new Promise((resolve,reject)=>{
  let tx,error,next;try{tx=d.transaction('operationRecords','readwrite',{durability:'strict'});}catch(e){reject(e);return;}
  const store=tx.objectStore('operationRecords'),r=store.get(recordKey(j.operationId));
  function conflict(message){error=Object.assign(Error(message),{code:'journal-conflict'});tx.abort();}
  r.onsuccess=()=>{
   const old=r.result;
   if((old?._journalRevision||0)!==(snapshot._journalRevision||0))return conflict('Эта операция изменена в другом окне. Восстановлена актуальная запись.');
   if(old&&(old.id!==snapshot.id||(old.expectedRevision!==snapshot.expectedRevision&&!(old.phase==='draft'&&!old.action&&snapshot.phase==='draft'))))return conflict('Нельзя заменить идентичность операции.');
   if(old?.action&&JSON.stringify(old.action)!==JSON.stringify(snapshot.action))return conflict('Нельзя изменить уже отправленную операцию.');
   if(old&&old.phase!=='draft'&&snapshot.phase==='draft')return conflict('Отправленную операцию нельзя вернуть в новый черновик.');
   if(old?.phase==='resolved')return conflict('Конфликт уже завершён. Откройте связанный черновик.');
   if(old?.phase==='confirmed'&&snapshot.phase!=='confirmed')return conflict('Подтверждённую операцию нельзя отправить заново как новую.');
   next={...snapshot,scope:key,createdAt:old?.createdAt||snapshot.createdAt||Date.now(),_journalRevision:(old?._journalRevision||0)+1};
   store.put(next,recordKey(j.operationId));const check=store.get(recordKey(j.operationId));check.onsuccess=()=>{if(JSON.stringify(check.result)!==JSON.stringify(next))tx.abort();};
  };
  tx.oncomplete=()=>resolve(next);tx.onabort=()=>reject(error||tx.error||Error('Журнал не сохранён. Отправка заблокирована.'));
 });
}
// Resolve and retain the old immutable operation plus its editable successor atomically.
async function resolveConflict(previous,draft,kind){
 validate(draft);if(!['server','draft'].includes(kind)||draft.id!==previous.id||draft.operationId===previous.operationId||draft.phase!=='draft'||draft.action)throw Error('Некорректное разрешение конфликта.');
 const d=await db();return new Promise((resolve,reject)=>{
  const tx=d.transaction('operationRecords','readwrite',{durability:'strict'}),store=tx.objectStore('operationRecords'),r=store.get(recordKey(previous.operationId));let result,error;
  function abort(text){error=Object.assign(Error(text),{code:'journal-conflict'});tx.abort();}
  r.onsuccess=()=>{const old=r.result;
   if(old?.phase==='resolved'){
    const next=store.get(recordKey(old.resolution.successorOperationId));next.onsuccess=()=>{if(!next.result)return abort('Связанный черновик отсутствует.');result={previous:old,draft:validate(next.result),existing:true};};return;
   }
   if(!old||old.phase!=='conflict'||old._journalRevision!==previous._journalRevision)return abort('Конфликт изменён в другом окне. Обновите его.');
   const check=store.get(recordKey(draft.operationId));check.onsuccess=()=>{if(check.result)return abort('ID нового черновика уже используется.');
    const successor={...structuredClone(draft),scope:key,createdAt:Date.now(),_journalRevision:1,sourceOperationId:old.operationId};
    const done={...old,phase:'resolved',needsReview:false,resolution:{kind,successorOperationId:successor.operationId},_journalRevision:old._journalRevision+1};
    store.add(successor,recordKey(successor.operationId));store.put(done,recordKey(old.operationId));result={previous:done,draft:successor,existing:false};
   };
  };
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||Error('Не удалось сохранить разрешение конфликта.'));
 });
}
window.FitPPRecovery={key,read,list,write,resolveConflict};
})();
