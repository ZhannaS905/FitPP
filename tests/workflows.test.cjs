const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function app() {
  const html = readFileSync(`${__dirname}/../index.html`, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).join('\n');
  const context = vm.createContext({
    firebase: { initializeApp() {}, firestore() { return {}; } },
    confirm: () => false,
    console,
  });
  vm.runInContext(scripts, context);
  const state = context.trainerApp();
  state.selectedDate = '2026-10-17';
  state.currentMonth = '2026-10';
  state.clients = [{ id: 1, name: 'Тестовый клиент', locations: ['online'],
    subscriptions: [{ left: 3, expires: '2026-11-01' }] }];
  // Unsigned state: syncToFirebase returns before contacting any backend.
  return state;
}

test('single-session prices match all three locations', () => {
  const state = app();
  for (const [location, price] of [['zarya', 700], ['pole', 600], ['online', 500]]) {
    state.currentLocation = location;
    assert.equal(state.getRazovPrice(), price);
  }
});

test('clients without subscriptions display safely', () => {
  const state = app();
  assert.equal(state.getClientActiveSubscription({}), null);
  assert.equal(state.getClientSubInfo({}), 'Нет активного абонемента');
});

test('attendance consumes one session and a second click refunds it', () => {
  const state = app();
  state.markAttendance(1, 'attended');
  assert.equal(state.clients[0].subscriptions[0].left, 2);
  assert.equal(state.getAttendanceStatus(1), 'attended');
  state.markAttendance(1, 'attended');
  assert.equal(state.clients[0].subscriptions[0].left, 3);
  assert.equal(state.getAttendanceStatus(1), null);
});

test('changing attendance to a single payment restores session and cancellation refunds payment', () => {
  const state = app();
  state.currentLocation = 'online';
  state.markAttendance(1, 'attended');
  state.markAttendance(1, 'razov');
  assert.equal(state.clients[0].subscriptions[0].left, 3);
  assert.equal(state.getMonthIncome(), 500);
  state.markAttendance(1, 'razov');
  assert.equal(state.getMonthIncome(), 0);
  state.markAttendance(1, 'razov');
  state.markAttendance(1, 'excused');
  assert.equal(state.getMonthIncome(), 0);
  assert.equal(state.getAttendanceStatus(1), 'excused');
});

test('subscription sale retains 8 sessions, 28-day validity and existing prices', () => {
  for (const [type, price] of [['zarya', 4400], ['pole', 3800]]) {
    const state = app();
    state.openSubModal(state.clients[0]);
    state.subForm.type = type;
    state.saveSubscription();
    const sub = state.clients[0].subscriptions.at(-1);
    assert.equal(sub.left, 8);
    assert.equal(sub.expires, '2026-11-14');
    assert.equal(sub.price, price);
    assert.equal(state.getMonthIncome(), price);
  }
});
