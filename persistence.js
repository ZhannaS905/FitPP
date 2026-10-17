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
  function read(raw = {}) {
    const data = {
      clients: raw.clients ?? [],
      attendance: raw.attendance ?? {},
      finances: raw.finances ?? {},
      attendanceOps: raw.attendanceOps ?? {},
      _fitppRevision: raw._fitppRevision ?? 0,
    };
    if (
      !Array.isArray(data.clients) ||
      !plain(data.attendance) ||
      !plain(data.finances) ||
      !plain(data.attendanceOps) ||
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
    return copy(data);
  }
  function clientOf(data, clientId) {
    const client = data.clients.find((c) => c.id === clientId);
    if (!client)
      throw fail("Клиент отсутствует в текущем аккаунте. Обновите данные.");
    return client;
  }
  function income(data, month, amount) {
    const next = (data.finances[month] || 0) + amount;
    if (!Number.isFinite(next) || next < 0)
      throw fail(
        "Сумма возврата не соответствует финансовым данным. Изменение отменено.",
      );
    data.finances[month] = next;
  }
  function attendance(data, { clientId, date, location, status }) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Object.hasOwn(prices, location) ||
      !["attended", "razov", "missed", "excused"].includes(status)
    )
      throw fail("Некорректная отметка посещения.");
    const client = clientOf(data, clientId);
    const day = (data.attendance[date] ||= {});
    const ops = (data.attendanceOps[date] ||= {});
    const previous = Object.hasOwn(day, clientId) ? day[clientId] : undefined;
    if (
      previous !== undefined &&
      !["attended", "razov", "missed", "excused"].includes(previous)
    )
      throw fail("Неизвестный формат посещения. Запись не изменена.");
    const operation = ops[clientId];
    if (["attended", "razov"].includes(previous)) {
      if (!operation || operation.status !== previous)
        throw fail(
          "В старой записи нет исходного абонемента или суммы. Автоматическая отмена небезопасна; нужна сверка истории.",
          "legacy",
        );
      if (previous === "attended") {
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
        income(data, date.slice(0, 7), -operation.price);
      }
    }
    if (previous === status) {
      delete day[clientId];
      delete ops[clientId];
      return;
    }
    const next = { status, location, operationId: id() };
    if (status === "attended") {
      const sub = client.subscriptions?.find(
        (s) => Number.isFinite(s.left) && s.left > 0,
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
      income(data, date.slice(0, 7), next.price);
    }
    day[clientId] = status; // Keep the original string format for existing readers.
    ops[clientId] = next;
  }
  function reduce(input, action) {
    const data = copy(input);
    if (action.type === "attendance") attendance(data, action);
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
    } else if (action.type === "deleteClient") {
      clientOf(data, action.clientId);
      data.clients = data.clients.filter((c) => c.id !== action.clientId);
    } else if (action.type === "subscription") {
      const client = clientOf(data, action.clientId);
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
      (client.subscriptions ||= []).push({
        id: id(),
        left: 8,
        startDate: action.date,
        expires: date.toISOString().slice(0, 10),
        price,
      });
      income(data, action.date.slice(0, 7), price);
    } else throw fail("Неподдерживаемая операция.");
    return data;
  }
  function create({ db, auth }) {
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
        const snap = await db
          .collection("trainers")
          .doc(t.uid)
          .get({ source: "server" });
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
      publish({ saving: true, syncError: "", saveStatus: "" });
      try {
        const candidate = reduce(base, frozen);
        const ref = db.collection("trainers").doc(t.uid);
        const committed = await db.runTransaction(async (tx) => {
          if (!valid(t))
            throw fail("Аккаунт изменился. Операция отменена.", "session");
          const snap = await tx.get(ref);
          const raw = snap.exists ? snap.data() : {};
          if (fingerprint(read(raw)) !== fingerprint(base))
            throw fail(
              "Данные изменены в другой вкладке. Обновите их перед повтором.",
              "conflict",
            );
          if (!valid(t))
            throw fail("Аккаунт изменился. Операция отменена.", "session");
          const next = {
            ...candidate,
            _fitppRevision: base._fitppRevision + 1,
          };
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
          saveStatus: "Сохранено в Firebase",
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
  return { create, read, reduce, prices, fingerprint };
});
