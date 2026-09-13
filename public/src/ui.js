// DOM rendering and dialogs. Holds no application state: every function is told what to show.
import { elapsed, format, parts, progress, shortDuration, speak, running, total, groupName, UNGROUPED_NAME, MAX_MS } from './model.js';
import { SORTS } from './sorting.js';

const $ = selector => document.querySelector(selector);
const rows = () => $('#timers').children;

function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

// Rebuild only what changed. Rows keep their identity so focus, scrolling and a drag survive an update.
export function sync(timers, { editable, reorderable }) {
  const list = $('#timers');
  // Moving a node in the DOM drops focus. Remember it so repeated key presses keep working.
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const existing = new Map([...rows()].map(row => [row.dataset.id, row]));
  const ordered = timers.map(t => {
    const row = existing.get(t.id) ?? $('#card').content.firstElementChild.cloneNode(true);
    existing.delete(t.id);
    row.dataset.id = t.id;
    row.dataset.color = t.color;
    const name = row.querySelector('.name');
    text(name, t.name);
    name.title = t.name; // The row shows one line; the full name stays reachable on hover.
    row.querySelector('[data-action="open"]').setAttribute('aria-label', `${t.name}の詳細と操作`);
    const grip = row.querySelector('[data-action="grip"]');
    grip.setAttribute('aria-label', `${t.name}を並べ替え。上下キーで移動できます`);
    grip.disabled = !editable || !reorderable;
    grip.title = reorderable ? 'ドラッグ、または上下キーで並べ替え' : '絞り込み中は並べ替えできません';
    row.querySelector('[data-action="toggle"]').disabled = !editable;
    return row;
  });
  for (const row of existing.values()) row.remove();
  ordered.forEach((row, index) => {
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
  });
  if (focused?.isConnected && document.activeElement !== focused) focused.focus();
}

// Called on every tick: only time-dependent parts of the view.
// `shown` are the rows on screen; the summary always counts every timer, filtered out or not.
export function paint(shown, all, now, groups = new Map()) {
  [...rows()].forEach((row, index) => {
    const t = shown[index];
    if (!t) return;
    const ms = elapsed(t, now), isRunning = t.startedAt !== null, { h, m, s } = parts(ms);
    row.dataset.state = isRunning ? 'running' : 'stopped';
    row.dataset.length = h.length > 4 ? 'long' : 'normal';
    text(row.querySelector('.h'), h);
    text(row.querySelector('.m'), m);
    text(row.querySelector('.sec'), s);
    text(row.querySelector('.time .sr-only'), speak(ms));
    text(row.querySelector('.state-text'), isRunning ? '計測中' : '停止中');
    const toggle = row.querySelector('[data-action="toggle"]');
    text(toggle.querySelector('.glyph'), isRunning ? '■' : '▶');
    toggle.setAttribute('aria-label', `${t.name}を${isRunning ? '停止' : '開始'}`);
    const bar = row.querySelector('.bar');
    bar.hidden = t.targetMs === 0;
    if (t.targetMs > 0) bar.firstElementChild.style.width = `${progress(ms, t.targetMs) * 100}%`;
    text(row.querySelector('.meta-group'), groups.get(t.groupId) ?? '');
    text(row.querySelector('.meta-note'), noteFor(t, ms));
  });
  const count = running(all);
  text($('#total'), format(total(all, now)));
  text($('#running'), String(count));
  $('#running-note').dataset.running = count > 0 ? '1' : '0';
}

// One secondary line per row: the goal when there is one, otherwise the memo.
// The goal uses a short duration because a row has little room beside the running time.
function noteFor(timer, ms) {
  if (timer.targetMs > 0) {
    return ms >= timer.targetMs ? '目標達成 ✓' : `目標 ${Math.floor(progress(ms, timer.targetMs) * 100)}%`;
  }
  return timer.memo.replace(/\s+/g, ' ').trim();
}
// The sheet has room for the exact goal.
function sheetGoal(timer, ms) {
  const percent = Math.floor(progress(ms, timer.targetMs) * 100);
  return ms >= timer.targetMs
    ? `目標 ${shortDuration(timer.targetMs)}（${format(timer.targetMs)}）を達成 ✓`
    : `目標 ${shortDuration(timer.targetMs)}（${format(timer.targetMs)}）・${percent}%`;
}

