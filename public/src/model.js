// Pure domain functions: no DOM, storage or scheduling dependencies.
export const COLORS = ['mint', 'blue', 'rose', 'amber'];
export const MAX_MS = 315360000000; // Ten years; validation/display bound.
export const MAX_TIMERS = 100;
export const NAME_MAX = 80;
export const MEMO_MAX = 1000;
export const SCHEMA_VERSION = 2;
export const MAX_GROUPS = 20;
export const GROUP_NAME_MAX = 40;
export const UNGROUPED_NAME = '未分類';
export function createTimer(id, name = '新しい計測') {
  return { id, name, memo: '', color: 'mint', elapsedMs: 0, startedAt: null, targetMs: 0, groupId: null };
}
export function emptyState() {
  return { version: SCHEMA_VERSION, timers: [], groups: [] };
}
export function elapsed(timer, now) {
  return Math.min(MAX_MS, timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt)));
}
export function start(timer, now) {
  return timer.startedAt === null ? { ...timer, startedAt: now } : timer;
}
export function stop(timer, now) {
  return { ...timer, elapsedMs: elapsed(timer, now), startedAt: null };
}
export function reset(timer) {
  return { ...timer, elapsedMs: 0, startedAt: null };
}
// Manual correction. A running timer keeps running from the corrected value.
export function setElapsed(timer, ms, now) {
  const value = Math.min(MAX_MS, Math.max(0, Math.floor(ms)));
  return { ...timer, elapsedMs: value, startedAt: timer.startedAt === null ? null : now };
}
export function total(timers, now) {
  return timers.reduce((sum, t) => sum + elapsed(t, now), 0);
}
export function running(timers) {
  return timers.filter(t => t.startedAt !== null).length;
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
  if (state.version !== 1) throw Error('対応していない保存形式です');
  if (!Array.isArray(state.timers)) throw Error('保存データを読み込めません');
  return {
    version: SCHEMA_VERSION,
    timers: state.timers.map(timer => ({ ...timer, groupId: null })),
    groups: [],
  };
}
export function validate(state) {
  const bounded = n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MS;
  if (!state || state.version !== SCHEMA_VERSION || !Array.isArray(state.timers) || !Array.isArray(state.groups)
    || state.timers.length > MAX_TIMERS || state.groups.length > MAX_GROUPS) throw Error('対応していない保存形式です');
  const groupIds = new Set();
  for (const g of state.groups) {
    if (!g || typeof g.id !== 'string' || !g.id || groupIds.has(g.id) || typeof g.name !== 'string' || g.name.trim() === '' || g.name.length > GROUP_NAME_MAX) throw Error('保存データを読み込めません');
    groupIds.add(g.id);
  }
  const ids = new Set();
  for (const t of state.timers) {
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.name !== 'string' || t.name.length > NAME_MAX || typeof t.memo !== 'string' || t.memo.length > MEMO_MAX || !COLORS.includes(t.color) || !bounded(t.elapsedMs) || !bounded(t.targetMs) || !(t.startedAt === null || (Number.isSafeInteger(t.startedAt) && t.startedAt >= 0 && t.startedAt <= 8640000000000000)) || !(t.groupId === null || groupIds.has(t.groupId))) throw Error('保存データを読み込めません');
    ids.add(t.id);
  }
  return state;
}
