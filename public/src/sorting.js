// One-shot bulk ordering. Pure: takes a state and returns the timers in a new order.
// Every comparator returns 0 for equal values, so the stable sort keeps the previous order on ties.
import { COLORS, elapsed, progress } from './model.js';

export const SORTS = [
  { key: 'manual', label: '手動順のまま' },
  { key: 'name-asc', label: '名前：昇順' },
  { key: 'name-desc', label: '名前：降順' },
  { key: 'time-desc', label: '累計時間：長い順' },
  { key: 'time-asc', label: '累計時間：短い順' },
  { key: 'running-first', label: '状態：計測中を先に' },
  { key: 'stopped-first', label: '状態：停止中を先に' },
  { key: 'group', label: 'グループ名順（未分類は最後）' },
  { key: 'color', label: '色順' },
  { key: 'progress-desc', label: '目標進捗：高い順（目標なしは最後）' },
  { key: 'progress-asc', label: '目標進捗：低い順（目標なしは最後）' },
];

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

function comparator(key, state, now) {
  const time = timer => elapsed(timer, now);
  const isRunning = timer => (timer.startedAt === null ? 0 : 1);
  // Timers without a goal have no progress to compare, so they always land at the end.
  const goalRank = timer => (timer.targetMs > 0 ? 0 : 1);
  const ratio = timer => progress(time(timer), timer.targetMs);
  const groupRank = timer => (timer.groupId === null ? 1 : 0);
  const groupLabel = timer => state.groups.find(g => g.id === timer.groupId)?.name ?? '';
  switch (key) {
    case 'name-asc': return (a, b) => collator.compare(a.name, b.name);
    case 'name-desc': return (a, b) => collator.compare(b.name, a.name);
    case 'time-desc': return (a, b) => time(b) - time(a);
    case 'time-asc': return (a, b) => time(a) - time(b);
    case 'running-first': return (a, b) => isRunning(b) - isRunning(a);
    case 'stopped-first': return (a, b) => isRunning(a) - isRunning(b);
    case 'group': return (a, b) => groupRank(a) - groupRank(b) || collator.compare(groupLabel(a), groupLabel(b));
    case 'color': return (a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color);
    case 'progress-desc': return (a, b) => goalRank(a) - goalRank(b) || ratio(b) - ratio(a);
    case 'progress-asc': return (a, b) => goalRank(a) - goalRank(b) || ratio(a) - ratio(b);
    default: return null;
  }
}

export function sortTimers(state, key, now) {
  const compare = comparator(key, state, now);
  return compare === null ? state.timers : [...state.timers].sort(compare);
}
// Applies to every timer, not just the ones a filter happens to show.
export function applySort(state, key, now) {
  return { ...state, timers: sortTimers(state, key, now) };
}
export function sortLabel(key) {
  return SORTS.find(sort => sort.key === key)?.label ?? key;
}
