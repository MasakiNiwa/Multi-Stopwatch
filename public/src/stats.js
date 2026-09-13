// Aggregation over the timers a state currently holds. Pure: no DOM, no clock of its own.
// v0.5 summarises accumulated totals only; there is no session history to report on yet.
import { elapsed, running, total, UNGROUPED_NAME } from './model.js';

export function summarize(state, now) {
  const timers = state.timers;
  const totalMs = total(timers, now);
  // Every share divides by the same total, so an empty or all-zero state yields 0 instead of NaN.
  const share = ms => (totalMs > 0 ? ms / totalMs : 0);

  const buckets = [...state.groups.map(g => ({ id: g.id, name: g.name })), { id: null, name: UNGROUPED_NAME }];
  const groups = buckets
    .map(bucket => {
      const members = timers.filter(t => t.groupId === bucket.id);
      const ms = total(members, now);
      return { id: bucket.id, name: bucket.name, timerCount: members.length, runningCount: running(members), totalMs: ms, share: share(ms) };
    })
    // A defined group stays listed while empty; 未分類 only appears when something is in it.
    .filter(group => group.id !== null || group.timerCount > 0);

  const ranking = timers
    .map(timer => ({
      id: timer.id,
      name: timer.name,
      groupName: timer.groupId === null ? UNGROUPED_NAME : (state.groups.find(g => g.id === timer.groupId)?.name ?? UNGROUPED_NAME),
      ms: elapsed(timer, now),
    }))
    .sort((a, b) => b.ms - a.ms);
  // Equal times share a rank, and the stable sort keeps them in list order.
  let rank = 0, previous = null;
  for (const [index, row] of ranking.entries()) {
    if (row.ms !== previous) { rank = index + 1; previous = row.ms; }
    row.rank = rank;
    row.share = share(row.ms);
  }

  return { totalMs, runningCount: running(timers), timerCount: timers.length, groups, ranking };
}
