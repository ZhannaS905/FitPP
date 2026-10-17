const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const FitPPStore = require("../persistence.js");
const { database, authentication, fixture, tick } = require("./helpers.cjs");
function ui(db, auth) {
  const html = readFileSync(`${__dirname}/../index.html`, "utf8");
  const js = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .join("\n");
  const ctx = vm.createContext({
    FitPPStore,
    firebase: { initializeApp() {}, firestore: () => db, auth: () => auth },
    console: { error() {} },
    confirm: () => false,
  });
  vm.runInContext(js, ctx);
  return ctx.trainerApp();
}
test("UI resets detail, edits, subscription forms, credentials and old references on account switch", async () => {
  const db = database({ A: fixture(), B: fixture() }),
    auth = authentication(),
    app = ui(db, auth);
  app.init();
  app.init();
  await tick();
  assert.equal(
    db.reads.length,
    1,
    "only one auth listener despite Alpine init+x-init",
  );
  const old = app.clients[0];
  app.openClientDetail(old);
  app.editClient(old);
  app.openSubModal(old);
  app.authForm = { email: "old@example.test", password: "test-only" };
  auth.switch("B");
  await tick();
  assert.equal(app.detailClient, null);
  assert.equal(app.editingClient, null);
  assert.equal(app.subClient, null);
  assert.equal(app.showClientModal, false);
  assert.equal(app.showSubModal, false);
  assert.equal(app.authForm.password, "");
  app.openClientDetail(old);
  app.openSubModal(old);
  app.editClient(old);
  assert.equal(app.detailClient, null);
  assert.equal(app.subClient, null);
  assert.equal(app.editingClient, null);
  await app.saveClient();
  await app.saveSubscription();
  assert.equal(db.writes.length, 0);
});
test("UI clears private client detail on logout and closes forms immediately", async () => {
  const db = database({ A: fixture() }),
    auth = authentication(),
    app = ui(db, auth);
  app.init();
  await tick();
  app.openClientDetail(app.clients[0]);
  app.openSubModal(app.clients[0]);
  await app.logout();
  assert.equal(app.detailClient, null);
  assert.equal(app.showSubModal, false);
  assert.equal(app.currentUser, null);
  assert.equal(app.clients.length, 0);
});
test("UI save failures remain visible and forms stay open without false success", async () => {
  const db = database({ A: fixture() }),
    auth = authentication(),
    app = ui(db, auth);
  app.init();
  await tick();
  app.editClient(app.clients[0]);
  app.clientForm.name = "Changed";
  db.failSave = Error("denied");
  await app.saveClient();
  assert.match(app.syncError, /denied/);
  assert.equal(app.saveStatus, "");
  assert.equal(app.showClientModal, true);
  assert.equal(db.docs.get("A").clients[0].name, "Тестовый клиент");
});

test("email/password auth flow remains available; failed sign-in is visible and success clears credentials", async () => {
  const db = database({ A: fixture() }),
    auth = authentication(null),
    app = ui(db, auth);
  app.init();
  await tick();
  app.showAuthModal = true;
  app.authForm = { email: "test@example.test", password: "fake-test-value" };
  auth.signInWithEmailAndPassword = async () => {
    throw Error("invalid-credential");
  };
  await app.handleAuth();
  assert.match(app.authError, /invalid-credential/);
  assert.equal(app.dataReady, false);
  auth.signInWithEmailAndPassword = async () => {
    auth.switch("A");
  };
  await app.handleAuth();
  await tick();
  assert.equal(app.dataReady, true);
  assert.equal(app.authForm.password, "");
  assert.equal(app.showAuthModal, false);
});