export function setListState({ hasTimers, shown, count, filtering, editable }) {
  $('#empty').hidden = hasTimers;
  $('#filter').hidden = count < 6;
  $('#no-match').hidden = !(hasTimers && shown === 0);
  text($('#filter-count'), filtering ? `${count}件中 ${shown}件を表示` : '');
  $('#apply-sort').disabled = !editable || count < 2;
  $('#sort').disabled = !editable || count < 2;
  $('#manage-groups').disabled = !editable;
}

/* ---------- statistics ---------- */
export function statsVisible() { return !$('#panel-stats').hidden; }
const percent = share => `${Math.round(share * 100)}%`;
// Rows are reused and updated in place. Rebuilding both lists on every refresh would throw away
// and recreate up to a hundred rows a second for text that mostly has not changed.
function syncStatList(list, rows) {
  const existing = new Map([...list.children].map(item => [item.dataset.key, item]));
  const ordered = rows.map(row => {
    const item = existing.get(row.key) ?? $('#stat-row').content.firstElementChild.cloneNode(true);
    existing.delete(row.key);
    item.dataset.key = row.key;
    text(item.querySelector('.stat-rank'), row.rank);
    text(item.querySelector('.stat-name'), row.name);
    text(item.querySelector('.stat-time'), row.time);
    text(item.querySelector('.stat-sub'), row.sub);
    text(item.querySelector('.stat-share'), percent(row.share));
    const fill = item.querySelector('.bar > span'), width = `${Math.round(row.share * 100)}%`;
    if (fill.style.width !== width) fill.style.width = width;
    return item;
  });
  for (const item of existing.values()) item.remove();
  ordered.forEach((item, index) => {
    if (list.children[index] !== item) list.insertBefore(item, list.children[index] ?? null);
  });
}

// Called only when statsTick says the visible numbers moved, so this rebuild runs at most once a second.
export function paintStats(summary) {
  text($('#stat-total'), format(summary.totalMs));
  text($('#stat-running'), `${summary.runningCount} / ${summary.timerCount}`);
  const empty = summary.timerCount === 0;
  $('#stat-empty').hidden = !empty;
  $('#stat-group-block').hidden = empty;
  $('#stat-rank-block').hidden = empty;
  syncStatList($('#stat-groups'), summary.groups.map(group => ({
    key: group.id ?? 'ungrouped',
    rank: '',
    name: group.name,
    time: format(group.totalMs),
    sub: `${group.timerCount}件${group.runningCount > 0 ? `・計測中${group.runningCount}` : ''}`,
    share: group.share,
  })));
  syncStatList($('#stat-ranking'), summary.ranking.map(row => ({
    key: row.id,
    rank: `${row.rank}`,
    name: row.name,
    time: format(row.ms),
    sub: row.groupName,
    share: row.share,
  })));
}

/* ---------- layout: tabs when stacked, two columns when wide and landscape ---------- */
const TABS = [['tab-timers', 'panel-timers'], ['tab-stats', 'panel-stats']];
export function applyLayout(split, activeTab) {
  document.body.dataset.layout = split ? 'split' : 'tabs';
  document.body.dataset.view = split ? 'both' : (activeTab === 'tab-stats' ? 'stats' : 'timers');
  $('#view-tabs').hidden = split;
  for (const [tabId, panelId] of TABS) {
    const tab = $(`#${tabId}`), panel = $(`#${panelId}`);
    const selected = tabId === activeTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (split) {
      // Both panels are on screen at once, so they are regions rather than tab panels.
      panel.hidden = false;
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', tabId === 'tab-stats' ? '統計' : '計測一覧');
      panel.removeAttribute('aria-labelledby');
    } else {
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tabId);
      panel.removeAttribute('aria-label');
      panel.hidden = !selected;
    }
  }
}

