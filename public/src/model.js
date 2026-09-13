// Pure domain functions: no DOM, storage or scheduling dependencies.
export const COLORS = ['mint', 'blue', 'rose', 'amber'];
export const MAX_MS = 315360000000; // Ten years; validation/display bound.
export function createTimer(id, name = '新しい計測') {
  return { id, name, memo: '', color: 'mint', elapsedMs: 0, startedAt: null, targetMs: 0 };
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
export function format(ms) {
  const sec = Math.floor(ms / 1000);
  return [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function validate(state) {
  const bounded = n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MS;
  if (!state || state.version !== 1 || !Array.isArray(state.timers) || state.timers.length > 100) throw Error('対応していない保存形式です');
  const ids = new Set();
  for (const t of state.timers) {
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.name !== 'string' || t.name.length > 80 || typeof t.memo !== 'string' || t.memo.length > 1000 || !COLORS.includes(t.color) || !bounded(t.elapsedMs) || !bounded(t.targetMs) || !(t.startedAt === null || (Number.isSafeInteger(t.startedAt) && t.startedAt >= 0 && t.startedAt <= 8640000000000000))) throw Error('保存データを読み込めません');
    ids.add(t.id);
  }
  return state;
}
