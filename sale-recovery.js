/* Durable sale journal: one strict IndexedDB transaction before any server write. */
(()=>{
'use strict';
const namespace=FitPPRuntime.namespace,prefix=namespace+'-sale:';
let database,migration;
function db(){
 if(!database)database=new Promise((resolve,reject)=>{
  const r=indexedDB.open(namespace+'-sales-v1',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('operations',{keyPath:'operationId'});
  r.onsuccess=()=>{const d=r.result;d.onversionchange=()=>d.close();resolve(d)};
  r.onerror=()=>reject(r.error||Error('Журнал продаж недоступен. Отправка заблокирована.'));
  r.onblocked=()=>reject(Error('Закройте старые окна FitPP. Журнал продаж недоступен.'));
 });return database;
}
async function transaction(mode,operation){const d=await db();return new Promise((resolve,reject)=>{
 let tx,value,error;
 try{tx=mode==='readwrite'?d.transaction('operations',mode,{durability:'strict'}):d.transaction('operations',mode)}catch(e){reject(e);return}
 const fail=e=>{error=e;tx.abort()};
 try{operation(tx.objectStore('operations'),v=>value=v,fail)}catch(e){fail(e)}
 tx.oncomplete=()=>resolve(value);
 tx.onabort=tx.onerror=()=>reject(error||tx.error||Error('Журнал продажи не сохранён. Отправка заблокирована.'));
})}
function valid(d){if(!d?.operationId||!d.clientId||!['draft','pending','confirmed','closed'].includes(d.phase))throw Error('Повреждён журнал продажи. Отправка заблокирована.');return d}
function migrate(){
 if(!migration)migration=(async()=>{
  // Copy only this environment. Remove the legacy entry only after durable commit.
  for(const key of Object.keys(localStorage).filter(k=>k.startsWith(prefix))){
   const serialized=localStorage.getItem(key),draft=valid(JSON.parse(serialized));
   await transaction('readwrite',(store,done)=>{const r=store.get(draft.operationId);r.onsuccess=()=>{if(!r.result)store.add(draft);done()}});
   if(localStorage.getItem(key)===serialized)localStorage.removeItem(key);
  }
 })();return migration;
}
async function read(id){await migrate();return transaction('readonly',(store,done)=>{const r=store.get(id);r.onsuccess=()=>done(r.result||null)})}
async function save(d){valid(d);const draft=JSON.parse(JSON.stringify(d));await migrate();return transaction('readwrite',(store,done,fail)=>{
 const r=store.get(draft.operationId);r.onsuccess=()=>{
  const prior=r.result;if(prior&&prior.clientId!==draft.clientId)return fail(Error('Нельзя заменить клиента операции.'));
  if(prior?.phase==='confirmed'){done(prior);return}
  const next={...prior,...draft};if(prior?.phase==='pending'&&draft.phase==='draft'){done(prior);return}
  store.put(next);done(next);
 };
})}
async function confirm(id){await migrate();return transaction('readwrite',(store,done,fail)=>{const r=store.get(id);r.onsuccess=()=>{if(!r.result)return fail(Error('Исходная операция продажи отсутствует.'));const next={...r.result,phase:'confirmed'};store.put(next);done(next)}})}
async function unfinished(){await migrate();return transaction('readonly',(store,done)=>{const r=store.getAll();r.onsuccess=()=>done(r.result.find(d=>!['confirmed','closed'].includes(d.phase))||null)})}
async function close(id){await migrate();return transaction('readwrite',(store,done)=>{const r=store.get(id);r.onsuccess=()=>{if(r.result?.phase==='draft')store.put({...r.result,phase:'closed'});done()}})}
globalThis.FitPPSaleRecovery=Object.freeze({save,read,confirm,unfinished,close});
})();
