const { create } = require("../persistence.js");
const clone = (value) => structuredClone(value);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function database(initial = {}) {
  const docs = new Map(
    Object.entries(initial).map(([key, value]) => [key, clone(value)]),
  );
  const versions = new Map();
  const db = {
    docs,
    writes: [],
    reads: [],
    failLoad: null,
    failSave: null,
    loadGate: null,
    commitGate: null,
    collection(name) {
      if (name !== "trainers") throw Error("unexpected collection");
      return {
        doc: (uid) => ({
          uid,
          async get(options) {
            db.reads.push({ uid, options });
            const captured = clone(docs.get(uid));
            if (db.loadGate) await db.loadGate.promise;
            if (db.failLoad) throw db.failLoad;
            return {
              exists: captured !== undefined,
              data: () => captured,
              metadata: { fromCache: false },
            };
          },
        }),
      };
    },
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 5; attempt++) {
        let snapshotVersion, uid, pending;
        const result = await callback({
          async get(ref) {
            uid = ref.uid;
            snapshotVersion = versions.get(uid) || 0;
            const data = clone(docs.get(uid));
            return { exists: data !== undefined, data: () => data };
          },
          set(ref, data) {
            if (ref.uid !== uid) throw Error("wrong account");
            pending = clone(data);
          },
        });
        if (db.commitGate) await db.commitGate.promise;
        if (db.failSave) throw db.failSave;
        if ((versions.get(uid) || 0) !== snapshotVersion) continue;
        docs.set(uid, pending);
        versions.set(uid, snapshotVersion + 1);
        db.writes.push({ uid, data: clone(pending) });
        return result;
      }
      throw Error("too much contention");
    },
  };
  return db;
}
function authentication(uid = "A") {
  const callbacks = new Set();
  return {
    currentUser: uid ? { uid } : null,
    onAuthStateChanged(callback) {
      callbacks.add(callback);
      queueMicrotask(() => callback(this.currentUser));
      return () => callbacks.delete(callback);
    },
    switch(uid) {
      this.currentUser = uid ? { uid } : null;
      for (const callback of callbacks) callback(this.currentUser);
    },
    async signOut() {
      this.switch(null);
    },
    async signInWithEmailAndPassword() {},
  };
}
async function session(db, auth = authentication()) {
  let state;
  const store = create({ db, auth });
  store.start((next) => {
    state = next;
  });
  await tick();
  return {
    store,
    auth,
    get state() {
      return state;
    },
  };
}
const fixture = () => ({
  clients: [
    {
      id: 1,
      name: "Тестовый клиент",
      phone: "",
      locations: ["online", "zarya"],
      subscriptions: [
        { left: 1, expires: "2026-11-01" },
        { left: 8, expires: "2026-12-01" },
      ],
      custom: "keep",
    },
  ],
  attendance: {},
  finances: { "2026-10": 1000 },
  unrelated: { keep: true },
});
const attend = (status = "attended", location = "online") => ({
  type: "attendance",
  clientId: 1,
  date: "2026-10-17",
  location,
  status,
});
module.exports = {
  database,
  authentication,
  session,
  fixture,
  attend,
  deferred,
  tick,
};
