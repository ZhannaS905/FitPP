const { test } = require("node:test");
const assert = require("node:assert/strict");
const { read, reduce, prices } = require("../persistence.js");
const {
  database,
  authentication,
  session,
  fixture,
  attend,
  deferred,
  tick,
} = require("./helpers.cjs");

test("prices are 700 / 600 / 500 and client without subscription is accepted", () => {
  assert.deepEqual(prices, { zarya: 700, pole: 600, online: 500 });
  assert.equal(read({ clients: [{ id: 1 }] }).clients.length, 1);
});
test("load is read-only, server-only and compatible with missing metadata", async () => {
  const db = database({ A: fixture() });
  const s = await session(db);
  assert.equal(s.state.dataReady, true);
  assert.equal(s.state._fitppRevision, 0);
  assert.deepEqual(db.reads[0].options, { source: "server" });
  assert.equal(db.writes.length, 0);
  assert.deepEqual(db.docs.get("A"), fixture());
});
test("writes are denied before successful load and after a failed load", async () => {
  const db = database({ A: fixture() });
  db.loadGate = deferred();
  const s = await session(db);
  assert.equal(s.state.loading, true);
  assert.equal(await s.store.run(attend()), false);
  assert.equal(db.writes.length, 0);
  db.failLoad = Error("permission denied");
  db.loadGate.resolve();
  await tick();
  assert.equal(s.state.dataReady, false);
  assert.match(s.state.syncError, /permission denied/);
  assert.equal(await s.store.run(attend()), false);
  assert.equal(db.writes.length, 0);
});
test("failed loads can be retried without writing or changing existing data", async () => {
  const db = database({ A: fixture() });
  db.failLoad = Error("unavailable");
  const s = await session(db);
  db.failLoad = null;
  assert.equal(await s.store.load(), true);
  assert.equal(s.state.clients.length, 1);
  assert.equal(db.writes.length, 0);
});
test("logout clears all loaded state and invalidates captured form tokens", async () => {
  const db = database({ A: fixture(), B: fixture() });
  const s = await session(db);
  const token = s.store.token();
  await s.store.logout();
  assert.equal(s.state.currentUser, null);
  assert.deepEqual(s.state.clients, []);
  assert.deepEqual(s.state.attendance, {});
  assert.equal(s.state.dataReady, false);
  s.auth.switch("B");
  await tick();
  assert.equal(await s.store.run(attend(), token), false);
  assert.equal(db.writes.length, 0);
});
test("late account A load cannot replace account B data", async () => {
  const a = fixture(),
    b = fixture();
  b.clients[0].name = "Account B";
  const db = database({ A: a, B: b });
  db.loadGate = deferred();
  const gate = db.loadGate;
  const s = await session(db);
  db.loadGate = null;
  s.auth.switch("B");
  await tick();
  gate.resolve();
  await tick();
  assert.equal(s.state.currentUser.uid, "B");
  assert.equal(s.state.clients[0].name, "Account B");
});
test("last-session undo restores the exact source subscription after reload", async () => {
  const db = database({ A: fixture() });
  const s = await session(db);
  assert.equal(await s.store.run(attend()), true);
  assert.deepEqual(
    s.state.clients[0].subscriptions.map((x) => x.left),
    [0, 8],
  );
  const source = s.state.attendanceOps["2026-10-17"]["1"].subscriptionId;
  assert.equal(source, s.state.clients[0].subscriptions[0].id);
  await s.store.load();
  assert.equal(await s.store.run(attend()), true);
  assert.deepEqual(
    s.state.clients[0].subscriptions.map((x) => x.left),
    [1, 8],
  );
});
test("cancellation replaces Firestore maps and stays cancelled after reload with other clients present", async () => {
  const data = fixture();
  data.attendance["2026-10-17"] = { 2: "excused" };
  const db = database({ A: data });
  const s = await session(db);
  await s.store.run(attend());
  await s.store.run(attend());
  await s.store.load();
  assert.deepEqual(s.state.attendance["2026-10-17"], { 2: "excused" });
  assert.deepEqual(s.state.attendanceOps["2026-10-17"], {});
  assert.deepEqual(db.docs.get("A").unrelated, { keep: true });
});
test("single payments retain original price and location; undo in different location refunds exact sum", async () => {
  const db = database({ A: fixture() });
  const s = await session(db);
  await s.store.run(attend("razov", "online"));
  assert.equal(s.state.finances["2026-10"], 1500);
  assert.equal(s.state.attendanceOps["2026-10-17"]["1"].price, 500);
  assert.equal(s.state.attendanceOps["2026-10-17"]["1"].location, "online");
  await s.store.load();
  await s.store.run(attend("razov", "zarya"));
  assert.equal(s.state.finances["2026-10"], 1000);
});
test("status transitions refund their source and charge the new operation once", async () => {
  const db = database({ A: fixture() });
  const s = await session(db);
  await s.store.run(attend());
  await s.store.run(attend("razov", "pole"));
  assert.equal(s.state.clients[0].subscriptions[0].left, 1);
  assert.equal(s.state.finances["2026-10"], 1600);
  await s.store.run(attend("excused", "zarya"));
  assert.equal(s.state.finances["2026-10"], 1000);
});
test("legacy attended and paid records remain readable and block ambiguous reversal without writes", async () => {
  for (const status of ["attended", "razov"]) {
    const data = fixture();
    data.attendance["2026-10-17"] = { 1: status };
    const db = database({ A: data });
    const s = await session(db);
    assert.equal(s.state.attendance["2026-10-17"]["1"], status);
    assert.equal(await s.store.run(attend(status)), false);
    assert.match(s.state.syncError, /старой записи/);
    assert.deepEqual(db.docs.get("A"), data);
    assert.equal(db.writes.length, 0);
  }
});
test("legacy non-financial marks can be cancelled and unrelated history is retained", async () => {
  const data = fixture();
  data.attendance["2026-10-17"] = { 1: "excused", 2: "missed" };
  const db = database({ A: data });
  const s = await session(db);
  assert.equal(await s.store.run(attend("excused")), true);
  assert.deepEqual(s.state.attendance["2026-10-17"], { 2: "missed" });
});
test("stale second tab cannot overwrite another tab; reload allows explicit retry", async () => {
  const db = database({ A: fixture() });
  const a = await session(db),
    b = await session(db);
  await a.store.run(attend("razov"));
  assert.equal(await b.store.run(attend("missed")), false);
  assert.match(b.state.syncError, /другой вкладке/);
  assert.equal(db.docs.get("A").attendance["2026-10-17"]["1"], "razov");
  await b.store.load();
  assert.equal(await b.store.run(attend("excused")), true);
  assert.equal(db.docs.get("A").finances["2026-10"], 1000);
});
test("simultaneous transactions cannot silently win over each other", async () => {
  const db = database({ A: fixture() });
  const a = await session(db),
    b = await session(db);
  const result = await Promise.all([
    a.store.run(attend("razov")),
    b.store.run(attend("missed")),
  ]);
  assert.equal(result.filter(Boolean).length, 1);
  assert.equal(db.writes.length, 1);
});
test("legacy writer changing data without incrementing revision is detected", async () => {
  const db = database({ A: fixture() });
  const s = await session(db);
  db.docs.get("A").clients.push({ id: 2, name: "Other tab" });
  assert.equal(await s.store.run(attend()), false);
  assert.equal(db.writes.length, 0);
  assert.equal(db.docs.get("A").clients.length, 2);
});
test("saving is not reported as successful before server acknowledgement; duplicate click blocked", async () => {
  const db = database({ A: fixture() });
  const s = await session(db);
  db.commitGate = deferred();
  const pending = s.store.run(attend());
  await tick();
  assert.equal(s.state.saving, true);
  assert.equal(s.state.saveStatus, "");
  assert.equal(s.state.clients[0].subscriptions[0].left, 1);
  assert.equal(await s.store.run(attend()), false);
  db.commitGate.resolve();
  assert.equal(await pending, true);
  assert.equal(s.state.saveStatus, "Сохранено в Firebase");
});
test("server rejection leaves data untouched, shows error and requires reload", async () => {
  const db = database({ A: fixture() });
  const s = await session(db);
  db.failSave = Error("permission-denied");
  assert.equal(await s.store.run(attend()), false);
  assert.match(s.state.syncError, /permission-denied/);
  assert.equal(s.state.saveStatus, "");
  assert.equal(s.state.saving, false);
  assert.equal(s.state.dataReady, false);
  assert.deepEqual(db.docs.get("A"), fixture());
  assert.deepEqual(s.state.clients, fixture().clients);
});
test("in-flight account A write never changes account B state or document", async () => {
  const db = database({ A: fixture(), B: fixture() });
  const s = await session(db);
  db.commitGate = deferred();
  const pending = s.store.run(attend());
  await tick();
  s.auth.switch("B");
  await tick();
  db.commitGate.resolve();
  await pending;
  assert.equal(s.state.currentUser.uid, "B");
  assert.equal(s.state.clients[0].subscriptions[0].left, 1);
  assert.deepEqual(db.docs.get("B"), fixture());
});
test("source subscription missing or failed new attendance leaves the whole operation unchanged", () => {
  const data = read(fixture());
  data.clients[0].subscriptions.forEach((s) => {
    s.left = 0;
  });
  assert.throws(() => reduce(data, attend()), /нет доступных/);
  assert.deepEqual(data.attendance, {});
});
test("subscription sale retains 8 sessions, 28 days, tariff and all unrelated fields", async () => {
  for (const [type, price] of [
    ["zarya", 4400],
    ["pole", 3800],
  ]) {
    const db = database({ A: fixture() });
    const s = await session(db);
    assert.equal(
      await s.store.run({
        type: "subscription",
        clientId: 1,
        subscriptionType: type,
        date: "2026-10-17",
      }),
      true,
    );
    const sub = s.state.clients[0].subscriptions.at(-1);
    assert.equal(sub.left, 8);
    assert.equal(sub.expires, "2026-11-14");
    assert.equal(sub.price, price);
    assert.ok(sub.id);
    assert.equal(s.state.finances["2026-10"], 1000 + price);
    assert.deepEqual(db.docs.get("A").unrelated, { keep: true });
  }
});
test("invalid document shape is never silently replaced with defaults", async () => {
  const db = database({ A: { clients: "broken" } });
  const s = await session(db);
  assert.equal(s.state.dataReady, false);
  assert.equal(await s.store.run(attend()), false);
  assert.equal(db.writes.length, 0);
});

