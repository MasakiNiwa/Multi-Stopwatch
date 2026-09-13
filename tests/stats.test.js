import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, emptyState, addGroup, total } from '../public/src/model.js';
import { summarize, statsTick } from '../public/src/stats.js';

const NOW = 1000000;
function fixture() {
  let state = addGroup(addGroup(emptyState(), 'g1', '学習'), 'g2', '趣味');
  const timer = (id, over) => ({ ...createTimer(id, id), ...over });
  return {
    ...state,
    timers: [
      timer('a', { name: '資格', elapsedMs: 60000, groupId: 'g1' }),
      timer('b', { name: '読書', elapsedMs: 30000, groupId: 'g2' }),
      timer('c', { name: '開発', elapsedMs: 1000, startedAt: NOW - 9000, groupId: null }),
      timer('d', { name: '散歩', elapsedMs: 30000, groupId: 'g1' }),
    ],
  };
}

test('group subtotals add up to the overall total', () => {
  const s = summarize(fixture(), NOW);
  assert.equal(s.totalMs, 60000 + 30000 + 10000 + 30000);
  assert.equal(s.totalMs, total(fixture().timers, NOW));
  assert.equal(s.groups.reduce((sum, g) => sum + g.totalMs, 0), s.totalMs);
  assert.equal(s.groups.reduce((sum, g) => sum + g.timerCount, 0), s.timerCount);
  assert.equal(Math.abs(s.groups.reduce((sum, g) => sum + g.share, 0) - 1) < 1e-9, true);
  assert.deepEqual(s.groups.map(g => g.name), ['学習', '趣味', '未分類']);
  assert.equal(s.groups[0].totalMs, 90000);
  assert.equal(s.runningCount, 1);
  assert.equal(s.groups.find(g => g.id === null).runningCount, 1);
});

test('an empty group stays listed but 未分類 only appears when used', () => {
  const grouped = { ...fixture(), timers: fixture().timers.map(t => ({ ...t, groupId: 'g1' })) };
  const s = summarize(grouped, NOW);
  assert.deepEqual(s.groups.map(g => g.name), ['学習', '趣味']);
  assert.equal(s.groups.find(g => g.name === '趣味').timerCount, 0);
  assert.equal(s.groups.find(g => g.name === '趣味').share, 0);
});

test('ranking is ordered, shares add up, and ties share a rank', () => {
  const s = summarize(fixture(), NOW);
  assert.deepEqual(s.ranking.map(r => r.name), ['資格', '読書', '散歩', '開発']);
  assert.deepEqual(s.ranking.map(r => r.rank), [1, 2, 2, 4], '同着は同順位、次は席次分だけ飛ぶ');
  assert.deepEqual(s.ranking.map(r => r.groupName), ['学習', '趣味', '学習', '未分類']);
  assert.equal(Math.abs(s.ranking.reduce((sum, r) => sum + r.share, 0) - 1) < 1e-9, true);
  assert.equal(s.ranking[0].share, 60000 / 130000);
});

test('nothing recorded yet never produces NaN or Infinity', () => {
  for (const state of [emptyState(), { ...emptyState(), timers: [createTimer('a'), createTimer('b')] }]) {
    const s = summarize(state, NOW);
    assert.equal(s.totalMs, 0);
    assert.equal(s.runningCount, 0);
    for (const value of [...s.groups.map(g => g.share), ...s.ranking.map(r => r.share)]) {
      assert.equal(Number.isFinite(value), true);
      assert.equal(value, 0);
    }
    for (const row of s.ranking) assert.equal(row.rank, 1, 'すべて0秒なら全員同順位');
  }
  assert.deepEqual(summarize(emptyState(), NOW).groups, []);
  assert.deepEqual(summarize(emptyState(), NOW).ranking, []);
});

test('statistics recompute only when the second they display changes', () => {
  const base = { revision: 1, second: 1000, running: 1 };
  const first = statsTick(null, base);
  assert.equal(first.changed, true, '最初は必ず計算する');
  // The same displayed second over several 250ms ticks must not recompute.
  let marker = first.marker;
  for (let tick = 0; tick < 3; tick++) {
    const step = statsTick(marker, base);
    assert.equal(step.changed, false, `tick ${tick}`);
    marker = step.marker;
  }
  // The next displayed second recomputes once.
  const next = statsTick(marker, { ...base, second: 1001 });
  assert.equal(next.changed, true);
  // Nothing running: the displayed second cannot move, so nothing recomputes.
  assert.equal(statsTick(next.marker, { ...base, second: 1001, running: 0 }).changed, false);
  // A change to the records refreshes immediately, inside the same second.
  const edited = statsTick(next.marker, { ...base, revision: 2, second: 1001 });
  assert.equal(edited.changed, true);
  // So does an explicit request, such as switching to the statistics tab.
  assert.equal(statsTick(edited.marker, { ...base, revision: 2, second: 1001, force: true }).changed, true);
});
