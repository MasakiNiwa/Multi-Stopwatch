import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, createSet, emptyState, validate, migrate, elapsed, start, total, MAX_MS,
  childrenOf, siblingsOf, toggleItem, viewItem, removeItem, moveSibling, editItem, removeGroup } from '../public/src/model.js';
import { summarize } from '../public/src/stats.js';
import { applySort, SORTS } from '../public/src/sorting.js';
import { readState, save } from '../public/src/storage.js';
const fixture = () => ({ ...emptyState(), timers: [createSet('p', '資格'),
  { ...createTimer('a', '演習'), parentId: 'p' }, { ...createTimer('b', '復習'), parentId: 'p' },
  createSet('q', '仕事'), { ...createTimer('c', '設計'), parentId: 'q' }, createTimer('solo', '単独')] });
const by = (s, id) => s.timers.find(t => t.id === id);
test('v2 migration preserves every existing field, running start and ordering; v3 round trips', () => {
  const original = { version: 2, groups: [{ id: 'g', name: '学習' }], timers: [
    { id: 'old', name: '既存', memo: '大切', color: 'rose', targetMs: 8000, groupId: 'g', elapsedMs: 1234, startedAt: 10 }] };
  const next = readState(JSON.stringify(original));
  assert.equal(next.version, 3);
  assert.deepEqual(next.timers[0], { ...original.timers[0], kind: 'timer', parentId: null });
  assert.equal(migrate(next), next);
  assert.deepEqual(readState(JSON.stringify(next)), next);
  assert.equal(original.version, 2);
});
test('switching child commits one timestamp; other sets and standalone continue', () => {
  let s = toggleItem(fixture(), 'a', 1000);
  s = toggleItem(s, 'c', 1500); s = toggleItem(s, 'solo', 1800);
  s = validate(toggleItem(s, 'b', 4000));
  assert.equal(by(s, 'a').elapsedMs, 3000); assert.equal(by(s, 'a').startedAt, null);
  assert.equal(by(s, 'b').startedAt, 4000); assert.equal(by(s, 'c').startedAt, 1500);
  assert.equal(by(s, 'solo').startedAt, 1800); assert.equal(by(s, 'p').lastChildId, 'b');
  assert.equal(viewItem(s, by(s, 'p'), 5000).aggregateMs, 4000);
});
test('parent stops active child then resumes last; empty or unused parent does not auto-start', () => {
  let s = fixture(); assert.equal(toggleItem(s, 'p', 0), s);
  s = toggleItem(s, 'a', 1000); s = toggleItem(s, 'p', 2000);
  assert.equal(by(s, 'a').startedAt, null);
  s = validate(toggleItem(s, 'p', 4000));
  assert.equal(elapsed(by(s, 'a'), 5000), 2000);
  assert.equal(viewItem(s, by(s, 'p'), 5000).childNote, '計測中: 演習');
});
test('aggregate is derived, unclamped to one timer limit, excluded from totals and rank', () => {
  let s = fixture(); s.timers = s.timers.map(t => ['a','b'].includes(t.id) ? { ...t, elapsedMs: MAX_MS } : t);
  const projection = viewItem(s, by(s, 'p'), 0);
  assert.equal(elapsed(projection, 0), MAX_MS * 2);
  assert.equal(total(s.timers, 0), MAX_MS * 2);
  const stats = summarize(s, 0);
  assert.equal(stats.totalMs, MAX_MS * 2); assert.equal(stats.timerCount, 4);
  assert.equal(stats.ranking.some(t => t.id === 'p'), false);
  assert.equal(stats.sets[0].totalMs, MAX_MS * 2);
  assert.equal(stats.groups.reduce((sum, g) => sum + g.totalMs, 0), stats.totalMs);
  assert.throws(() => validate({ ...s, timers: s.timers.map(t => t.id === 'p' ? projection : t) }));
});
test('validation rejects orphan, nesting, invalid kinds, duplicate ids, dual running and foreign last child', () => {
  const changes = [
    s => { by(s, 'a').parentId = 'missing'; },
    s => { by(s, 'p').parentId = 'q'; },
    s => { by(s, 'a').parentId = 'b'; },
    s => { by(s, 'a').parentId = 'a'; },
    s => { by(s, 'a').kind = 'unknown'; },
    s => { by(s, 'b').id = 'a'; },
    s => { by(s, 'p').elapsedMs = 0; },
    s => { by(s, 'p').startedAt = null; },
    s => { by(s, 'a').lastChildId = null; },
    s => { by(s, 'p').lastChildId = 'c'; },
    s => { by(s, 'a').startedAt = 0; by(s, 'b').startedAt = 1; },
    s => { s.groups = [{ id:'g', name:'group' }]; by(s,'a').groupId = 'g'; },
  ];
  for (const change of changes) { const s = fixture(); change(s); assert.throws(() => validate(s)); }
});
test('moving active child closes destination at shared instant and repairs old last-child reference', () => {
  let s = toggleItem(toggleItem(fixture(), 'a', 1000), 'c', 2000);
  s = editItem(s, 'a', {}, 'q', 5000);
  assert.equal(by(s, 'p').lastChildId, null); assert.equal(by(s, 'q').lastChildId, 'a');
  assert.equal(by(s, 'c').elapsedMs, 3000); assert.equal(by(s, 'c').startedAt, null);
  assert.equal(by(s, 'a').elapsedMs, 4000); assert.equal(by(s, 'a').startedAt, 5000);
  assert.equal(total(s.timers, 6000), 8000);
});
test('group follows parent; detach retains group; removing group leaves valid family', () => {
  let s = fixture(); s.groups = [{id:'g',name:'学習'}];
  s = editItem(s, 'p', { groupId:'g' }, null, 0);
  assert.equal(by(s,'a').groupId, 'g'); assert.equal(by(s,'b').groupId, 'g');
  s = editItem(s, 'a', {}, null, 0);
  assert.equal(by(s,'a').groupId, 'g'); assert.equal(by(s,'a').parentId, null);
  assert.doesNotThrow(() => validate(removeGroup(s, 'g')));
});
test('deleting set promotes children, cascade removes them, deleting previous child repairs resume', () => {
  const s = toggleItem(fixture(), 'a', 10);
  const promoted = validate(removeItem(s, 'p'));
  assert.equal(by(promoted, 'a').startedAt, 10); assert.equal(by(promoted,'a').parentId, null);
  assert.deepEqual(promoted.timers.map(t=>t.id), ['a','b','q','c','solo']);
  assert.deepEqual(validate(removeItem(s,'p',true)).timers.map(t=>t.id), ['q','c','solo']);
  assert.equal(by(validate(removeItem(s,'a')),'p').lastChildId, null);
  assert.equal(by(s,'a').parentId,'p', 'undo snapshot remains unchanged');
});
test('sibling reorder and all bulk sort criteria preserve family membership and values', () => {
  const s = fixture();
  const moved = moveSibling(s, 'b', -1);
  assert.deepEqual(childrenOf(moved, 'p').map(t=>t.id), ['b','a']);
  assert.deepEqual(siblingsOf(moved,'p').map(t=>t.id), ['p','q','solo']);
  assert.deepEqual(moveSibling(s,'a',-1),s);
  for (const sort of SORTS) {
    const next = validate(applySort(s,sort.key, 0));
    for (const t of s.timers) assert.deepEqual(by(next,t.id),t);
  }
});
test('saving fails atomically: caller can retain running state and deletion undo snapshot', () => {
  const s = toggleItem(fixture(), 'a', 1000), next = toggleItem(s,'b',2000);
  assert.throws(()=>save({ setItem(){throw Error('quota');} },next));
  assert.equal(by(s,'a').startedAt,1000); assert.equal(by(s,'b').startedAt,null);
});
