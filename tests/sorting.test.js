import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, emptyState, addGroup, start } from '../public/src/model.js';
import { SORTS, sortTimers, applySort, sortLabel } from '../public/src/sorting.js';

const NOW = 1000000;
// ids double as the expected order markers in the assertions below.
function fixture() {
  let state = addGroup(addGroup(emptyState(), 'g1', 'ならB'), 'g2', 'あとA');
  const timer = (id, over) => ({ ...createTimer(id, id), ...over });
  state = {
    ...state,
    timers: [
      timer('item10', { name: '項目10', color: 'rose', elapsedMs: 5000, targetMs: 10000, groupId: 'g1' }),
      timer('item2', { name: '項目2', color: 'mint', elapsedMs: 30000, targetMs: 0, groupId: null }),
      timer('running', { name: 'あ', color: 'amber', elapsedMs: 1000, startedAt: NOW - 4000, targetMs: 100000, groupId: 'g2' }),
      timer('tie1', { name: 'ん', color: 'blue', elapsedMs: 30000, targetMs: 60000, groupId: null }),
      timer('tie2', { name: 'ン', color: 'blue', elapsedMs: 30000, targetMs: 120000, groupId: 'g2' }),
    ],
  };
  return state;
}
const order = timers => timers.map(t => t.id);

test('every offered sort key produces an order, and manual leaves it untouched', () => {
  const state = fixture();
  assert.equal(sortTimers(state, 'manual', NOW), state.timers);
  assert.equal(sortTimers(state, 'unknown-key', NOW), state.timers);
  for (const { key } of SORTS) assert.equal(sortTimers(state, key, NOW).length, state.timers.length, key);
  assert.equal(sortLabel('time-desc'), '累計時間：長い順');
});

test('name order is Japanese aware and treats digits numerically', () => {
  const state = fixture();
  // Kana sort before kanji, 項目2 before 項目10 (numeric), and ん/ン compare equal so they stay in list order.
  assert.deepEqual(order(sortTimers(state, 'name-asc', NOW)), ['running', 'tie1', 'tie2', 'item2', 'item10']);
  assert.deepEqual(order(sortTimers(state, 'name-desc', NOW)), ['item10', 'item2', 'tie1', 'tie2', 'running']);
});

test('time order counts the running timer at its current value', () => {
  const state = fixture();
  // running holds 1000ms plus the 4000ms since it started, which ties it with item10 at 5000ms.
  assert.deepEqual(order(sortTimers(state, 'time-desc', NOW)), ['item2', 'tie1', 'tie2', 'item10', 'running']);
  assert.deepEqual(order(sortTimers(state, 'time-asc', NOW)), ['item10', 'running', 'item2', 'tie1', 'tie2']);
});

test('equal values keep the order they already had', () => {
  const state = fixture();
  // item2, tie1 and tie2 all hold 30000ms and must stay in list order in both directions.
  assert.deepEqual(order(sortTimers(state, 'time-desc', NOW)).slice(0, 3), ['item2', 'tie1', 'tie2']);
  const reversed = { ...state, timers: [...state.timers].reverse() };
  assert.deepEqual(order(sortTimers(reversed, 'time-desc', NOW)).slice(0, 3), ['tie2', 'tie1', 'item2']);
  assert.deepEqual(order(sortTimers(state, 'color', NOW)), ['item2', 'tie1', 'tie2', 'item10', 'running']);
});

test('state, group and progress orders follow their documented placement', () => {
  const state = fixture();
  assert.deepEqual(order(sortTimers(state, 'running-first', NOW)).slice(0, 1), ['running']);
  assert.deepEqual(order(sortTimers(state, 'stopped-first', NOW)).slice(-1), ['running']);
  // グループ名順: あとA then ならB, 未分類 last, ties stable.
  assert.deepEqual(order(sortTimers(state, 'group', NOW)), ['running', 'tie2', 'item10', 'item2', 'tie1']);
  // 目標なし (item2) is last in both progress directions.
  assert.equal(order(sortTimers(state, 'progress-desc', NOW)).at(-1), 'item2');
  assert.equal(order(sortTimers(state, 'progress-asc', NOW)).at(-1), 'item2');
  assert.deepEqual(order(sortTimers(state, 'progress-desc', NOW)).slice(0, 2), ['item10', 'tie1']);
  assert.deepEqual(order(sortTimers(state, 'progress-asc', NOW)).slice(0, 2), ['running', 'tie2']);
});

test('applying a sort returns a new state and never drops or duplicates a timer', () => {
  const state = fixture();
  for (const { key } of SORTS) {
    const next = applySort(state, key, NOW);
    assert.deepEqual([...order(next.timers)].sort(), [...order(state.timers)].sort(), key);
    assert.deepEqual(next.groups, state.groups);
    assert.equal(next.version, state.version);
  }
  assert.deepEqual(order(fixture().timers), order(state.timers), 'sorting must not mutate the input');
});
