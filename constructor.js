globalThis.FitPPConstructor={mount({store:realStore,E,workspace,canEdit,navigate}){
const store={token:()=>realStore.token(),load:()=>realStore.load(),run:(a,t)=>canEdit()?realStore.run(a,t):Promise.resolve(false)};
const getRaw=async()=> (await workspace.reference().get({source:'server'})).data();
let state,editId,editRevision,editToken,priceToken,priceRevision;
let journal=null,busy=false,recovered=false,storageBlocked=false,recoveryReady=false,onlineRecovered=false,startupRecovery;
let localWrites=Promise.resolve(),restoredOperationIds=null;
const selectionKey=FitPPRuntime.namespace+'-selected-operation';
function selected(){try{return sessionStorage.getItem(selectionKey)}catch{return null}}
function select(id){try{sessionStorage.setItem(selectionKey,id)}catch{}}
const el=id=>document.getElementById('ctor-'+id),form=el('edit'),names={zarya:'Заря',pole:'Поле чудес',online:'Онлайн'},op=()=>crypto.randomUUID();

function icon(path){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',path);svg.append(p);return svg;}
function render(s){state=s;el('status').textContent=s.syncError||s.saveStatus||(s.dataReady?'Данные загружены':'Загрузка…');document.querySelectorAll('#subscriptions-panel button').forEach(b=>b.disabled=s.saving||(!s.dataReady&&b.id!=='refresh'&&!b.dataset.operationId));if(!s.dataReady){if(journal&&el('editor').open)updateSaveButton();return;}
 const p=E.pricing(s);el('initialize').hidden=!!s.pricingSettings;el('catalog-setup').hidden=!!s.pricingSettings;el('create').disabled=!s.pricingSettings||s.saving||!recoveryReady;el('templates').replaceChildren();el('archived-templates').replaceChildren();
 el('count').textContent=Object.values(p.templates).filter(t=>!t.archived).length+' активных';const archivedCount=Object.values(p.templates).filter(t=>t.archived).length;el('archive-count').textContent=String(archivedCount);el('archive-empty').hidden=archivedCount!==0;
 for(const t of Object.values(p.templates)){
 const c=document.createElement('article');c.className='card plans-template '+(t.id==='plan-zarya'?'zarya':t.id==='plan-pole'?'pole':'')+(t.archived?' archived':'');
 const top=document.createElement('div');top.className='plans-card-top';
 const title=document.createElement('h2');title.className='plans-card-name';title.textContent=t.name+(t.archived?' · В архиве':'');
 const price=document.createElement('strong');price.className='plans-price';price.textContent=new Intl.NumberFormat('ru-RU').format(t.priceKopecks/100)+' ₽';top.append(title,price);
 const metrics=document.createElement('div');metrics.className='plans-metrics';
 for(const [text,path] of [[t.sessions+' занятий','M4 5h16v14H4Z M9 5v14'],[t.durationDays+' дней','M12 8v4l3 2 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18']]){const badge=document.createElement('span');badge.className='plans-metric';badge.append(icon(path),document.createTextNode(text));metrics.append(badge);}
 const locations=document.createElement('div');locations.className='plans-locations';
 for(const h of t.locations){const badge=document.createElement('span');badge.className='plans-chip '+h;badge.append(icon('M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z M12 7v5'),document.createTextNode(names[h]));locations.append(badge);}
 const row=document.createElement('div');row.className='plans-card-actions';const edit=document.createElement('button');edit.textContent='Изменить';edit.onclick=()=>open(t);const archive=document.createElement('button');archive.className='archive-action';archive.textContent=t.archived?'Восстановить':'В архив';archive.onclick=()=>beginArchive(t);if(t.archived)row.append(archive);else row.append(edit,archive);c.append(top,metrics,locations,row);(t.archived?el('archived-templates'):el('templates')).append(c);}
 el('single-prices').replaceChildren();for(const h of Object.keys(names)){const row=document.createElement('div');row.className='plans-single-row';const name=document.createElement('span');name.className='plans-single-name';const dot=document.createElement('i');dot.className='plans-dot '+h;name.append(dot,document.createTextNode(names[h]));const value=document.createElement('strong');value.textContent=new Intl.NumberFormat('ru-RU').format(p.singlePrices[h]/100)+' ₽';row.append(name,value);el('single-prices').append(row);}

 if(!s.saving){priceRevision=p.singlePrices.revision;priceToken=store.token()}if(journal&&el('editor').open)updateSaveButton();}
function message(text){el('editor-message').textContent=text;if(storageBlocked || (journal&&!['confirmed','resolved'].includes(journal.phase))){el('recovery-status').textContent=storageBlocked?'Не удалось сохранить черновик на устройстве. Оставьте окно открытым и проверьте доступ к хранилищу.':'Есть незавершённые изменения. Продолжите работу или проверьте результат сохранения.';el('recovery-notice').hidden=false;}}
async function persist(j){
 // Serialize this page's input writes; the IDB revision check coordinates other pages.
 const id=j.operationId;
 const task=localWrites.then(async()=>{
  const expected=journal?.operationId===id?journal._journalRevision:j._journalRevision;
  try{const saved=await FitPPRecovery.write({...j,_journalRevision:expected});if(!journal||journal.operationId===id)journal=saved;select(id);await renderOperations();return saved;}
  catch(e){if(e.code==='journal-conflict'){journal=await FitPPRecovery.read(id);message(e.message);if(journal?.phase==='resolved'){journal=await FitPPRecovery.read(journal.resolution.successorOperationId);select(journal.operationId);}if(journal?.phase==='confirmed')el('editor').close();else if(journal)showDraft();}else{storageBlocked=true;message(e.message);}throw e;}
 });localWrites=task.catch(()=>{});return task;
}
async function renderOperations(){
 const container=el('operation-list');container.replaceChildren();
 const records=(await FitPPRecovery.list()).filter(j=>['draft','pending','conflict'].includes(j.phase));
 el('recovery-notice').hidden=records.length===0&&!storageBlocked;
 el('recovery-status').textContent=records.some(j=>j.phase==='conflict')?'Настройки изменены в другом окне. Ваши изменения сохранены — выберите, как продолжить.':records.some(j=>j.phase==='pending')?'Результат сохранения пока неизвестен. Проверьте его перед повторной отправкой.':records.length?'У вас есть незавершённый черновик. Его можно продолжить.':storageBlocked?'Черновик не удалось сохранить на устройстве. Не закрывайте это окно.':'';
 el('refresh').hidden=!records.some(j=>j.phase==='pending')&&!storageBlocked;
 for(const j of records){const button=document.createElement('button');button.type='button';button.dataset.operationId=j.operationId;button.textContent=({draft:'Продолжить: ',pending:'Проверить сохранение: ',conflict:'Разобрать изменения: '})[j.phase]+(j.draft.name||'Новый абонемент');button.onclick=async()=>{if(busy)return;await localWrites;select(j.operationId);await recover(j.operationId,true);};container.append(button);}
}

function draftValues(){const f=form.elements;return {name:f.name.value,price:f.price.value,sessions:f.sessions.value,days:f.days.value,locations:Object.keys(names).filter(h=>f[h].checked)};}
function updateSaveButton(){
 const waiting=journal?.phase==='draft'&&journal.requiresConfirmation&&(journal.awaitingRevision||!el('confirm-current').checked);
 form.querySelector('button.primary').disabled=busy||storageBlocked||!state.dataReady||journal?.phase==='conflict'||waiting;
}
function showDraft(){navigate();
 editId=journal.id;editRevision=journal.expectedRevision;editToken=store.token();form.reset();
 const d=journal.draft;for(const k of ['name','price','sessions','days'])form.elements[k].value=d[k];for(const h of Object.keys(names))form.elements[h].checked=d.locations.includes(h);
 el('conflict-actions').hidden=journal.phase!=='conflict';
 el('revision-check').hidden=!journal.requiresConfirmation||journal.phase!=='draft';
 const current=journal.currentServer;
 el('current-version').textContent=journal.awaitingRevision?'Черновик сохранён. Перед применением проверьте актуальную версию сервера.':current?`Актуальная версия ${current.revision}: ${current.name}, ${current.priceKopecks/100} ₽, ${current.sessions} занятий, ${current.durationDays} дней, ${current.locations.map(h=>names[h]).join(', ')}. Статус: ${current.archived?'в архиве':'активен'}. `+(journal.actionMode==='archive'?`Ваше действие: ${journal.desiredArchived?'архивировать':'восстановить'} шаблон.`:'Ваши поля ниже. Применение возможно только после повторного подтверждения.') : '';
 for(const f of form.elements)if(f.name)f.disabled=journal.phase==='pending'||journal.phase==='conflict'||journal.actionMode==='archive';
 for(const id of ['load-current','keep-draft','check-revision'])el(id).disabled=busy||storageBlocked;
 el('confirm-current').disabled=busy||journal.awaitingRevision;
 if(!el('editor').open)el('editor').showModal();updateSaveButton();
}
function draftOf(t){return {name:t.name,price:String(t.priceKopecks/100),sessions:String(t.sessions),days:String(t.durationDays),locations:[...t.locations]};}
function termsOf(t){return {name:t.name,priceKopecks:t.priceKopecks,sessions:t.sessions,durationDays:t.durationDays,locations:t.locations};}
async function open(t,independent=false){try{
 if(busy||storageBlocked||!recoveryReady)return;
 if(journal&&['draft','pending','conflict'].includes(journal.phase)){message('Восстановлена незавершённая операция. Сначала завершите её; новый шаблон не создаётся.');showDraft();return;}
 if(!t&&!independent){const unresolved=(await FitPPRecovery.list()).find(j=>j.needsReview||(restoredOperationIds?.has(j.operationId)&&['draft','pending'].includes(j.phase)));if(unresolved){await recover(unresolved.operationId);message('Предыдущее сохранение подтверждено сервером. Проверьте его в списке операций; для отдельного создания выберите «Новый независимый шаблон».');return;}}
 const operationId='plan-'+op(),id=t?.id||operationId;
 journal={version:1,id,operationId,expectedRevision:t?.revision||0,phase:'draft',draft:{name:t?.name||'',price:String(t?t.priceKopecks/100:2000),sessions:String(t?.sessions||4),days:String(t?.durationDays||14),locations:t?[...t.locations]:Object.keys(names)}};await persist(journal);showDraft();
 }catch(e){message(e.message);}}
form.addEventListener('input',event=>{if(event.target===el('confirm-current'))return;if(journal?.phase==='draft'&&!storageBlocked){if(journal.requiresConfirmation){el('confirm-current').checked=false;updateSaveButton();}const next={...journal,draft:draftValues()};void persist(next).catch(()=>{});}});
// Resolve only against a confirmed server snapshot; never infer success from local cache.
async function resolve({restoring=false}={}){
 const raw=await getRaw(),t=raw.pricingSettings?.templates[journal.id],a=journal.action;
 if(!a)return 'draft';
 const matches=t&&t.lastOperationId===a.operationId&&t.lastOperationKind===a.mode&&(a.mode==='archive'?t.archived===a.archived:E.fingerprint(termsOf(t))===E.fingerprint(a.terms));
 if(matches){await persist({...journal,phase:'confirmed',needsReview:restoring});message('Сохранение подтверждено сервером. Повторное сохранение не требуется.');el('editor').close();return 'confirmed';}
 if((t?.revision||0)!==journal.expectedRevision){await persist({...journal,phase:'conflict'});message('Настройки изменены на другом устройстве или в другом окне. Новая версия не перезаписана. Выберите, как продолжить.');showDraft();return 'conflict';}
 message('Сервер не подтвердил операцию. Черновик восстановлен; повтор использует прежний ID.');return 'absent';
}
async function executePending(){
 const status=await resolve();if(status==='confirmed'||status==='conflict')return;
 for(let attempt=0;attempt<3;attempt++){
  if((!state.dataReady||attempt>0)&&!await store.load())throw Error('Нет подтверждённых данных сервера.');
  const ok=await store.run(journal.action,store.token());
  const outcome=await resolve();if(outcome!=='absent')break;
  if(ok||journal.expectedRevision!==0||attempt===2){message('Сохранение не подтверждено. ID сохранён; повтор сначала проверит сервер.');break;}
 }
}
async function beginArchive(t){
 if(busy||storageBlocked)return;busy=true;
 try{await localWrites;const operationId='plan-'+op();journal={version:1,id:t.id,operationId,expectedRevision:t.revision,phase:'pending',actionMode:'archive',desiredArchived:!t.archived,draft:draftOf(t),action:{type:'template',mode:'archive',templateId:t.id,expectedRevision:t.revision,archived:!t.archived,operationId}};await persist(journal);await executePending();}
 catch(e){message('Результат уточняется. ID действия сохранён. '+e.message);}
 finally{busy=false;if(journal&&journal.phase!=='confirmed')showDraft();}
}
async function resolveChoice(kind){
 if(busy||storageBlocked||journal?.phase!=='conflict')return;busy=true;
 const previous=journal;
 try{
  await localWrites;let current=null;
  if(kind==='server'){if(!await store.load())throw Error('Нет подтверждённых данных сервера.');current=(await getRaw()).pricingSettings?.templates[previous.id];if(!current)throw Error('Шаблон отсутствует на сервере. Исходный черновик сохранён.');}
  const draft={version:1,id:previous.id,operationId:'plan-'+op(),expectedRevision:current?.revision??previous.expectedRevision,phase:'draft',draft:current?draftOf(current):structuredClone(previous.draft),actionMode:kind==='draft'?(previous.action?.mode||previous.actionMode||'save'):'save',desiredArchived:kind==='draft'?previous.action?.archived:undefined,requiresConfirmation:true,awaitingRevision:!current,currentServer:current||null,allowCreate:false};
  const result=await FitPPRecovery.resolveConflict(previous,draft,kind);journal=result.draft;select(journal.operationId);
  message(result.existing?'Конфликт уже разрешён в другом окне. Открыт сохранённый черновик.':kind==='server'?'Актуальная версия загружена. Прежние изменения сохранены в истории конфликта. Перед записью требуется повторное подтверждение.':'Ваши изменения сохранены как отдельный черновик. Сервер не изменён. Перед применением проверьте актуальную версию.');
 }catch(e){message('Не удалось завершить разрешение конфликта. Исходные изменения сохранены. '+e.message);}
 finally{busy=false;await renderOperations();showDraft();}
}
async function prepareRevision(){
 if(busy||storageBlocked||journal?.phase!=='draft'||!journal.requiresConfirmation)return;busy=true;
 try{await localWrites;if(!await store.load())throw Error('Нет подтверждённых данных сервера.');const current=(await getRaw()).pricingSettings?.templates[journal.id];if(!current)throw Error('Шаблон отсутствует на сервере. Создание нового вместо него запрещено.');
  await persist({...journal,expectedRevision:current.revision,currentServer:current,awaitingRevision:false});message('Актуальная версия прочитана. Сравните её с вашим черновиком и подтвердите применение.');
 }catch(e){message('Сервер недоступен. Черновик сохранён; запись не выполнялась. '+e.message);}
 finally{busy=false;showDraft();}
}
async function recover(id,reviewed=false){try{
 await localWrites;
 const records=await FitPPRecovery.list();
 if(restoredOperationIds===null)restoredOperationIds=new Set(records.map(j=>j.operationId));
 const preferred=id||selected();
 // Restore the same tab's operation when possible; otherwise show the oldest unfinished one.
 journal=records.find(j=>j.operationId===preferred)||records.find(j=>!['confirmed','resolved'].includes(j.phase))||records.at(-1)||null;
 if(!journal){await renderOperations();return;}const visited=new Set();while(journal.phase==='resolved'){if(visited.has(journal.operationId))throw Error('Повреждена связь черновиков.');visited.add(journal.operationId);journal=await FitPPRecovery.read(journal.resolution.successorOperationId);if(!journal)throw Error('Связанный черновик отсутствует.');}select(journal.operationId);
 if(journal.phase==='confirmed'){if(reviewed&&journal.needsReview)await persist({...journal,needsReview:false});el('editor').close();message('Операция уже сохранена. Повторное сохранение не требуется.');return;}
 if(journal.phase==='draft'&&journal.requiresConfirmation)await persist({...journal,awaitingRevision:true});
 if(journal.phase==='conflict'){message('Настройки изменены на другом устройстве или в другом окне. Ваши изменения сохранены. Выберите, как продолжить.');showDraft();return;}
 if(journal.action&&state.dataReady)await resolve({restoring:!reviewed});if(journal.phase!=='confirmed')showDraft();
 }catch(e){message('Результат неизвестен. Сначала требуется проверка сервера. '+e.message);if(journal)showDraft();}
 finally{await renderOperations().catch(e=>message(e.message));recoveryReady=true;render(state);}}
el('refresh').onclick=async()=>{if(busy)return;await store.load();await recover();};el('initialize').onclick=()=>store.run({type:'initializePricing'});el('create').onclick=async()=>{if(busy||storageBlocked)return;if(journal?.phase==='confirmed'){if(journal.needsReview)await persist({...journal,needsReview:false});journal=null;return open(undefined,true);}return open();};
el('load-current').onclick=()=>resolveChoice('server');el('keep-draft').onclick=()=>resolveChoice('draft');el('check-revision').onclick=prepareRevision;el('confirm-current').onchange=updateSaveButton;
el('close').textContent='Закрыть черновик';el('close').onclick=()=>{if(!busy)el('editor').close();};
form.onsubmit=async event=>{
 event.preventDefault();if(busy||storageBlocked||!journal||journal.phase==='conflict')return;
 if(journal.phase==='draft'&&journal.requiresConfirmation&&(journal.awaitingRevision||!el('confirm-current').checked)){message('Сначала проверьте актуальную версию и подтвердите применение изменений.');return;}
 busy=true;
 try{
  await localWrites;if(journal.phase==='confirmed')return;
  if(journal.phase==='draft'){
   const d=draftValues();
   const action=journal.actionMode==='archive'?{type:'template',mode:'archive',templateId:journal.id,expectedRevision:journal.expectedRevision,operationId:journal.operationId,archived:journal.desiredArchived}:{type:'template',mode:'save',templateId:journal.id,expectedRevision:journal.expectedRevision,operationId:journal.operationId,terms:{name:d.name.trim(),priceKopecks:Math.round(Number(d.price)*100),sessions:Number(d.sessions),durationDays:Number(d.days),locations:d.locations}};
   // Local payload validation only. Fresh server revision is independently checked below.
   const validation=E.read(state),target=validation.pricingSettings?.templates[journal.id];if(target)target.revision=journal.expectedRevision;
   E.reduce(validation,action,E.localDate());await persist({...journal,draft:d,action,phase:'pending'});
  }
  showDraft();await executePending();
 }catch(e){message('Сохранение не подтверждено. Черновик и ID сохранены. '+e.message);}
 finally{busy=false;if(journal&&journal.phase!=='confirmed')showDraft();}
};
el('edit-singles').onclick=()=>{if(!canEdit())return;const p=E.pricing(state);for(const h of Object.keys(names))el('singles').elements[h].value=p.singlePrices[h]/100;priceRevision=p.singlePrices.revision;priceToken=store.token();el('singles-error').textContent='';el('single-editor').showModal();};
el('singles-close').onclick=()=>el('single-editor').close();
el('singles').onsubmit=async event=>{event.preventDefault();if(busy||!canEdit())return;busy=true;const button=el('singles').querySelector('[type=submit]');button.disabled=true;try{const action={type:'singlePrices',expectedRevision:priceRevision,operationId:op(),prices:Object.fromEntries(Object.keys(names).map(h=>[h,Math.round(Number(el('singles').elements[h].value)*100)]))};if(await store.run(action,priceToken))el('single-editor').close();else el('singles-error').textContent=state.syncError||'Не сохранено. Обновите цены и повторите.';}catch(e){el('singles-error').textContent=e.message;}finally{busy=false;button.disabled=false;}};
function onState(s){render(s);if(!FitPPRuntime.catalogEnabled){document.querySelectorAll('#subscriptions-panel button').forEach(b=>b.disabled=true);return;}if(!recovered){recovered=true;startupRecovery=Promise.resolve().then(()=>recover());}if(s.dataReady&&!onlineRecovered){onlineRecovered=true;void startupRecovery.then(()=>{if(journal?.phase==='pending'&&!busy)return recover();});}}
return {onState,get recovery(){return journal}};
}};
