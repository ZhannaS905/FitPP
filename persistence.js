/* Account-scoped, confirmed-only persistence. No production migrations on load. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FitPPStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const prices = Object.freeze({ zarya: 700, pole: 600, online: 500 });
  const fail = (message, code = "invalid") =>
    Object.assign(new Error(message), { code });
  const plain = (value) =>
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === null ||
      Object.getPrototypeOf(value).constructor?.name === "Object");
  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (plain(value))
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, copy(v)]),
      );
    return value; // Preserve Firestore Timestamp/GeoPoint and other SDK values.
  }
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (plain(value))
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, stable(value[k])]),
      );
    return value;
  }
  const fingerprint = (data) => JSON.stringify(stable(data));
  const id = () =>
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Calendar arithmetic uses UTC only as an ordinal; today uses the device's local date.
  function localDate(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  function dayNumber(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '0100-01-01') throw fail('Некорректная дата.');
    const ms = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== date) throw fail('Некорректная дата.');
    return ms / 86400000;
  }
  function addDays(date, count) {
    const result = new Date((dayNumber(date) + count) * 86400000).toISOString().slice(0,10);
    dayNumber(result);
    return result;
  }
  function validateFreezes(sub) {
    if (sub.freezes === undefined) return;
    if (!Array.isArray(sub.freezes) || !Number.isSafeInteger(sub.left) || sub.left < 0) throw fail('Повреждена история заморозок.');
    dayNumber(sub.expires);
    let previousEnd = '', expected;
    for (const f of sub.freezes) {
      if (!plain(f) || f.version !== 1) throw fail('Неизвестный формат заморозки.');
      const start = dayNumber(f.start), end = dayNumber(f.end), planned = dayNumber(f.returnDate);
      dayNumber(f.baseExpires);
      if (end < start || planned <= start || end > planned || f.start < previousEnd ||
          f.start > f.baseExpires || (expected && f.baseExpires !== expected)) throw fail('Повреждена история заморозок.');
      expected = addDays(f.baseExpires, end-start);
      previousEnd = f.end;
    }
    if (expected && sub.expires !== expected) throw fail('Срок не соответствует истории заморозок.');
  }
  function frozenOn(sub, date = localDate()) {
    dayNumber(date);
    validateFreezes(sub);
    return (sub.freezes || []).some(f => f.start <= date && date < f.end);
  }
  // Presentation only: expires already includes all confirmed/planned freeze extensions.
  // Subscriptions are shared across the client's halls in the existing data model.
  function subscriptionWarnings(client, today = localDate()) {
    dayNumber(today);
    const subs = client?.subscriptions || [];
    const display = subs.find(s => s.left > 0) || subs.at(-1);
    const warnings = [];
    if (display?.left === 1) warnings.push({key:'balance', kind:'balance', text:'Осталось 1 занятие', title:'Осталось 1 занятие'});
    const remaining = subs.filter(s => s.left > 0);
    const candidates = remaining.length ? remaining : display ? [display] : [];
    candidates.forEach(sub => {
      try {
        if ((sub.startDate && (dayNumber(sub.startDate), sub.startDate > today)) || frozenOn(sub, today)) return;
        const days = dayNumber(sub.expires) - dayNumber(today);
        if (days > 3) return;
        const text = days < 0 ? 'Абонемент истёк' : days === 0 ? 'Абонемент истекает сегодня' :
          `Абонемент истекает через ${days} ${days === 1 ? 'день' : 'дня'}`;
        warnings.push({key:`expiry-${subs.indexOf(sub)}`, kind:days < 0 ? 'expired' : 'soon',
          text:text + (candidates.length > 1 ? ` · до ${sub.expires}` : ''),
          title:`Абонемент №${subs.indexOf(sub)+1}, до ${sub.expires}`});
      } catch (_) { /* Unknown legacy dates/history must not produce a false expiry warning. */ }
    });
    return warnings;
  }
  function freezeStart(data, clientId, today = localDate()) {
    dayNumber(today);
    return ['attended', 'missed', 'razov'].includes(data.attendance?.[today]?.[clientId]) ? addDays(today, 1) : today;
  }
  function pendingFreeze(sub, today = localDate()) {
    dayNumber(today);
    validateFreezes(sub);
    return (sub.freezes || []).some(f => today < f.start && f.start < f.end);
  }
  function extensionRemaining(sub) {
    const used = sub.extensionDays ?? 0;
    if (!Number.isSafeInteger(used) || used < 0 || used > 14) throw fail('Повреждён лимит продления.');
    return 14 - used;
  }
  function subscriptionTitle(sub, today = localDate()) {
    if (sub?.expires && sub.expires < today) return 'Абонемент истёк';
    return sub?.left > 0 ? '● Активный абонемент' : 'Нет активного абонемента';
  }
  function extendSubscription(data, action, today) {
    dayNumber(today);
    const client = clientOf(data, action.clientId);
    if (client.archivedAt) throw fail('Сначала восстановите клиента из архива.');
    const sub = client.subscriptions?.[action.subscriptionIndex];
    if (!Number.isSafeInteger(action.subscriptionIndex) || !sub) throw fail('Абонемент не найден.');
    dayNumber(sub.expires);
    if (action.expectedExpires !== sub.expires || action.expectedUsed !== (sub.extensionDays ?? 0)) throw fail('Абонемент изменился. Откройте продление заново.');
    if (!Number.isSafeInteger(sub.left) || sub.left <= 0) throw fail('Нет оставшихся занятий.');
    if (frozenOn(sub, today) || pendingFreeze(sub, today)) throw fail('Сначала завершите или отмените заморозку.');
    if (!Number.isSafeInteger(action.days) || action.days < 1 || action.days > extensionRemaining(sub)) throw fail('Продление: от 1 дня, не более 14 дней суммарно на абонемент.');
    sub.expires = addDays(sub.expires, action.days);
    sub.extensionDays = (sub.extensionDays ?? 0) + action.days;
  }
  function changeFreeze(data, action, today) {
    dayNumber(today);
    const client = clientOf(data, action.clientId);
    const sub = client.subscriptions?.[action.subscriptionIndex];
    if (!sub || !Number.isSafeInteger(action.subscriptionIndex)) throw fail('Абонемент не найден.');
    validateFreezes(sub);
    dayNumber(sub.expires);
    if (!Number.isSafeInteger(sub.left) || sub.left <= 0) throw fail('Нет оставшихся занятий.');
    if (action.type === 'freeze') {
      if (frozenOn(sub, today) || pendingFreeze(sub, today)) throw fail('Абонемент уже заморожен или заморозка запланирована.');
      if (sub.startDate && (dayNumber(sub.startDate), sub.startDate > today)) throw fail('Абонемент ещё не начался.');
      if (today > sub.expires) throw fail('Срок абонемента истёк.');
      const start = freezeStart(data, client.id, today);
      if (action.startDate !== undefined && action.startDate !== start) throw fail('Дата начала изменилась. Откройте заморозку заново.');
      if (start > sub.expires) throw fail('Абонемент истекает до начала заморозки.');
      const days = dayNumber(action.returnDate) - dayNumber(start);
      if (days <= 0) throw fail('Возвращение должно быть позже начала заморозки.');
      const last = sub.freezes?.at(-1);
      if (last && last.end > start) throw fail('Периоды заморозки пересекаются.');
      // A pre-existing visit in the new interval would contradict the preserved balance.
      for (const [date, entries] of Object.entries(data.attendance)) {
        if (start <= date && date < action.returnDate && ['attended','missed','razov'].includes(entries[client.id]))
          throw fail('В периоде уже есть списания/отметки. Сначала сверьте журнал.');
      }
      const expires = addDays(sub.expires, days);
      (sub.freezes ||= []).push({version:1, start, returnDate:action.returnDate, end:action.returnDate, baseExpires:sub.expires});
      sub.expires = expires; // Planned extension; natural return needs no second write.
    } else {
      const f = sub.freezes?.at(-1);
      if (f && pendingFreeze(sub, today)) {
        sub.expires = f.baseExpires;
        sub.freezes.pop();
        return;
      }
      if (!f || !frozenOn(sub, today)) throw fail('Нет текущей заморозки.');
      sub.expires = addDays(f.baseExpires, dayNumber(today)-dayNumber(f.start));
      f.end = today;
    }
  }
  function rentDates(month, hall) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '2026-11' || !['zarya', 'pole'].includes(hall))
      throw fail('Некорректный месяц или зал аренды.');
    const [y, m] = month.split('-').map(Number), dates = [];
    for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
      const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if ((hall === 'zarya' ? [1, 3] : [2, 4]).includes(day)) dates.push(`${month}-${String(d).padStart(2, '0')}`);
    }
    return dates;
  }
  function validateRent(month, entry) {
    if (!plain(entry) || entry.version !== 1) throw fail('Неизвестный формат аренды.');
    for (const hall of ['zarya', 'pole']) {
      const allowed = rentDates(month, hall), dates = entry[hall];
      if (!Array.isArray(dates) || new Set(dates).size !== dates.length || dates.some(d => !allowed.includes(d)))
        throw fail('Некорректные даты аренды.');
    }
  }
  const rentTotal = entry => entry ? entry.zarya.length * 800 + entry.pole.length * 600 : 0;
  function read(raw = {}) {
    const data = {
      clients: raw.clients ?? [],
      attendance: raw.attendance ?? {},
      finances: raw.finances ?? {},
      rentMonths: raw.rentMonths ?? {},
      attendanceOps: raw.attendanceOps ?? {},
      workouts: raw.workouts ?? {}, visits: raw.visits ?? {}, visitOps: raw.visitOps ?? {}, legacyLinks: raw.legacyLinks ?? {}, legacySources: raw.legacySources ?? {},
      _fitppRevision: raw._fitppRevision ?? 0,
    };
    if (
      !Array.isArray(data.clients) ||
      !plain(data.attendance) ||
      !plain(data.finances) ||
      !plain(data.rentMonths) ||
      !plain(data.attendanceOps) || !plain(data.workouts) || !plain(data.visits) || !plain(data.visitOps) || !plain(data.legacyLinks) || !plain(data.legacySources) ||
      !Number.isSafeInteger(data._fitppRevision) ||
      data._fitppRevision < 0
    ) {
      throw fail(
        "Неизвестный формат данных. Запись заблокирована, данные не изменены.",
      );
    }
    if (
      data.clients.some(
        (c) =>
          !plain(c) ||
          !["string", "number"].includes(typeof c.id) ||
          ["__proto__", "constructor", "prototype"].includes(String(c.id)) ||
          (c.subscriptions != null && !Array.isArray(c.subscriptions)),
      ) ||
      Object.values(data.attendance).some((day) => !plain(day)) ||
      Object.values(data.finances).some((n) => !Number.isFinite(n))
    ) {
      throw fail(
        "Повреждённые данные. Запись заблокирована, обратитесь к администратору.",
      );
    }
    if (
      new Set(data.clients.map((c) => String(c.id))).size !==
      data.clients.length
    )
      throw fail(
        "Повторяющиеся идентификаторы клиентов. Запись заблокирована.",
      );
    for (const [month, entry] of Object.entries(data.rentMonths)) validateRent(month, entry);
    for (const c of data.clients) for (const sub of c.subscriptions || []) {
      if (!plain(sub)) throw fail("Повреждённый абонемент.");
      validateFreezes(sub);
    }
    for (const c of data.clients) ledger(c);
    for(const [key,w] of Object.entries(data.workouts)) {
      if(!plain(w) || w.id!==key || (!regular(w.location,w.originDate) && !(w.legacy===true && schedule[w.location]) && !(w.extra===true && schedule[w.location])) || (w.extra===true ? !new RegExp('^'+w.location+'_extra_[a-zA-Z0-9-]+$').test(key) : key!==w.location+'_'+w.originDate) || typeof w.cancelled!=='boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.time)) throw fail('Повреждено расписание.');
      dayNumber(w.date);dayNumber(w.originDate);
    }
    for(const map of [data.visits,data.visitOps]) for(const [key,entries] of Object.entries(map)) {
      workoutOf(data,key);if(!plain(entries)) throw fail('Повреждены отметки тренировки.');
    }
    for(const entries of Object.values(data.visits)) if(Object.values(entries).some(v=>!['attended','missed','razov','excused'].includes(v))) throw fail('Неизвестная отметка.');
    for(const [key,target] of Object.entries(data.legacyLinks)) {
      workoutOf(data,target);
      const source={status:data.attendance[key.slice(0,10)]?.[key.slice(11)] ?? null,op:data.attendanceOps[key.slice(0,10)]?.[key.slice(11)] ?? null};
      if(fingerprint(source)!==fingerprint(data.legacySources[key])) throw fail('Старые отметки изменены после миграции. Требуется сверка; запись заблокирована.');
    }
    return copy(data);
  }
  // Money history lives inside the existing clients list: no dataset/rules migration.
  function money(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000 || Math.abs(value*100-Math.round(value*100)) > 0.000001) throw fail('Укажите сумму в рублях, не более двух знаков после запятой.');
    return Math.round(value*100);
  }
  function ledger(client) {
    if (client.money === undefined) return [];
    if (!plain(client.money) || client.money.version !== 1 || !Array.isArray(client.money.entries)) throw fail('Неизвестная денежная история.');
    let balance=0, previous='', keys=new Set(), seen=new Map(), cancelled=new Set();
    for (const e of client.money.entries) {
      dayNumber(e.date);
      if (!plain(e) || typeof e.id!=='string' || keys.has(e.id) || e.date<previous || !['sale','legacy','cancel','refund'].includes(e.kind) || !Number.isSafeInteger(e.received) || !Number.isSafeInteger(e.delta) || !Number.isSafeInteger(e.price) || e.price<0 || !Number.isSafeInteger(e.used) || e.used<0 || !['cash','transfer',null].includes(e.method) || (e.received!==0 && !e.method)) throw fail('Повреждена денежная история.');
      if ((e.kind==='sale' && (e.received<0 || e.delta!==e.received-e.price || e.used>e.price)) || (e.kind==='legacy' && (e.received!==e.price || e.delta!==0 || e.used!==0)) || (e.kind==='cancel' && (e.received!==0 || e.delta!==e.price)) || (e.kind==='refund' && (e.received>=0 || e.delta!==e.received))) throw fail('Несогласованные денежные движения.');
      if(['sale','legacy'].includes(e.kind) && !['cash','transfer'].includes(e.method))throw fail('Не указан способ оплаты.');
      if(e.kind==='sale' && (e.used!==Math.min(balance,e.price) || e.received+e.used<e.price)) throw fail('Неверный зачёт баланса.');
      if(e.kind==='cancel') {
        const source=seen.get(e.ref);
        if(!source || !['sale','legacy'].includes(source.kind) || cancelled.has(e.ref) || e.price!==source.price || e.used!==0 || e.method!==null)throw fail('Неверная отмена оплаты.');
        cancelled.add(e.ref);
      }
      if(e.kind==='refund' && (e.price!==0 || e.used!==0))throw fail('Неверный возврат.');
      seen.set(e.id,e);
      balance+=e.delta;
      if (!Number.isSafeInteger(balance) || balance<0) throw fail('Денежный баланс не может стать отрицательным.');
      keys.add(e.id);previous=e.date;
    }
    return client.money.entries;
  }
  const balance = client => ledger(client).reduce((n,e)=>n+e.delta,0)/100;
  const rubles = cents => cents/100;
  function addMoney(data,client,entry,today) {
    dayNumber(entry.date);
    if(entry.date>today) throw fail('Оплата будущей датой запрещена.');
    const entries=ledger(client);
    if(entry.kind!=='legacy' && entries.length && entry.date<entries.at(-1).date) throw fail('Вносите денежную историю клиента по порядку дат. Более поздние операции уже сохранены.');
    client.money ||= {version:1,entries:[]};
    const added={id:id(),...entry};
    client.money.entries.push(added);
    client.money.entries.sort((a,b)=>a.date.localeCompare(b.date));ledger(client);
    if(entry.kind!=='legacy') {
      const month=entry.date.slice(0,7);
      data.finances[month]=Math.round(((data.finances[month] || 0)*100+entry.received))/100;
    }
    return added.id;
  }
  function sell(data,client,action,price,ref,today) {
    const cost=money(price), available=money(balance(client));
    if(!['cash','transfer'].includes(action.method)) throw fail('Выберите один способ оплаты: Перевод или Наличные.');
    const received=money(action.received), used=Math.min(cost,available);
    if(received+used<cost) throw fail('Недоплата: требуется '+rubles(cost-used)+' ₽. Продажа не сохранена.');
    return addMoney(data,client,{kind:'sale',date:action.paymentDate || action.date,method:action.method,received,price:cost,used,delta:received-cost,ref},today);
  }
  function cancelMoney(data,client,paymentId,today) {
    const e=ledger(client).find(e=>e.id===paymentId);
    if(!e || !['sale','legacy'].includes(e.kind) || ledger(client).some(x=>x.kind==='cancel'&&x.ref===paymentId)) throw fail('Исходная оплата не найдена или уже отменена.');
    addMoney(data,client,{kind:'cancel',date:today,method:null,received:0,price:e.price,used:0,delta:e.price,ref:paymentId},today);
  }
  function report(data,month) {
    const result={cash:0,transfer:0,cashRefund:0,transferRefund:0,unknown:0,total:data.finances[month]||0};
    for(const c of data.clients) for(const e of ledger(c)) if(e.date.slice(0,7)===month && e.method) {
      result[e.method]+=e.received/100;
      if(e.received<0)result[e.method+'Refund']-=e.received/100;
    }
    result.cash=Math.round(result.cash*100)/100;result.transfer=Math.round(result.transfer*100)/100;
    result.cashRefund=Math.round(result.cashRefund*100)/100;result.transferRefund=Math.round(result.transferRefund*100)/100;
    result.unknown=Math.round((result.total-result.cash-result.transfer)*100)/100;
    return result;
  }
  function legacyPayments(data,client) {
    const rows=[];
    (client.subscriptions||[]).forEach((s,i)=>{if(!s.paymentId && !s.cancelledAt) rows.push({key:'sub:'+i,label:'Абонемент',date:s.startDate,price:s.price,index:i,expected:fingerprint(s)});});
    for(const [date,entries] of Object.entries(data.attendance)) if(entries[client.id]==='razov' && !data.legacyLinks[date+'/'+client.id]) {
      const op=data.attendanceOps[date]?.[client.id];
      if(!op?.paymentId)rows.push({key:'old:'+date,label:'Разовое (старый журнал)',date,price:op?.price,oldDate:date,expected:fingerprint(op||null)});
    }
    for(const [key,entries] of Object.entries(data.visits)) if(entries[client.id]==='razov') {
      const op=data.visitOps[key]?.[client.id];
      if(!op?.paymentId)rows.push({key:'visit:'+key,label:'Разовое',date:workoutOf(data,key).date,price:op?.price,workoutId:key,expected:fingerprint(op||null)});
    }
    return rows.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  }
  function clientOf(data, clientId) {
    const client = data.clients.find((c) => c.id === clientId);
    if (!client)
      throw fail("Клиент отсутствует в текущем аккаунте. Обновите данные.");
    return client;
  }
  function attendance(data, action, today) {
    const {clientId,date,location,status}=action;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Object.hasOwn(prices, location) ||
      !["attended", "razov", "missed"].includes(status)
    )
      throw fail("Некорректная отметка посещения.");
    dayNumber(date);
    const client = clientOf(data, clientId);
    if (client.archivedAt) throw fail('Клиент в архиве. Сначала восстановите его.');
    if (['attended','missed'].includes(status) && client.subscriptions?.some(s => frozenOn(s, today) || frozenOn(s, date)))
      throw fail('Абонемент заморожен: списание занятий заблокировано.');
    const day = (data.attendance[date] ||= {});
    const ops = (data.attendanceOps[date] ||= {});
    const previous = Object.hasOwn(day, clientId) ? day[clientId] : undefined;
    if (
      previous !== undefined &&
      !["attended", "razov", "missed", "excused"].includes(previous)
    )
      throw fail("Неизвестный формат посещения. Запись не изменена.");
    const operation = ops[clientId];
    if (["attended", "razov"].includes(previous) || (previous === "missed" && operation?.subscriptionId)) {
      if (!operation || operation.status !== previous)
        throw fail(
          "В старой записи нет исходного абонемента или суммы. Автоматическая отмена небезопасна; нужна сверка истории.",
          "legacy",
        );
      if (previous === "attended" || previous === "missed") {
        const matches =
          client.subscriptions?.filter(
            (s) => s.id === operation.subscriptionId,
          ) || [];
        const sub = matches.length === 1 ? matches[0] : null;
        if (!sub || !Number.isFinite(sub.left))
          throw fail("Исходный абонемент не найден. Изменение отменено.");
        sub.left++;
      } else {
        if (!Number.isFinite(operation.price) || operation.price < 0)
          throw fail("Неизвестна исходная сумма оплаты.");
        if(!operation.paymentId) throw fail('Сначала уточните старую оплату в карточке клиента.');
        cancelMoney(data,client,operation.paymentId,today);
      }
    }
    if (previous === status) {
      delete day[clientId];
      delete ops[clientId];
      return;
    }
    const next = { status, location, operationId: id() };
    if (status === "attended" || status === "missed") {
      const sub = client.subscriptions?.find(
        (s) => Number.isSafeInteger(s.left) && s.left > 0 &&
          (!s.startDate || s.startDate <= date) && s.expires >= date && !frozenOn(s, date),
      );
      if (!sub)
        throw fail(
          "У клиента нет доступных занятий. Сначала оформите абонемент.",
        );
      sub.id ||= id();
      next.subscriptionId = sub.id;
      sub.left--;
    } else if (status === "razov") {
      next.price = prices[location];
      next.paymentId=sell(data,client,action,next.price,next.operationId,today);
    }
    day[clientId] = status; // Keep the original string format for existing readers.
    ops[clientId] = next;
  }
  const schedule = {zarya:{days:[1,3],time:'20:00'},pole:{days:[2,4],time:'18:30'},online:{days:[0,6],time:'18:00'}};
  function regular(hall,date) {
    dayNumber(date);
    if (!schedule[hall]?.days.includes(new Date(date+'T00:00:00Z').getUTCDay())) return null;
    return {id:hall+'_'+date,location:hall,originDate:date,date,time:schedule[hall].time,cancelled:false};
  }
  function workoutsOn(data,hall,date) {
    const base=regular(hall,date), map={...data.workouts};
    if(base && !map[base.id]) map[base.id]=base;
    return Object.values(map).filter(w=>w.location===hall && (w.date===date || (!w.cancelled && !w.extra && w.originDate===date))).sort((a,b)=>a.time.localeCompare(b.time));
  }
  // 60-minute workouts require a 15-minute break, including across midnight.
  // Only an online/hall pair with exactly equal starts is exempt.
  function checkWorkoutConflict(data,w) {
    if(w.cancelled) return;
    const start=Date.parse(w.date+'T'+w.time+':00Z'), minimumSeparation=75*60*1000;
    const rows=new Map();
    for(const hall of Object.keys(schedule)) for(const offset of [-1,0,1])
      for(const other of workoutsOn(data,hall,addDays(w.date,offset))) rows.set(other.id,other);
    const conflict=[...rows.values()].find(other=> {
      if(other.id===w.id || other.cancelled) return false;
      const otherStart=Date.parse(other.date+'T'+other.time+':00Z');
      const onlineHallPair=(other.location==='online')!==(w.location==='online');
      if(onlineHallPair && start===otherStart) return false;
      return Math.abs(start-otherStart)<minimumSeparation;
    });
    if(conflict) {
      const names={zarya:'Заря',pole:'Поле чудес',online:'Онлайн'};
      throw fail('Пересечение или недостаточный перерыв: уже есть тренировка «'+names[conflict.location]+'» '+conflict.date+' в '+conflict.time+'. Каждая тренировка длится 60 минут, затем нужен перерыв минимум 15 минут. Онлайн и зал могут начинаться ровно одновременно. Выберите другое время.');
    }
  }
  function workoutOf(data,key) {
    const split=key.indexOf('_'), base=data.workouts[key] ? null : regular(key.slice(0,split),key.slice(split+1));
    const w=data.workouts[key] || base;
    if(!w || w.id!==key) throw fail('Тренировка не найдена.');
    return copy(w);
  }
  // Legacy records are retained byte-for-byte. Links claim each old mark exactly once.
  // Migration changes neither balances nor income and is committed with the requested action.
  function migrate(data) {
    for(const [date,entries] of Object.entries(data.attendance)) for(const [cid,status] of Object.entries(entries)) {
      const key=date+'/'+cid;
      if(data.legacyLinks[key]) continue;
      const op=data.attendanceOps[date]?.[cid], client=data.clients.find(c=>String(c.id)===cid);
      const halls=op?.location ? [op.location] : (client?.locations?.length===1 ? client.locations : []);
      if(halls.length!==1 || !schedule[halls[0]] || (!op?.location && !regular(halls[0],date))) continue;
      const w=regular(halls[0],date) || {id:halls[0]+'_'+date,location:halls[0],originDate:date,date,time:schedule[halls[0]].time,cancelled:false,legacy:true};
      if(w.legacy) data.workouts[w.id] ||= w;
      if(Object.hasOwn(data.visits[w.id] || {},cid)) throw fail('Конфликт старой отметки. Требуется сверка.');
      (data.visits[w.id] ||= {})[cid]=status;
      if(op) (data.visitOps[w.id] ||= {})[cid]=copy(op);
      data.legacyLinks[key]=w.id;
      data.legacySources[key]=copy({status,op:op ?? null});
    }
  }
  function unresolved(data,cid) {
    return Object.entries(data.attendance).some(([date,day])=>Object.keys(day).some(c=> (cid===undefined || String(cid)===c) && !data.legacyLinks[date+'/'+c]));
  }
  function sessionAction(data,action,today) {
    migrate(data);
    if(action.type==='workout' && action.mode==='add') {
      if(unresolved(data)) throw fail('Есть старые отметки с неоднозначным залом. Сначала требуется сверка журнала.');
      dayNumber(action.date);
      if(!schedule[action.location] || !/^([01]\d|2[0-3]):[0-5]\d$/.test(action.time)) throw fail('Некорректный зал или время.');
      const now=new Date(), stamp=localDate(now)+'T'+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
      if(action.date+'T'+action.time<=stamp) throw fail('Нельзя добавить тренировку в прошлое.');
      checkWorkoutConflict(data,{location:action.location,date:action.date,time:action.time});
      if(typeof action.workoutId!=='string' || !new RegExp('^'+action.location+'_extra_[a-zA-Z0-9-]+$').test(action.workoutId) || data.workouts[action.workoutId]) throw fail('Некорректный или повторный номер тренировки.');
      data.workouts[action.workoutId]={id:action.workoutId,location:action.location,originDate:action.date,date:action.date,time:action.time,cancelled:false,extra:true};
      return;
    }
    const w=workoutOf(data,action.workoutId);
    if(action.type==='workout') {
      if(unresolved(data)) throw fail('Есть старые отметки с неоднозначным залом. Сначала требуется сверка журнала.');
      const locked=Object.keys(data.visits[w.id] || {}).length || Object.keys(data.visitOps[w.id] || {}).length;
      if(locked) throw fail('У тренировки уже есть отметки или списания. Сначала снимите их с возвратом списаний.');
      if(action.mode==='delete') {
        if(!w.extra || !w.cancelled) throw fail('Удалить навсегда можно только отменённую дополнительную тренировку.');
        if(Object.values(data.legacyLinks).includes(w.id)) throw fail('Тренировка связана со старыми отметками. Удаление запрещено.');
        delete data.workouts[w.id];delete data.visits[w.id];delete data.visitOps[w.id];return;
      }
      const before=copy(w);
      if(action.mode==='restore') {if(w.extra) throw fail('Дополнительная тренировка не входит в повторяющееся расписание.');w.date=w.originDate;w.time=schedule[w.location].time;w.cancelled=false;}
      else if(action.mode==='resume') {w.cancelled=false;}
      else if(action.mode==='cancel') w.cancelled=true;
      else if(action.mode==='move') {dayNumber(action.date); if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(action.time)) throw fail('Некорректное время.');w.date=action.date;w.time=action.time;w.cancelled=false;}
      else throw fail('Неизвестное действие.');
      const now=new Date();
      if(before.date+'T'+before.time <= localDate(now)+'T'+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')) throw fail('Изменять можно только до начала тренировки.');
      if(w.date+'T'+w.time <= localDate(now)+'T'+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')) throw fail('Нельзя восстановить или перенести в прошлое.');
      if(Object.keys(data.visits[w.id] || {}).length || Object.keys(data.visitOps[w.id] || {}).length) throw fail('У тренировки уже есть отметки. Сначала снимите их с возвратом списаний.');
      checkWorkoutConflict(data,w);
      data.workouts[w.id]=w;
      return;
    }
    if(unresolved(data,action.clientId)) throw fail('У клиента есть неоднозначные старые отметки. Требуется сверка.');
    if(w.cancelled || w.date!==action.date || w.location!==action.location) throw fail('Тренировка отменена или перенесена. Обновите расписание.');
    const prior=data.visits[w.id]?.[action.clientId], priorOp=data.visitOps[w.id]?.[action.clientId];
    if(prior==='missed' && (!priorOp || priorOp.status!==prior || !priorOp.subscriptionId)) throw fail('У старой отметки «Сгорело» нет исходного абонемента. Требуется сверка; повторное списание заблокировано.','legacy');
    const legacyAttendance=data.attendance, legacyOps=data.attendanceOps;
    data.attendance={[w.date]:copy(data.visits[w.id] || {})};
    data.attendanceOps={[w.date]:copy(data.visitOps[w.id] || {})};
    attendance(data,action,today);
    data.visits[w.id]=data.attendance[w.date];data.visitOps[w.id]=data.attendanceOps[w.date];
    data.attendance=legacyAttendance;data.attendanceOps=legacyOps;
    data.workouts[w.id]=w;
  }
  function deletionPlan(data, clientId) {
    const c = clientOf(data, clientId);
    if (['attendance','attendanceOps','visits','visitOps'].some(map =>
      Object.values(data[map]).some(entries => Object.hasOwn(entries, clientId))))
      throw fail('Есть посещения или отметки журнала. Используйте архив.');
    if (['legacyLinks','legacySources'].some(map => Object.keys(data[map]).some(key => key.slice(11) === String(clientId))))
      throw fail('Есть связанные данные старого журнала. Используйте архив.');
    if (ledger(c).length || (c.subscriptions || []).length)
      throw fail('Есть абонементы и финансовая история. Используйте архив.');
    return {};
  }
  function reduce(input, action, today = localDate()) {
    const data = copy(input);
    if (action.type==='refund') {
      const c=clientOf(data,action.clientId), amount=money(action.received);
      if(!['cash','transfer'].includes(action.method)||amount<=0||amount>money(balance(c))) throw fail('Возврат должен быть больше нуля и не превышать баланс.');
      addMoney(data,c,{kind:'refund',date:action.date,method:action.method,received:-amount,price:0,used:0,delta:-amount,ref:''},today);
    } else if(action.type==='classifyLegacy') {
      const c=clientOf(data,action.clientId), row=legacyPayments(data,c).find(r=>r.key===action.key);
      if(!row || row.expected!==action.expected || !['cash','transfer'].includes(action.method))throw fail('Старая запись изменилась или способ оплаты не выбран.');
      dayNumber(row.date);const price=money(row.price);
      if(price<=0)throw fail('Исходная сумма неизвестна. Автоматическая сверка невозможна.');
      const month=row.date.slice(0,7), totals=report(data,month);
      if(money(Math.max(0,totals.unknown))<price)throw fail('Сумма превышает нераспределённый доход месяца. Нужна сверка общего итога.');
      const paymentId=addMoney(data,c,{kind:'legacy',date:row.date,method:action.method,received:price,price,used:0,delta:0,ref:row.key},today);
      if(row.index!==undefined) {c.subscriptions[row.index].id ||= id();c.subscriptions[row.index].paymentId=paymentId;}
      else {
        const entries=row.workoutId ? (data.visitOps[row.workoutId] ||= {}) : (data.attendanceOps[row.oldDate] ||= {});
        // Missing original amount is never guessed; only known operations reach here.
        entries[c.id].paymentId=paymentId;
      }
    } else if (action.type==='linkLegacy') {
      dayNumber(action.date); const key=action.date+'/'+action.clientId;
      const w=schedule[action.location] && (regular(action.location,action.date) || {id:action.location+'_'+action.date,location:action.location,originDate:action.date,date:action.date,time:schedule[action.location].time,cancelled:false,legacy:true}), status=data.attendance[action.date]?.[action.clientId];
      if(!w || !['attended','missed','razov','excused'].includes(status) || data.legacyLinks[key] || Object.hasOwn(data.visits[w.id] || {},action.clientId)) throw fail('Нельзя связать старую отметку.');
      const op=data.attendanceOps[action.date]?.[action.clientId];
      if(op?.location && op.location!==w.location) throw fail('Зал противоречит исходной операции.');
      if(w.legacy) data.workouts[w.id] ||= w;
      (data.visits[w.id] ||= {})[action.clientId]=status;
      if(op) (data.visitOps[w.id] ||= {})[action.clientId]=copy(op);
      data.legacyLinks[key]=w.id;
      data.legacySources[key]=copy({status,op:op ?? null});
    }
    else if (action.type==='workout' || (action.type==='attendance' && action.workoutId)) sessionAction(data,action,today);
    else if (action.type === 'extendSubscription') extendSubscription(data, action, today);
    else if (['freeze', 'unfreeze'].includes(action.type)) {
      const original=data.attendance;
      data.attendance=copy(original);
      for(const key of Object.keys(data.legacyLinks)) delete data.attendance[key.slice(0,10)]?.[key.slice(11)];
      for(const [key,entries] of Object.entries(data.visits)) {
        const w=workoutOf(data,key);
        for(const [cid,status] of Object.entries(entries)) (data.attendance[w.date] ||= {})[cid]=status;
      }
      changeFreeze(data, action, today); data.attendance=original;
    }
    else if (action.type === 'rentMonth') {
      const entry = { version: 1, zarya: action.zarya, pole: action.pole };
      validateRent(action.month, entry);
      (data.rentMonths ||= {})[action.month] = copy(entry);
    } else if (action.type === "attendance") {
      if(Object.keys(data.visits).length || Object.keys(data.workouts).length || Object.keys(data.legacyLinks).length) throw fail('Выберите конкретную тренировку.');
      attendance(data, action, today);
    }
    else if (action.type === "client") {
      const { name, phone, locations } = action.form;
      if (
        typeof name !== "string" ||
        !name.trim() ||
        typeof phone !== "string" ||
        !Array.isArray(locations) ||
        locations.some((loc) => !Object.hasOwn(prices, loc))
      )
        throw fail("Укажите имя и корректные локации клиента.");
      if (action.editingId != null)
        Object.assign(clientOf(data, action.editingId), {
          name: name.trim(),
          phone,
          locations: [...locations],
        });
      else
        data.clients.push({
          id: action.newId || id(),
          name: name.trim(),
          phone,
          locations: [...locations],
        });
    } else if (['archiveClient','restoreClient'].includes(action.type)) {
      const c = clientOf(data,action.clientId);
      if (action.confirmName !== c.name) throw fail('Подтвердите имя клиента.');
      if (action.type === 'archiveClient') c.archivedAt = today;
      else delete c.archivedAt;
    } else if (action.type === "deleteClient") {
      const c = clientOf(data,action.clientId);
      if (action.confirmName !== c.name || action.confirmPhrase !== 'УДАЛИТЬ НАВСЕГДА')
        throw fail('Удаление не подтверждено.');
      deletionPlan(data, c.id);
      for (const map of ['attendance','attendanceOps','visits','visitOps'])
        for (const entries of Object.values(data[map])) delete entries[c.id];
      for (const map of ['legacyLinks','legacySources'])
        for (const key of Object.keys(data[map])) if (key.slice(11) === String(c.id)) delete data[map][key];
      data.clients = data.clients.filter((item) => item.id !== c.id);
    } else if (action.type === 'deleteRentMonth') {
      if (!Object.hasOwn(data.rentMonths, action.month)) throw fail('Месяц аренды отсутствует.');
      delete data.rentMonths[action.month];
    } else if (action.type === 'financeMonth') {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(action.month) || !Number.isFinite(action.amount) || action.amount < 0 || action.amount > 100000000) throw fail('Некорректная сумма месяца.');
      if(data.clients.some(c=>ledger(c).some(e=>e.date.slice(0,7)===action.month))) throw fail('Месяц содержит денежные операции. Прямая замена итога запрещена.');
      const actual = data.finances[action.month] ?? 0;
      if (action.expected !== actual) throw fail('Финансы изменились. Обновите данные.');
      if (action.remove) {
        if(actual !== 0) throw fail('Удалить можно только нулевой итог месяца.');
        delete data.finances[action.month];
      } else data.finances[action.month] = action.amount;
    } else if (['editSubscription','cancelSubscription'].includes(action.type)) {
      const c=clientOf(data,action.clientId), sub=c.subscriptions?.find(s=>s.id===action.subscriptionId);
      if(!sub || fingerprint(sub)!==action.expected) throw fail('Абонемент изменился. Откройте заново.');
      const linked = [data.attendanceOps,data.visitOps].some(map=>Object.values(map).some(entries=>Object.values(entries).some(op=>op.subscriptionId===sub.id)));
      if(sub.cancelledAt)throw fail('Продажа уже отменена.');
      if(sub.left!==8 || linked || sub.freezes?.length || sub.extensionDays) throw fail('Изменять или отменять можно только неиспользованный абонемент без заморозок и продлений.');
      dayNumber(sub.startDate);
      if(action.type==='cancelSubscription') {
        if(!sub.paymentId)throw fail('Сначала уточните способ старой оплаты.');
        cancelMoney(data,c,sub.paymentId,today);sub.left=0;sub.cancelledAt=today;
      } else {
        if(!sub.paymentId || action.price!==sub.price)throw fail('Изменение цены отключено. Для исправления оплаты отмените продажу и оформите заново.');
        dayNumber(action.date);sub.startDate=action.date;sub.expires=addDays(action.date,28);
      }
    } else if (action.type === "subscription") {
      const client = clientOf(data, action.clientId);
      if (client.archivedAt) throw fail('Клиент в архиве. Сначала восстановите его.');
      if (
        !["zarya", "pole"].includes(action.subscriptionType) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(action.date)
      )
        throw fail("Некорректный абонемент.");
      const price = action.subscriptionType === "zarya" ? 4400 : 3800;
      const date = new Date(action.date + "T00:00:00Z");
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== action.date
      )
        throw fail("Некорректная дата.");
      date.setUTCDate(date.getUTCDate() + 28);
      const subId=id();
      const paymentId=sell(data,client,action,price,subId,today);
      (client.subscriptions ||= []).push({
        id: subId,paymentId,
        left: 8,
        startDate: action.date,
        expires: date.toISOString().slice(0, 10),
        price,
      });

    } else throw fail("Неподдерживаемая операция.");
    return data;
  }
  function create({ db, auth, workspace, clock = localDate, beforeWrite }) {
    if (!workspace && db.offline !== true) throw fail('Требуется защищённый адаптер workspace.');
    const reference = uid => workspace ? workspace.reference() : db.collection('trainers').doc(uid);
    const validateSnapshot = snap => {
      if (!workspace) return;
      workspace.check();
      if (!snap.exists) throw fail('База не инициализирована');
      workspace.validate(snap.data());
    };
    let epoch = 0,
      loadId = 0,
      notify = () => {},
      unsubscribe,
      baseline = null;
    let state = {
      ...read(),
      currentUser: null,
      sessionEpoch: epoch,
      dataReady: false,
      loading: false,
      saving: false,
      syncError: "",
      saveStatus: "",
    };
    const publish = (patch) => {
      state = { ...state, ...patch };
      notify(state);
    };
    const token = () => ({
      epoch,
      uid: state.currentUser?.uid,
      revision: baseline && fingerprint(baseline),
    });
    function valid(t) {
      return (
        t &&
        t.epoch === epoch &&
        t.uid === state.currentUser?.uid &&
        t.uid === auth.currentUser?.uid
      );
    }
    function reset(user) {
      epoch++;
      loadId++;
      baseline = null;
      publish({
        ...read(),
        currentUser: user,
        authWarning: auth.persistenceWarning || '',
        sessionEpoch: epoch,
        dataReady: false,
        loading: false,
        saving: false,
        syncError: "",
        saveStatus: "",
      });
    }
    async function load() {
      if (state.saving) return false;
      const user = auth.currentUser;
      if (!user || user.uid !== state.currentUser?.uid) {
        reset(user || null);
        return false;
      }
      // A reload invalidates every open form/reference, not just the document snapshot.
      reset(user);
      const t = token(),
        request = ++loadId;
      publish({ loading: true });
      try {
        const snap = await reference(t.uid).get({ source: "server" });
        validateSnapshot(snap);
        if (!valid(t) || request !== loadId) return false;
        if (snap.metadata?.fromCache)
          throw fail("Нет подтверждённых данных сервера. Повторите загрузку.");
        baseline = read(snap.exists ? snap.data() : {});
        publish({ ...copy(baseline), dataReady: true, loading: false });
        return true;
      } catch (error) {
        if (valid(t) && request === loadId)
          publish({
            loading: false,
            dataReady: false,
            syncError:
              "Не удалось загрузить данные. Запись заблокирована. " +
              error.message,
          });
        return false;
      }
    }
    async function run(action, expected) {
      const t = expected || token();
      if (state.saving) return false;
      if (
        !valid(t) ||
        !state.dataReady ||
        state.loading ||
        state.saving ||
        !baseline ||
        t.revision !== fingerprint(baseline)
      ) {
        publish({
          syncError:
            "Операция недоступна. Дождитесь загрузки или обновите данные текущего аккаунта.",
          saveStatus: "",
        });
        return false;
      }
      const base = copy(baseline),
        frozen = copy(action);
      const operationDay = clock();
      try { reduce(base, frozen, operationDay); }
      catch(error) {publish({syncError:'Не сохранено. '+error.message,saveStatus:''});return false;}
      publish({ saving: true, syncError: "", saveStatus: "" });
      try {
        const ref = reference(t.uid);
        if (workspace && !workspace.local) {
          if (!beforeWrite) throw fail('Нет хранилища резервных копий. Запись заблокирована.');
          const snapshot = await ref.get({source:'server'});
          validateSnapshot(snapshot);
          if (!valid(t) || fingerprint(read(snapshot.data())) !== fingerprint(base))
            throw fail('Данные сервера изменились. Обновите их перед повтором.', 'conflict');
          await beforeWrite(snapshot.data());
          if (!valid(t)) throw fail('Сессия изменилась.', 'session');
        }
        const committed = await db.runTransaction(async (tx) => {
          if (!valid(t))
            throw fail("Аккаунт изменился. Операция отменена.", "session");
          if (clock() !== operationDay) throw fail("Дата изменилась. Повторите операцию после обновления.");
          const snap = await tx.get(ref);
          if (clock() !== operationDay) throw fail("Дата изменилась. Повторите операцию после обновления.");
          validateSnapshot(snap);
          const raw = snap.exists ? snap.data() : {};
          if (fingerprint(read(raw)) !== fingerprint(base))
            throw fail(
              "Данные изменены в другой вкладке. Обновите их перед повтором.",
              "conflict",
            );
          if (!valid(t))
            throw fail("Аккаунт изменился. Операция отменена.", "session");
          const candidate = reduce(base, frozen, operationDay);
          const next = {
            ...candidate,
            _fitppRevision: base._fitppRevision + 1,
          };
          if (workspace) workspace.validate({ ...raw, ...next });
          // Replace the complete confirmed maps; omission of a visit really removes it.
          // Preserve every unrelated top-level field from the transaction snapshot.
          tx.set(ref, { ...raw, ...next });
          return next;
        });
        if (!valid(t)) return false;
        baseline = copy(committed);
        publish({
          ...copy(committed),
          saving: false,
          saveStatus: workspace && !workspace.local ? "Сохранено" : "Сохранено только в памяти просмотра",
        });
        return true;
      } catch (error) {
        if (valid(t))
          publish({
            saving: false,
            dataReady: false,
            syncError: "Не сохранено. " + error.message,
            saveStatus: "",
          });
        return false;
      }
    }
    return {
      token,
      run,
      load,
      start(callback) {
        notify = callback;
        if (unsubscribe) return;
        unsubscribe = auth.onAuthStateChanged((user) => {
          reset(user);
          if (user) void load();
        });
      },
      async logout() {
        reset(null); // Immediately discard references, even when signOut fails.
        try {
          await auth.signOut();
        } catch (error) {
          publish({
            currentUser: auth.currentUser,
            syncError:
              "Ошибка выхода. Данные скрыты; повторите выход. " + error.message,
          });
        }
      },
      stop() {
        unsubscribe?.();
        unsubscribe = null;
        reset(null);
      },
    };
  }
  return { balance, report, legacyPayments, ledger, extensionRemaining, subscriptionTitle, deletionPlan, subscriptionWarnings, create, read, reduce, prices, fingerprint, rentDates, rentTotal, localDate, dayNumber, addDays, frozenOn, freezeStart, pendingFreeze, schedule, workoutsOn, migrate, unresolved };
});