/* ---------- groups ---------- */
export function fillSortOptions() {
  $('#sort').replaceChildren(...SORTS.map(sort => new Option(sort.label, sort.key)));
}
export function fillGroupSelect(state, selectedId) {
  const select = $('#edit-form').elements.group;
  select.replaceChildren(new Option(UNGROUPED_NAME, ''), ...state.groups.map(group => new Option(group.name, group.id)));
  select.value = selectedId ?? '';
}
export function renderGroupList(state) {
  // Renaming rebuilds the list from a commit; keep the caret on the row the user is working in.
  const focusedId = document.activeElement?.closest?.('.group-row')?.dataset.id ?? null;
  const counts = new Map();
  for (const timer of state.timers) counts.set(timer.groupId, (counts.get(timer.groupId) ?? 0) + 1);
  $('#group-list').replaceChildren(...state.groups.map(group => {
    const row = $('#group-row').content.firstElementChild.cloneNode(true);
    row.dataset.id = group.id;
    const input = row.querySelector('.group-name');
    input.value = group.name;
    input.setAttribute('aria-label', `${group.name}の名前`);
    text(row.querySelector('.group-count'), `${counts.get(group.id) ?? 0}件`);
    row.querySelector('[data-group="delete"]').setAttribute('aria-label', `${group.name}を削除`);
    return row;
  }));
  $('#group-empty').hidden = state.groups.length > 0;
  if (focusedId) $(`.group-row[data-id="${focusedId}"] .group-name`)?.focus();
}
export function openGroups() {
  text($('#group-error'), '');
  $('#group-add').elements.groupName.value = '';
  $('#groups').showModal();
  $('#group-add').elements.groupName.focus();
}
export function closeGroups() { $('#groups').close(); }
export function groupsOpen() { return $('#groups').open; }
export function groupError(message) { text($('#group-error'), message); }

export function announce(message) {
  text($('#live'), message);
}

let noticeTimer;
export function notice(message, { sticky = false } = {}) {
  text($('#notice'), message);
  clearTimeout(noticeTimer);
  if (message && !sticky) noticeTimer = setTimeout(() => text($('#notice'), ''), 8000);
}

// Confirmation as an in-page dialog: works inside installed apps and is styled with the app.
export function ask({ title, message, confirmLabel }) {
  const dialog = $('#confirm');
  text($('#confirm-title'), title);
  text($('#confirm-text'), message);
  text($('#confirm-ok'), confirmLabel);
  return new Promise(resolve => {
    const close = answer => () => { dialog.close(); resolve(answer); };
    $('#confirm-ok').onclick = close(true);
    $('#confirm-cancel').onclick = close(false);
    dialog.onclose = () => resolve(false);
    dialog.showModal();
    $('#confirm-cancel').focus();
  });
}

// Detail sheet: everything a row cannot show, plus the low frequency actions.
export function openSheet() {
  $('#sheet').showModal();
  $('#sheet-toggle').focus();
}
export function paintSheet(timer, now, { index, count, editable, state }) {
  if (!$('#sheet').open || !timer) return;
  const ms = elapsed(timer, now), isRunning = timer.startedAt !== null;
  text($('#sheet-title'), timer.name);
  text($('#sheet-time'), format(ms));
  text($('#sheet-toggle'), isRunning ? '■ 停止' : '▶ 開始');
  text($('#sheet-group'), `グループ：${groupName(state, timer.groupId)}`);
  text($('#sheet-goal'), timer.targetMs > 0 ? sheetGoal(timer, ms) : '');
  text($('#sheet-memo'), timer.memo);
  $('#sheet-toggle').disabled = !editable;
  for (const action of ['edit', 'delete']) $(`[data-sheet="${action}"]`).disabled = !editable;
  $('[data-sheet="reset"]').disabled = !editable || ms === 0;
  $('[data-sheet="up"]').disabled = !editable || index <= 0;
  $('[data-sheet="down"]').disabled = !editable || index === count - 1;
}
export function closeSheet() { $('#sheet').close(); }
export function sheetOpen() { return $('#sheet').open; }

