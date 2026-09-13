// Pure domain functions: no DOM, storage or scheduling dependencies.
export const COLORS = ['mint', 'blue', 'rose', 'amber'];
export const MAX_MS = 315360000000; // Ten years; validation/display bound.
export const MAX_TIMERS = 100;
export const NAME_MAX = 80;
export const MEMO_MAX = 1000;
export const SCHEMA_VERSION = 3;
export const MAX_SETS = 20;
export const MAX_GROUPS = 20;
export const GROUP_NAME_MAX = 40;
export const UNGROUPED_NAME = '未分類';
export function createTimer(id, name = '新しい計測') {
  return { id, kind: 'timer', parentId: null, name, memo: '', color: 'mint', elapsedMs: 0, startedAt: null, targetMs: 0, groupId: null };
}
export function emptyState() {
  return { version: SCHEMA_VERSION, timers: [], groups: [] };
}
export function elapsed(timer, now) {
  if (timer.kind === 'set') return timer.aggregateMs ?? 0;
  return Math.min(MAX_MS, timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt)));
}
export function start(timer, now) {
  if (timer.kind === 'set') return timer;
  return timer.startedAt === null ? { ...timer, startedAt: now } : timer;
}
export function stop(timer, now) {
  if (timer.kind === 'set') return timer;
  return { ...timer, elapsedMs: elapsed(timer, now), startedAt: null };
}
export function reset(timer) {
  if (timer.kind === 'set') return timer;
  return { ...timer, elapsedMs: 0, startedAt: null };
}
// Manual correction. A running timer keeps running from the corrected value.
export function setElapsed(timer, ms, now) {
  if (timer.kind === 'set') return timer;
  const value = Math.min(MAX_MS, Math.max(0, Math.floor(ms)));
  return { ...timer, elapsedMs: value, startedAt: timer.startedAt === null ? null : now };
}
export function total(timers, now) {
  return timers.reduce((sum, t) => sum + (t.kind === 'set' ? 0 : elapsed(t, now)), 0);
}
export function running(timers) {
  return timers.filter(t => t.kind !== 'set' && t.startedAt !== null).length;
}
// Hours are not wrapped: a long measurement stays readable as 10000:00:00.
export function parts(ms) {
  const sec = Math.floor(Math.max(0, ms) / 1000);
  return {
    h: String(Math.floor(sec / 3600)).padStart(2, '0'),
    m: String(Math.floor(sec / 60) % 60).padStart(2, '0'),
    s: String(sec % 60).padStart(2, '0'),
  };
}
export function format(ms) {
  const { h, m, s } = parts(ms);
  return `${h}:${m}:${s}`;
}
// Spoken form for assistive technology; the digit groups themselves are decorative.
export function speak(ms) {
  const { h, m, s } = parts(ms);
  return `${Number(h)}時間${Number(m)}分${Number(s)}秒`;
}
// Short spoken-style duration for tight places such as a row's goal label.
export function shortDuration(ms) {
  const minutes = Math.floor(ms / 60000), h = Math.floor(minutes / 60), m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
export function progress(ms, targetMs) {
  return targetMs > 0 ? Math.min(1, ms / targetMs) : 0;
}
// Reordering as data: the same function serves the drag handle, the arrow keys and the menu.
export function move(timers, from, to) {
  if (from === to || from < 0 || to < 0 || from >= timers.length || to >= timers.length) return timers;
  const next = [...timers];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
// Filter for finding one timer among many. Case and width differences should not hide a match.
export function matches(timer, query) {
  const norm = value => value.normalize('NFKC').toLowerCase();
  const q = norm(query).trim();
  return q === '' || norm(timer.name).includes(q) || norm(timer.memo).includes(q);
}
/* ---------- groups ---------- */
export function groupName(state, groupId) {
  return state.groups.find(g => g.id === groupId)?.name ?? UNGROUPED_NAME;
}
// Reported to the user before a write is attempted, so the pure operations below stay total.
export function groupNameError(state, name, exceptId = null) {
  const key = value => value.normalize('NFKC').trim().toLowerCase();
  const trimmed = name.trim();
  if (trimmed === '') return 'グループ名を入力してください。';
  if (trimmed.length > GROUP_NAME_MAX) return `グループ名は${GROUP_NAME_MAX}文字までにしてください。`;
  if (state.groups.some(g => g.id !== exceptId && key(g.name) === key(trimmed))) return '同じ名前のグループがあります。';
  if (state.groups.length >= MAX_GROUPS && exceptId === null) return `グループは${MAX_GROUPS}個までです。`;
  return null;
}
export function addGroup(state, id, name) {
  return { ...state, groups: [...state.groups, { id, name: name.trim() }] };
}
export function renameGroup(state, id, name) {
  return { ...state, groups: state.groups.map(g => (g.id === id ? { ...g, name: name.trim() } : g)) };
}
// Deleting a group never deletes its timers: they fall back to 未分類 keeping time and order.
export function removeGroup(state, id) {
  return {
    ...state,
    groups: state.groups.filter(g => g.id !== id),
    timers: state.timers.map(t => (t.groupId === id ? { ...t, groupId: null } : t)),
  };
}

/* ---------- schema ---------- */
// v1 had no groups. Every existing timer becomes 未分類, keeping time, running state and order.
export function migrate(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error('保存データを読み込めません');
  if (state.version === SCHEMA_VERSION) return state;
  if (![1, 2].includes(state.version)) throw Error('対応していない保存形式です');
  if (!Array.isArray(state.timers)) throw Error('保存データを読み込めません');
  return {
    version: SCHEMA_VERSION,
    timers: state.timers.map(timer => ({ ...timer, kind: 'timer', parentId: null, groupId: state.version === 1 ? null : timer.groupId })),
    groups: state.version === 1 ? [] : state.groups,
  };
}
export function validate(state) {
  const bounded = n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MS;
  if (!state || state.version !== SCHEMA_VERSION || !Array.isArray(state.timers) || !Array.isArray(state.groups)
    || state.timers.filter(t => t?.kind !== 'set').length > MAX_TIMERS || state.timers.filter(t => t?.kind === 'set').length > MAX_SETS || state.groups.length > MAX_GROUPS) throw Error('対応していない保存形式です');
  const groupIds = new Set();
  for (const g of state.groups) {
    if (!g || typeof g.id !== 'string' || !g.id || groupIds.has(g.id) || typeof g.name !== 'string' || g.name.trim() === '' || g.name.length > GROUP_NAME_MAX) throw Error('保存データを読み込めません');
    groupIds.add(g.id);
  }
  const ids = new Set();
  for (const t of state.timers) {
    if (t?.kind === 'set') {
      if (typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.name !== 'string' || t.name.length > NAME_MAX || typeof t.memo !== 'string' || t.memo.length > MEMO_MAX || !COLORS.includes(t.color) || !bounded(t.targetMs) || !(t.groupId === null || groupIds.has(t.groupId)) || t.parentId !== null || !('lastChildId' in t) || 'elapsedMs' in t || 'startedAt' in t || 'aggregateMs' in t) throw Error('不正なセットです');
      ids.add(t.id);
      continue;
    }
    if (t?.kind !== 'timer' || 'lastChildId' in t || 'aggregateMs' in t) throw Error('不正な計測です');
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.name !== 'string' || t.name.length > NAME_MAX || typeof t.memo !== 'string' || t.memo.length > MEMO_MAX || !COLORS.includes(t.color) || !bounded(t.elapsedMs) || !bounded(t.targetMs) || !(t.startedAt === null || (Number.isSafeInteger(t.startedAt) && t.startedAt >= 0 && t.startedAt <= 8640000000000000)) || !(t.groupId === null || groupIds.has(t.groupId))) throw Error('保存データを読み込めません');
    ids.add(t.id);
  }
  for (const t of state.timers) {
    if (t.kind === 'set') {
      const children = state.timers.filter(c => c.kind === 'timer' && c.parentId === t.id);
      if (running(children) > 1 || !(t.lastChildId === null || children.some(c => c.id === t.lastChildId))) throw Error('不正なセット内の計測です');
    } else if (t.parentId !== null) {
      const parent = state.timers.find(p => p.id === t.parentId && p.kind === 'set');
      if (!parent || parent.groupId !== t.groupId) throw Error('不正な親子関係です');
    }
  }
  return state;
}

export function createSet(id, name = '') {
  return { id, kind: 'set', parentId: null, name, memo: '', color: 'mint', targetMs: 0, groupId: null, lastChildId: null };
}
export const childrenOf = (state, id) => state.timers.filter(t => t.parentId === id);
export const siblingsOf = (state, id) => {
  const item = state.timers.find(t => t.id === id);
  return item ? state.timers.filter(t => t.parentId === item.parentId) : [];
};
// A display-only projection. Derived values are never persisted or counted in totals twice.
export function viewItem(state, item, now) {
  if (!item || item.kind !== 'set') return item;
  const children = childrenOf(state, item.id), active = children.find(t => t.startedAt !== null);
  const previous = children.find(t => t.id === item.lastChildId);
  return { ...item, aggregateMs: total(children, now), startedAt: active?.startedAt ?? null,
    childNote: active ? `計測中: ${active.name}` : previous ? `前回: ${previous.name}` : `${children.length}件・子を選択` };
}
export function toggleItem(state, id, now) {
  const item = state.timers.find(t => t.id === id);
  if (!item) return state;
  if (item.kind === 'set') {
    const child = childrenOf(state, id).find(t => t.startedAt !== null) ?? childrenOf(state, id).find(t => t.id === item.lastChildId);
    return child ? toggleItem(state, child.id, now) : state;
  }
  const starting = item.startedAt === null;
  return { ...state, timers: state.timers.map(t => {
    if (t.id === id) return starting ? start(t, now) : stop(t, now);
    if (starting && item.parentId !== null && t.id === item.parentId) return { ...t, lastChildId: id };
    if (starting && item.parentId !== null && t.kind === 'timer' && t.parentId === item.parentId) return stop(t, now);
    return t;
  }) };
}
export function moveSibling(state, id, step) {
  const siblings = siblingsOf(state, id), index = siblings.findIndex(t => t.id === id);
  const ordered = move(siblings, index, index + step);
  let cursor = 0;
  const ids = new Set(siblings.map(t => t.id));
  return { ...state, timers: state.timers.map(t => ids.has(t.id) ? ordered[cursor++] : t) };
}
export function removeItem(state, id, cascade = false) {
  const item = state.timers.find(t => t.id === id);
  if (!item) return state;
  const removed = new Set([id, ...(cascade && item.kind === 'set' ? childrenOf(state, id).map(t => t.id) : [])]);
  return { ...state, timers: state.timers.filter(t => !removed.has(t.id)).map(t => {
    if (t.kind === 'set' && removed.has(t.lastChildId)) return { ...t, lastChildId: null };
    return t.parentId === id ? { ...t, parentId: null } : t;
  }) };
}
export function editItem(state, id, changes, parentId, now) {
  const original = state.timers.find(t => t.id === id);
  if (!original) return state;
  const parent = parentId === null ? null : state.timers.find(t => t.id === parentId && t.kind === 'set');
  if (original.kind === 'timer' && parentId !== null && !parent) throw Error('セットが見つかりません');
  let updated = { ...original, ...changes };
  if (original.kind === 'timer') updated = { ...updated, parentId, groupId: parent ? parent.groupId : updated.groupId };
  let next = { ...state, timers: state.timers.map(t => {
    if (t.id === id) return updated;
    if (original.kind === 'set' && t.parentId === id) return { ...t, groupId: updated.groupId };
    if (t.kind === 'set' && t.lastChildId === id && t.id !== parentId) return { ...t, lastChildId: null };
    return t;
  }) };
  if (original.kind === 'timer' && parentId !== original.parentId && updated.startedAt !== null) {
    // Moving an active child adopts the destination's exclusive timing rule at one shared instant.
    next = { ...next, timers: next.timers.map(t => t.id === id ? stop(t, now) : t) };
    next = toggleItem(next, id, now);
  }
  return validate(next);
}
