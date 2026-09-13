import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, createSet, emptyState, validate, migrate, elapsed, toggleItem, viewItem,
  removeItem, editItem, running, MAX_TIMERS, MAX_SETS } from '../public/src/model.js';
import { summarize } from '../public/src/stats.js';
import { applySort, SORTS } from '../public/src/sorting.js';
import { readState } from '../public/src/storage.js';

const big = () => {
  const timers = [];
  for (let p = 0; p < MAX_SETS; p++) {
    timers.push({ ...createSet(`s${p}`, `セット${p}`) });
    for (let c = 0; c < 5; c++) timers.push({ ...createTimer(`t${p}-${c}`, `子${p}-${c}`), parentId: `s${p}`, elapsedMs: (c + 1) * 60000 });
  }
  return { ...emptyState(), timers };
};
test('20 sets and 100 timers validate, aggregate and sort', () => {
  const s = big();
  assert.equal(s.timers.filter(t => t.kind === 'timer').length, MAX_TIMERS);
  assert.equal(s.timers.filter(t => t.kind === 'set').length, MAX_SETS);
  assert.doesNotThrow(() => validate(s));
  const stats = summarize(s, 0);
  assert.equal(stats.timerCount, MAX_TIMERS);
  assert.equal(stats.sets.length, MAX_SETS);
  assert.equal(stats.sets.reduce((sum, x) => sum + x.totalMs, 0), stats.totalMs, 'セット小計の合計＝全体');
  for (const { key } of SORTS) {
    const sorted = applySort(s, key, 0);
    assert.doesNotThrow(() => validate(sorted), key);
    assert.equal(sorted.timers.length, s.timers.length, key);
  }
  assert.throws(() => validate({ ...s, timers: [...s.timers, createTimer('over')] }), /対応していない/);
});
test('moving a running child between sets keeps one instant and one running timer', () => {
  let s = big();
  s = toggleItem(s, 't0-0', 1000);
  s = editItem(s, 't0-0', {}, 's1', 5000);
  const moved = s.timers.find(t => t.id === 't0-0');
  assert.equal(moved.parentId, 's1');
  assert.equal(moved.startedAt, 5000, '移動時刻から継続する');
  assert.equal(moved.elapsedMs, 60000 + 4000, '移動前の4秒を確定して持ち越す');
  // A set stores no startedAt at all, so counting has to go through running().
  assert.equal(running(s.timers), 1);
  assert.equal(s.timers.find(t => t.id === 's1').lastChildId, 't0-0');
  assert.doesNotThrow(() => validate(s));
});
test('deleting the last used child clears the pointer and the set stays startable', () => {
  let s = big();
  s = toggleItem(s, 't0-1', 1000);
  s = toggleItem(s, 't0-1', 2000);
  assert.equal(s.timers.find(t => t.id === 's0').lastChildId, 't0-1');
  s = removeItem(s, 't0-1');
  assert.equal(s.timers.find(t => t.id === 's0').lastChildId, null);
  assert.doesNotThrow(() => validate(s));
  assert.equal(toggleItem(s, 's0', 3000), s, '前回の子がなければ親は勝手に開始しない');
  assert.equal(viewItem(s, s.timers.find(t => t.id === 's0'), 3000).childNote, '子 4件');
});
test('a v1 record with many timers still migrates and keeps order and running state', () => {
  const v1 = { version: 1, timers: Array.from({ length: 60 }, (_, i) => ({
    id: `o${i}`, name: `旧${i}`, memo: '', color: 'mint', elapsedMs: i * 1000, startedAt: i === 3 ? 500 : null, targetMs: 0 })) };
  const v3 = readState(JSON.stringify(v1));
  assert.equal(v3.version, 3);
  assert.deepEqual(v3.timers.map(t => t.id), v1.timers.map(t => t.id));
  assert.equal(v3.timers[3].startedAt, 500);
  assert.equal(v3.timers.every(t => t.kind === 'timer' && t.parentId === null), true);
  assert.equal(elapsed(v3.timers[3], 1500), 3000 + 1000);
});
