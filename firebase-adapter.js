/* Prepared adapter. This file imports no SDK and starts no network connection. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FitPPWorkspace=api;})(globalThis,function(){
'use strict';
const projectId='fitpp-165a2',ownerUid='fGu8QWqBQofTRQ8SxHBonbuEVjr2',datasetId='manual-history-2026-09-v1',schemaVersion=1;
const path=`trainerWorkspaces/${ownerUid}/datasets/${datasetId}`;
const fields=['clients','attendance','finances','rentMonths','attendanceOps','workouts','visits','visitOps','legacyLinks','legacySources','_fitppRevision','ownerUid','schemaVersion','datasetId'];
function validate(raw){
 if(!raw || raw.ownerUid!==ownerUid || raw.datasetId!==datasetId || raw.schemaVersion!==schemaVersion || !Number.isSafeInteger(raw._fitppRevision)||raw._fitppRevision<0 || Object.keys(raw).some(k=>!fields.includes(k)))throw Error('Несовместимая схема или dataset. Запись заблокирована.');
 for(const k of fields)if(!Object.hasOwn(raw,k))throw Error('Неполная схема. Запись заблокирована.');
 if(!Array.isArray(raw.clients))throw Error('Некорректные клиенты');
 for(const k of fields.slice(1,10))if(!raw[k]||Array.isArray(raw[k])||typeof raw[k]!=='object')throw Error('Некорректная структура');
 return raw;
}
function bind(app,{local=false}={}){
 if(app.options?.projectId!==projectId)throw Error('Недопустимый Firebase project ID');
 const db=app.firestore(),auth=app.auth();
 const check=()=>{if(app.options?.projectId!==projectId || auth.currentUser?.uid!==ownerUid)throw Error('Недопустимый проект или аккаунт');};
 return Object.freeze({local,auth,db,path,check,validate,
 reference(){check();return db.doc(path);},

 });
}
return Object.freeze({projectId,ownerUid,datasetId,schemaVersion,path,validate,bind});
});