// Typing a digit should replace what is there, on a phone as much as with a keyboard.
export function selectOnFocus(root) {
  for (const input of root.querySelectorAll('input[type="number"]')) {
    // Select immediately for keyboard focus, and again after the frame because a tap places the
    // caret after the focus event on touch browsers.
    input.addEventListener('focus', event => {
      event.target.select();
      requestAnimationFrame(() => { if (document.activeElement === event.target) event.target.select(); });
    });
    input.addEventListener('mouseup', event => event.preventDefault());
  }
}
export function markPresets(targetMs) {
  const minutes = Math.round(targetMs / 60000);
  for (const button of document.querySelectorAll('#target-presets button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.preset) === minutes));
  }
}
export function setTarget(minutes) {
  const f = $('#edit-form').elements;
  f.targetH.value = Math.floor(minutes / 60);
  f.targetM.value = minutes % 60;
  markPresets(minutes * 60000);
}
export function openEditor(timer, isNew) {
  const form = $('#edit-form'), f = form.elements;
  text($('#editor-title'), isNew ? '計測を追加' : '計測を編集');
  text($('#edit-error'), '');
  f.name.value = timer.name;
  f.memo.value = timer.memo;
  form.querySelector(`input[name="color"][value="${timer.color}"]`).checked = true;
  f.targetH.value = Math.floor(timer.targetMs / 3600000);
  f.targetM.value = Math.floor(timer.targetMs / 60000) % 60;
  markPresets(timer.targetMs);
  const { h, m, s } = parts(timer.elapsedMs);
  f.elapsedH.value = Number(h); f.elapsedM.value = Number(m); f.elapsedS.value = Number(s);
  // The correction stays folded away during an ordinary edit, with the current value on show.
  const correction = $('#elapsed-fields');
  correction.hidden = isNew;
  correction.open = false;
  text($('#elapsed-current'), `現在 ${format(timer.elapsedMs)}`);
  $('#editor').showModal();
  f.name.focus();
  f.name.select();
  $('#editor').scrollTop = 0; // Focusing can scroll the heading out of view on a short screen.
}

// Returns the submitted values, or null with a message shown when they are not usable.
export function readEditor() {
  const f = $('#edit-form').elements;
  // A cleared box is someone midway through typing, not an error: it counts as zero on save.
  const num = input => (input.value.trim() === '' ? 0 : Number(input.value));
  const name = f.name.value.trim();
  if (!name) { text($('#edit-error'), '名前を入力してください。'); f.name.focus(); return null; }
  const fields = [f.targetH, f.targetM, f.elapsedH, f.elapsedM, f.elapsedS];
  const broken = fields.find(input => !Number.isInteger(num(input)) || num(input) < 0);
  if (broken) {
    text($('#edit-error'), '時間・分・秒には0以上の整数を入力してください。');
    $('#elapsed-fields').open ||= broken.name.startsWith('elapsed');
    broken.focus();
    return null;
  }
  return {
    name,
    memo: f.memo.value,
    color: f.color.value,
    groupId: f.group.value === '' ? null : f.group.value,
    // Bound the target here so an extreme entry is capped instead of failing validation on save.
    targetMs: Math.min(MAX_MS, num(f.targetH) * 3600000 + num(f.targetM) * 60000),
    elapsedMs: num(f.elapsedH) * 3600000 + num(f.elapsedM) * 60000 + num(f.elapsedS) * 1000,
  };
}

export function closeEditor() { $('#editor').close(); }
export function editorOpen() { return $('#editor').open; }
export function focusRow(id, action = 'toggle') {
  requestAnimationFrame(() => document.querySelector(`.card[data-id="${id}"] [data-action="${action}"]`)?.focus());
}
// The button shows what pressing it will do, and says so for assistive technology.
export function showThemeButton(mode) {
  const next = mode === 'dark' ? 'ライト' : 'ダーク';
  const button = $('#theme-toggle');
  button.setAttribute('aria-label', `${next}テーマに切り替える`);
  button.title = `${next}テーマに切り替える`;
}
export function openHelp() {
  if ($('#help').open) return;
  $('#help').showModal();
  $('#help').scrollTop = 0;
}
export function closeHelp() { $('#help').close(); }
export function helpOpen() { return $('#help').open; }
