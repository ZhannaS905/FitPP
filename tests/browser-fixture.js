// Browser-only fake Firebase; never contacts any service.
(() => {
  const clone = (value) => structuredClone(value);
  const make = (name) => ({
    clients: [
      {
        id: "same-id",
        name,
        phone: "",
        locations: ["online", "zarya", "pole"],
        subscriptions: [
          { left: 1, expires: "2026-12-01" },
          { left: 8, expires: "2026-12-10" },
        ],
      },
    ],
    attendance: {},
    finances: { "2026-10": 1000 },
  });
  const callbacks = new Set();
  const docs = { A: make("Тестовый клиент A"), B: make("Тестовый клиент B") };
  const fake = (globalThis.__fakeFirebase = {
    docs,
    writes: [],
    failSave: false,
    failLoad: false,
    holdCommit: false,
    release: null,
  });
  const auth = {
    currentUser: { uid: "A", email: "a@example.test" },
    onAuthStateChanged(callback) {
      callbacks.add(callback);
      queueMicrotask(() => callback(this.currentUser));
      return () => callbacks.delete(callback);
    },
    async signOut() {
      fake.switch(null);
    },
    async signInWithEmailAndPassword() {
      fake.switch("A");
    },
  };
  fake.switch = (uid) => {
    auth.currentUser = uid ? { uid, email: uid + "@example.test" } : null;
    for (const callback of callbacks) callback(auth.currentUser);
  };
  const db = {
    collection() {
      return {
        doc: (uid) => ({
          uid,
          async get(options) {
            if (options.source !== "server")
              throw Error("server read required");
            if (fake.failLoad) throw Error("TEST LOAD FAILURE");
            return {
              exists: true,
              data: () => clone(docs[uid]),
              metadata: { fromCache: false },
            };
          },
        }),
      };
    },
    async runTransaction(callback) {
      let pending;
      const result = await callback({
        async get(ref) {
          return { exists: true, data: () => clone(docs[ref.uid]) };
        },
        set(ref, data) {
          pending = { uid: ref.uid, data: clone(data) };
        },
      });
      if (fake.holdCommit)
        await new Promise((resolve) => {
          fake.release = resolve;
        });
      if (fake.failSave) throw Error("TEST SAVE FAILURE");
      docs[pending.uid] = pending.data;
      fake.writes.push(pending);
      return result;
    },
  };
  globalThis.firebase = {
    initializeApp() {},
    firestore: () => db,
    auth: () => auth,
  };
})();
