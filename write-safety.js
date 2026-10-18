/* Remember intent only. Every production write still requires a durable backup
   of a fresh server snapshot and the existing transaction conflict check. */
(function(root){
'use strict';
const key='fitpp-165a2-owner-write-intent-v1';
function intent(){try{return localStorage.getItem(key)!=='off';}catch(_){return true;}}
function remember(value){try{localStorage.setItem(key,value?'on':'off');}catch(_){}}
async function database(){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('fitpp-165a2-safety-v1',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('backups');
 request.onerror=()=>reject(Error('Хранилище резервных копий недоступно. Запись заблокирована.'));
 request.onblocked=()=>reject(Error('Закройте другие вкладки FitPP для доступа к копиям.'));
 request.onsuccess=()=>resolve(request.result);
});}
async function transaction(mode, action){const db=await database();try{return await new Promise((resolve,reject)=>{
 const tx=db.transaction('backups',mode), request=action(tx.objectStore('backups'));let result;
 request.onsuccess=()=>{result=request.result;};
 tx.oncomplete=()=>resolve(result);
 tx.onerror=tx.onabort=()=>reject(Error('Не удалось сохранить или прочитать резервную копию. Запись заблокирована.'));
});}finally{db.close();}}
async function save(data){
 if(!intent())throw Error('Запись отключена в настройках.');
 const backup=await FitPPBackup.create(data,'firebase');
 const id=String(data._fitppRevision).padStart(16,'0')+'-'+backup.sha256;
 await transaction('readwrite',store=>store.put(backup,id));
 const saved=await transaction('readonly',store=>store.get(id));
 const restored=await FitPPBackup.restore(saved);
 if(FitPPStore.fingerprint(restored)!==FitPPStore.fingerprint(data))throw Error('Копия не прошла проверку. Запись заблокирована.');
}
async function latest(){const rows=await transaction('readonly',store=>store.getAll());return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];}
root.FitPPWriteSafety=Object.freeze({intent,remember,save,latest});
})(globalThis);