test("invalid metadata cannot refund from a duplicate or removed subscription", async () => {
  const data = fixture();
  data.clients[0].subscriptions = [
    { id: "duplicate", left: 0 },
    { id: "duplicate", left: 8 },
  ];
  data.attendance["2026-10-17"] = { 1: "attended" };
  data.attendanceOps = {
    "2026-10-17": { 1: { status: "attended", subscriptionId: "duplicate" } },
  };
  const db = database({ A: data });
  const s = await session(db);
  assert.equal(await s.store.run(attend()), false);
  assert.deepEqual(db.docs.get("A"), data);
});
test("unknown visit formats and duplicate client IDs are blocked without destructive defaults", async () => {
  const data = fixture();
  data.clients.push({ ...data.clients[0] });
  const db = database({ A: data });
  const s = await session(db);
  assert.equal(s.state.dataReady, false);
  assert.equal(db.writes.length, 0);
  const input = read(fixture());
  input.attendance["2026-10-17"] = { 1: { status: "attended" } };
  assert.throws(() => reduce(input, attend()), /формат посещения/);
});

test("editing profile preserves existing subscriptions and unknown client/document fields", async () => {
  const db = database({ A: fixture() });
  const s = await session(db);
  const before = structuredClone(s.state.clients[0].subscriptions);
  assert.equal(
    await s.store.run({
      type: "client",
      editingId: 1,
      form: { name: "Updated", phone: "", locations: ["online"] },
    }),
    true,
  );
  await s.store.load();
  assert.deepEqual(s.state.clients[0].subscriptions, before);
  assert.equal(s.state.clients[0].custom, "keep");
  assert.deepEqual(db.docs.get("A").unrelated, { keep: true });
});
test("reload invalidates an open form even for the same uid", async () => {
  const db = database({ A: fixture() });
  const s = await session(db);
  const stale = s.store.token();
  await s.store.load();
  assert.equal(await s.store.run(attend(), stale), false);
  assert.equal(db.writes.length, 0);
});
