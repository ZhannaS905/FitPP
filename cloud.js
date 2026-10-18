(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FitPPCloud=api;})(globalThis,function(){
'use strict';
const config=Object.freeze({apiKey:'AIzaSyAmj_fvbKHbeT4LAzfo5Rrq1g8TO8yYSl4',authDomain:'fitpp-165a2.firebaseapp.com',projectId:'fitpp-165a2',storageBucket:'fitpp-165a2.firebasestorage.app',messagingSenderId:'410259745597',appId:'1:410259745597:web:48e7ad3110961cbf72f354'});
function start(firebase,W=globalThis.FitPPWorkspace){

 const app=firebase.initializeApp(config,'fitpp-165a2-full');
 const rawAuth=app.auth(),rawDB=app.firestore();
 // No enablePersistence(): Firestore uses its default in-memory cache only.
 const ready=rawAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
 let generation=0;
 const check=()=>{if(app.options.projectId!=='fitpp-165a2'||W.projectId!=='fitpp-165a2'||W.ownerUid!=='fGu8QWqBQofTRQ8SxHBonbuEVjr2'||W.path!=='trainerWorkspaces/fGu8QWqBQofTRQ8SxHBonbuEVjr2/datasets/manual-history-2026-09-v1'||rawAuth.currentUser?.uid!==W.ownerUid)throw Error('Недопустимый проект или аккаунт владельца');};
 const auth=Object.freeze({get currentUser(){return rawAuth.currentUser;},
 onAuthStateChanged(cb){return rawAuth.onAuthStateChanged(user=>{generation++;if(user&&user.uid!==W.ownerUid){cb(null);void rawAuth.signOut();}else cb(user);});},
 async signOut(){generation++;await rawAuth.signOut();},
 async signInWithEmailAndPassword(email,password){await ready;const result=await rawAuth.signInWithEmailAndPassword(email,password);if(result.user.uid!==W.ownerUid){await rawAuth.signOut();throw Error('Этот аккаунт не является владельцем FitPP.');}check();return result;}
 });
 const db=Object.freeze({doc(path){check();if(path!==W.path)throw Error('Запрещённый путь');return Object.freeze({path,async get(options){check();if(options?.source!=='server')throw Error('Разрешено только чтение с сервера');const before=generation;const snap=await rawDB.doc(path).get({source:'server'});check();if(before!==generation||snap.metadata?.fromCache!==false||snap.metadata?.hasPendingWrites)throw Error('Нет подтверждённого снимка сервера');if(snap.exists)W.validate(snap.data());return snap;}});},async runTransaction(callback){
  check();const before=generation;const guard=()=>{check();if(before!==generation)throw Error('Сессия изменилась');};
  return rawDB.runTransaction(async tx=>{guard();let previous,read=false,written=false;
   const result=await callback({async get(ref){guard();if(ref.path!==W.path||read)throw Error('Запрещённое чтение');const snap=await tx.get(rawDB.doc(W.path));guard();if(!snap.exists)throw Error('База отсутствует. Создание отключено');previous=W.validate(snap.data());read=true;return snap;},
    set(ref,next){guard();if(ref.path!==W.path||!read||written)throw Error('Недопустимая запись');W.validate(next);if(next._fitppRevision!==previous._fitppRevision+1)throw Error('Недопустимая revision');if(new TextEncoder().encode(JSON.stringify(next)).length>800000)throw Error('База приближается к лимиту документа. Сохраните бэкап');tx.update(rawDB.doc(W.path),next);written=true;}});
   guard();return result;
  });
 }});
 const bound=W.bind({options:app.options,auth:()=>auth,firestore:()=>db});
 return Object.freeze({...bound,writesEnabled:true,initialize:undefined});
}
return Object.freeze({start,config});
});
