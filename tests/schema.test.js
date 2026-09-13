import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTimer, start, emptyState, migrate, validate, addGroup, renameGroup, removeGroup,
  groupName, groupNameError, elapsed, SCHEMA_VERSION, MAX_GROUPS, GROUP_NAME_MAX,
} from '../public/src/model.js';
import { readState, load, save } from '../public/src/storage.js';

// A v1 record as the shipped v0.4 app actually wrote it: no groupId anywhere.
const v1Fixture = () => ({
  version: 1,
  timers: [
    { id: 'a', name: '資格の勉強', memo: '毎日', color: 'mint', elapsedMs: 45000000, startedAt: 1700000000000, targetMs: 72000000 },
    { id: 'b', name: '読書', memo: '', color: 'blue', elapsedMs: 11100000, startedAt: null, targetMs: 0 },
    { id: 'c', name: '個人開発', memo: 'Multi Stopwatch', color: 'rose', elapsedMs: 148320000, startedAt: null, targetMs: 0 },
  ],
});

test('v1 migrates to current schema without losing time, running state or order', () => {
  const before = v1Fixture();
  const after = validate(migrate(before));
  assert.equal(after.version, SCHEMA_VERSION);
  assert.deepEqual(after.groups, []);
  assert.deepEqual(after.timers.map(t => t.id), ['a', 'b', 'c']);
  assert.deepEqual(after.timers.map(t => t.groupId), [null, null, null]);
  for (const [index, timer] of after.timers.entries()) {
    const original = before.timers[index];
    assert.equal(timer.elapsedMs, original.elapsedMs);
    assert.equal(timer.startedAt, original.startedAt);
    assert.equal(timer.name, original.name);
    assert.equal(timer.targetMs, original.targetMs);
  }
  // The running timer keeps counting from the same instant across the migration.
  assert.equal(elapsed(after.timers[0], 1700000060000), 45060000);
  assert.deepEqual(before, v1Fixture(), 'migrate must not mutate its input');
});

test('migration is idempotent and refuses schemas it does not know', () => {
  const v2 = migrate(v1Fixture());
  assert.equal(migrate(v2), v2);
  for (const broken of [null, undefined, 3, 'x', [], { version: 4, timers: [] }, { version: 1, timers: 'no' }]) {
    assert.throws(() => migrate(broken));
  }
});

test('reading storage migrates v1 and still rejects future or broken records', () => {
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.deepEqual(load(storage), emptyState());
  store.set('multi-stopwatch:state:v1', JSON.stringify(v1Fixture()));
  const loaded = load(storage);
  assert.equal(loaded.version, SCHEMA_VERSION);
  assert.equal(loaded.timers.length, 3);
  // Reading does not rewrite the record; the next save does.
  assert.equal(JSON.parse(store.get('multi-stopwatch:state:v1')).version, 1);
  save(storage, loaded);
  assert.equal(JSON.parse(store.get('multi-stopwatch:state:v1')).version, SCHEMA_VERSION);
  for (const broken of ['{oops', '{"version":9,"timers":[]}', 'null']) assert.throws(() => readState(broken));
});

test('groups are created, renamed and deleted without touching their timers', () => {
  let state = migrate(v1Fixture());
  state = addGroup(state, 'g1', '  学習  ');
  state = addGroup(state, 'g2', '趣味');
  assert.deepEqual(state.groups.map(g => g.name), ['学習', '趣味']);
  state = { ...state, timers: state.timers.map(t => (t.id === 'a' ? { ...t, groupId: 'g1' } : t)) };
  assert.equal(groupName(state, 'g1'), '学習');
  assert.equal(groupName(state, null), '未分類');
  assert.equal(groupName(state, 'gone'), '未分類');
  validate(state);

  state = renameGroup(state, 'g1', '資格');
  assert.equal(groupName(state, 'g1'), '資格');
  assert.equal(state.timers.find(t => t.id === 'a').groupId, 'g1');

  const before = state.timers.map(t => ({ ...t }));
  state = removeGroup(state, 'g1');
  assert.deepEqual(state.groups.map(g => g.id), ['g2']);
  assert.equal(state.timers.length, before.length, 'deleting a group must not delete timers');
  assert.equal(state.timers.find(t => t.id === 'a').groupId, null, 'its timers fall back to 未分類');
  assert.deepEqual(state.timers.map(t => t.elapsedMs), before.map(t => t.elapsedMs));
  assert.deepEqual(state.timers.map(t => t.id), before.map(t => t.id));
  validate(state);
});

test('group names are checked before a write is attempted', () => {
  const state = addGroup(emptyState(), 'g1', '学習');
  assert.equal(groupNameError(state, '趣味'), null);
  assert.match(groupNameError(state, '   '), /入力/);
  assert.match(groupNameError(state, 'x'.repeat(GROUP_NAME_MAX + 1)), /文字/);
  assert.match(groupNameError(state, '学習'), /同じ名前/);
  assert.match(groupNameError(addGroup(state, 'g9', 'learn'), ' ＬＥＡＲＮ '), /同じ名前/, '全角と半角、大文字小文字の違いは同じ名前として扱う');
  assert.equal(groupNameError(state, '学習', 'g1'), null, 'renaming a group to its own name is fine');
  let many = emptyState();
  for (let i = 0; i < MAX_GROUPS; i++) many = addGroup(many, `g${i}`, `グループ${i}`);
  assert.match(groupNameError(many, '次'), /20個/);
});

test('validate rejects a timer pointing at a group that does not exist', () => {
  const state = { ...emptyState(), timers: [{ ...createTimer('a'), groupId: 'ghost' }] };
  assert.throws(() => validate(state));
  assert.throws(() => validate({ ...emptyState(), groups: [{ id: 'g', name: '   ' }] }));
  assert.throws(() => validate({ ...emptyState(), groups: [{ id: 'g', name: 'a' }, { id: 'g', name: 'b' }] }));
  assert.doesNotThrow(() => validate(addGroup({ ...emptyState(), timers: [{ ...createTimer('a'), groupId: 'g' }] }, 'g', 'ok')));
  // A running timer still validates after migration.
  assert.doesNotThrow(() => validate(migrate({ version: 1, timers: [start(createTimer('a'), 1000)] })));
});
