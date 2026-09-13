// Wiring: owns the state, applies domain functions, persists, then asks the UI to redraw.
import {
  createTimer, elapsed, stop, reset, setElapsed, matches, running, total, format, emptyState,
  addGroup, renameGroup, removeGroup, groupName, groupNameError, MAX_TIMERS,
  createSet, MAX_SETS, childrenOf, siblingsOf, viewItem, toggleItem, moveSibling, removeItem, editItem,
} from './model.js';
import { load, save, readState, KEY, loadPrefs, savePrefs, THEMES } from './storage.js';
import { summarize, statsTick } from './stats.js';
import { applySort, sortLabel } from './sorting.js';
import * as ui from './ui.js';

const $ = selector => document.querySelector(selector);
let state, shown = [], groups = new Map(), query = '', draft = null, editing = null, sheetId = null, readOnly = false, ownsLock = false;
// Bumped on every saved change so the statistics can redraw immediately instead of waiting a second.
let revision = 0, statsMarker = null;
const expanded = new Set();
let deleting = false, undoState = null;
const timerCount = () => state.timers.filter(t => t.kind === 'timer').length;
const editable = () => !readOnly && ownsLock;
const reorderable = () => query.trim() === '';
const find = id => state.timers.find(t => t.id === id);
const indexOf = id => state.timers.findIndex(t => t.id === id);

try {
  state = load(localStorage);
} catch {
  state = emptyState();
  readOnly = true;
  ui.notice('保存データを読み込めません。元データの上書きを防ぐため編集を停止しました。「バックアップを保存」で元データを取り出せます。', { sticky: true });
  // The recovery button lives in the help dialog, so open it rather than leave the notice pointing nowhere.
  addEventListener('DOMContentLoaded', () => ui.openHelp(), { once: true });
}

/* ---------- theme ---------- */
// Preferences are stored under their own key; the stopwatch records keep schema v1 untouched.
let prefs = loadPrefs(localStorage);
const THEME_COLORS = { light: '#fbfaff', dark: '#121316' }; // --surface of each scheme.
const THEME_LABELS = { light: 'ライト', dark: 'ダーク' };
const systemDark = matchMedia('(prefers-color-scheme: dark)');
// 'system' follows the device until the button is pressed; after that the choice is explicit.
const effectiveTheme = () => (prefs.theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : prefs.theme);
// One managed meta replaces the media based pair, so an explicit choice also colours the browser UI.
const themeMeta = document.createElement('meta');
themeMeta.name = 'theme-color';
document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.remove());
document.head.append(themeMeta);
function applyTheme() {
  const mode = effectiveTheme();
  document.documentElement.dataset.theme = mode;
  themeMeta.content = THEME_COLORS[mode];
  ui.showThemeButton(mode);
}
systemDark.addEventListener('change', () => { if (prefs.theme === 'system') applyTheme(); });
// One button: it always switches to the opposite of what is on screen, and records that choice.
$('#theme-toggle').onclick = () => {
  const theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
  if (!THEMES.includes(theme)) return;
  prefs = { ...prefs, theme };
  applyTheme();
  ui.announce(`${THEME_LABELS[theme]}テーマに切り替えました`);
  try { savePrefs(localStorage, prefs); }
  catch { ui.notice('テーマの設定を保存できませんでした。この画面の表示だけ切り替えています。'); }
};
applyTheme();

/* ---------- help ---------- */
$('#help-open').onclick = () => ui.openHelp();
$('#help-close').onclick = () => ui.closeHelp();

/* ---------- rendering ---------- */
function render() {
  // The filter box hides below six timers; a query left behind would silently keep rows out of view.
  if (state.timers.length < 6 && query !== '') { query = ''; $('#filter').value = ''; }
  groups = new Map(state.groups.map(group => [group.id, group.name]));
  shown = [];
  const visibleExpanded = new Set(expanded), childCounts = new Map();
  for (const item of state.timers.filter(t => t.parentId === null)) {
    const children = item.kind === 'set' ? childrenOf(state, item.id) : [];
    if (item.kind === 'set') childCounts.set(item.id, children.length);
    const matchingChildren = children.filter(t => matches(t, query));
    const parentMatches = matches(item, query);
    if (!parentMatches && matchingChildren.length === 0) continue;
    shown.push(item);
    if (query.trim() && children.length) visibleExpanded.add(item.id);
    if (visibleExpanded.has(item.id)) shown.push(...(query.trim() && !parentMatches ? matchingChildren : children));
  }
  ui.sync(shown, { editable: editable(), reorderable: reorderable(), expanded: visibleExpanded, deleting, canAdd: timerCount() < MAX_TIMERS, childCounts });
  ui.setListState({
    hasTimers: state.timers.length > 0, shown: shown.length, count: state.timers.length,
    filtering: query.trim() !== '', editable: editable(),
  });
  $('#add').disabled = !editable() || timerCount() >= MAX_TIMERS;
  $('#add-set').disabled = !editable() || state.timers.filter(t => t.kind === 'set').length >= MAX_SETS;
  $('#delete-mode').disabled = !editable();
  $('#stop-all').disabled = !editable() || running(state.timers) === 0;
  $('#import').disabled = !editable();
  if (ui.groupsOpen()) ui.renderGroupList(state);
  tick();
}
// Showing the panel, rotating the screen or reading a change from another window redraws at once.
const refresh = () => tick(true);
function tick(force = false) {
  if (document.hidden) return;
  const now = Date.now();
  ui.paint(shown.map(t => viewItem(state, t, now)), state.timers, now, groups);
  if (ui.statsVisible()) {
    // Throttle on the second the headline total will show, so the panel never lags the hero.
    const second = Math.floor(total(state.timers, now) / 1000);
    const step = statsTick(statsMarker, { revision, second, running: running(state.timers), force });
    statsMarker = step.marker;
    if (step.changed) ui.paintStats(summarize(state, now));
  } else {
    statsMarker = null; // A hidden panel holds stale content; redraw it when it comes back.
  }
  if (sheetId) ui.paintSheet(viewItem(state, find(sheetId), now), now, sheetPosition());
}
function commit(next, { keepUndo = false } = {}) {
  if (!editable()) return false;
  try { save(localStorage, next); state = next; revision += 1; if (!keepUndo) clearUndo(); render(); return true; }
  catch { ui.notice('保存できませんでした。操作は反映していません。空き容量やブラウザの保存設定を確認してください。', { sticky: true }); return false; }
}
const update = (id, fn) => commit({ ...state, timers: state.timers.map(t => (t.id === id ? fn(t) : t)) });

/* ---------- toolbar and filter ---------- */
function newItem(kind = 'timer', parentId = null) {
  if (!editable() || (kind === 'timer' ? timerCount() >= MAX_TIMERS : state.timers.filter(t => t.kind === 'set').length >= MAX_SETS)) return;
  draft = kind === 'set' ? createSet(crypto.randomUUID()) : { ...createTimer(crypto.randomUUID(), ''), parentId, groupId: find(parentId)?.groupId ?? null };
  editing = { ...draft, snapshotMs: 0 };
  ui.fillGroupSelect(state, draft.groupId);
  ui.fillParentSelect(state, draft);
  ui.openEditor(draft, true);
}
$('#add').onclick = () => newItem();
$('#add-set').onclick = () => newItem('set');
$('#delete-mode').onclick = () => {
  deleting = !deleting;
  $('#delete-mode').setAttribute('aria-pressed', String(deleting));
  $('#delete-mode').textContent = deleting ? '削除を終了' : '削除モード';
  render();
};
function clearUndo() { undoState = null; $('#undo-delete').hidden = true; }
$('#dismiss-undo').onclick = clearUndo;
$('#undo').onclick = () => {
  const restored = undoState;
  if (restored && commit(restored)) {
    ui.notice('削除を取り消しました。');
    ui.announce('削除を取り消しました');
    (deleting ? $('#delete-mode') : $('#add')).focus();
  }
};
$('#stop-all').onclick = () => {
  const now = Date.now(), count = running(state.timers);
  if (commit({ ...state, timers: state.timers.map(t => stop(t, now)) })) ui.notice(`${count}件の計測を停止しました。`);
};
$('#filter').oninput = event => { query = event.target.value; render(); };

/* ---------- rows ---------- */
function toggle(id) {
  if (!editable()) return;
  const next = toggleItem(state, id, Date.now());
  if (next === state && find(id)?.kind === 'set') {
    expanded.add(id); render();
    ui.notice('計測する子を選んでください。子がなければ「＋ 子を追加」から追加できます。');
    if (ui.sheetOpen()) ui.closeSheet();
  } else commit(next);
}
async function askReset(timer) {
  return ui.ask({
    title: '時間を0に戻しますか？',
    message: `「${timer.name}」を停止して、${format(elapsed(timer, Date.now()))} を0に戻します。元には戻せません。`,
    confirmLabel: 'リセットする',
  });
}
function remove(timer, cascade = false) {
  const before = state;
  // Deleting several in a row should not send the keyboard back to the top each time.
  const following = deleting ? shown.filter(t => t.id !== timer.id).slice(shown.findIndex(t => t.id === timer.id)) : [];
  const nextId = following[0]?.id ?? shown.filter(t => t.id !== timer.id).at(-1)?.id ?? null;
  if (commit(removeItem(state, timer.id, cascade), { keepUndo: true })) {
    undoState = before;
    $('#undo-delete').hidden = false;
    const kept = timer.kind === 'set' && !cascade ? '（子は残しました）' : '';
    // The window matters: the undo disappears at the next change, so say so where it is offered.
    $('#undo-delete span').textContent = `「${timer.name}」を削除${kept}。次の操作まで取り消せます`;
    ui.announce(`${timer.name}を削除しました。次の操作まで元に戻せます。`);
    if (nextId && deleting) ui.focusRow(nextId, 'delete');
    else $('#add').focus();
  }
}
$('#timers').onclick = event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('.card').dataset.id;
  // Reading a timer's details stays available in a read-only window; only the actions inside are locked.
  const action = button.dataset.action;
  if (action === 'expand' || (action === 'open' && find(id)?.kind === 'set')) {
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    render();
  }
  if (action === 'details' || (action === 'open' && find(id)?.kind !== 'set')) openSheetFor(id);
  if (action === 'add-child') newItem('timer', id);
  if (action === 'delete' && deleting && editable() && find(id)) remove(find(id));
  if (button.dataset.action === 'toggle' && editable()) toggle(id);
};

/* ---------- detail sheet ---------- */
const sheetPosition = () => {
  const siblings = siblingsOf(state, sheetId), item = find(sheetId);
  return {
    index: siblings.findIndex(t => t.id === sheetId), count: siblings.length, editable: editable(), state,
    parentName: item?.parentId ? find(item.parentId)?.name ?? null : null,
  };
};
function openSheetFor(id) {
  if (!find(id)) return;
  sheetId = id;
  ui.openSheet(); // Open first: paintSheet only fills a sheet that is already showing.
  ui.paintSheet(viewItem(state, find(id), Date.now()), Date.now(), sheetPosition());
}
$('#sheet').addEventListener('close', () => { sheetId = null; });
$('#sheet-close').onclick = () => ui.closeSheet();
$('#sheet-toggle').onclick = () => toggle(sheetId);
$('#sheet').addEventListener('click', async event => {
  const button = event.target.closest('[data-sheet]');
  if (!button || !editable()) return;
  const timer = find(sheetId);
  if (!timer) return;
  const action = button.dataset.sheet;
  if (action === 'up' || action === 'down') {
    if (commit(moveSibling(state, timer.id, action === 'up' ? -1 : 1))) ui.announce(`${timer.name}を移動しました`);
    return;
  }
  if (action === 'unparent') {
    const parentName = find(timer.parentId)?.name ?? 'セット';
    if (commit(editItem(state, timer.id, {}, null, Date.now()))) {
      ui.notice(`「${timer.name}」を「${parentName}」から出しました。グループはそのままです。`);
      ui.announce(`${timer.name}をセットから出しました`);
      ui.closeSheet();
    }
    return;
  }
  // The remaining actions open their own dialog or leave the row behind, so the sheet steps aside first.
  ui.closeSheet();
  if (action === 'edit') openEditorFor(timer);
  if (action === 'reset' && await askReset(timer)) update(timer.id, reset);
  if (action === 'delete') remove(timer);
  if (action === 'cascade' && await ui.ask({ title: '子ごと削除しますか？', message: `「${timer.name}」と子${childrenOf(state, timer.id).length}件を削除します。`, confirmLabel: '子ごと削除する' })) remove(timer, true);
});

/* ---------- drag and keyboard reordering ---------- */
let drag = null, edgeTimer = 0;
function positionDrag(clientY) {
  const list = $('#timers');
  drag.lastY = clientY;
  drag.dy = clientY - drag.startY;
  drag.card.style.transform = `translateY(${drag.dy}px)`;
  const rect = drag.card.getBoundingClientRect(), middle = rect.top + rect.height / 2;
  for (const other of [...list.children]) {
    if (other === drag.card || find(other.dataset.id)?.parentId !== find(drag.card.dataset.id)?.parentId) continue;
    const box = other.getBoundingClientRect();
    if (middle <= box.top || middle >= box.bottom) continue;
    const before = rect.top - drag.dy;
    list.insertBefore(drag.card, middle < box.top + box.height / 2 ? other : other.nextSibling);
    // Moving the node changes its layout position; shift the origin so it stays under the pointer.
    drag.startY += drag.card.getBoundingClientRect().top - drag.dy - before;
    drag.dy = clientY - drag.startY;
    drag.card.style.transform = `translateY(${drag.dy}px)`;
    break;
  }
}
function edgeScroll(clientY) {
  const speed = clientY < 96 ? -10 : clientY > innerHeight - 96 ? 10 : 0;
  clearInterval(edgeTimer);
  edgeTimer = speed === 0 ? 0 : setInterval(() => {
    const before = scrollY;
    scrollBy(0, speed);
    if (scrollY === before || !drag) return;
    drag.startY -= scrollY - before;
    positionDrag(drag.lastY);
  }, 16);
}
function endDrag(keep) {
  clearInterval(edgeTimer);
  edgeTimer = 0;
  drag.card.classList.remove('dragging');
  drag.card.style.transform = '';
  const parentId = find(drag.card.dataset.id).parentId;
  const order = [...$('#timers').children].map(row => row.dataset.id).filter(id => find(id)?.parentId === parentId);
  drag = null;
  if (!keep) { render(); return; }
  const byId = new Map(state.timers.map(t => [t.id, t]));
  let cursor = 0;
  const timers = state.timers.map(t => t.parentId === parentId ? byId.get(order[cursor++]) : t);
  if (timers.length !== state.timers.length || !commit({ ...state, timers })) render();
  else ui.announce('並べ替えを保存しました');
}
$('#timers').addEventListener('pointerdown', event => {
  const grip = event.target.closest('[data-action="grip"]');
  if (!grip || grip.disabled || drag || event.button > 0) return;
  event.preventDefault();
  // Collapse the hierarchy during a parent drag, so children cannot be visually separated.
  if (find(grip.closest('.card').dataset.id)?.parentId === null) { expanded.clear(); render(); }
  grip.setPointerCapture(event.pointerId);
  drag = { card: grip.closest('.card'), pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, dy: 0 };
  drag.card.classList.add('dragging');
});
$('#timers').addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  positionDrag(event.clientY);
  edgeScroll(event.clientY);
});
$('#timers').addEventListener('pointerup', event => { if (drag && event.pointerId === drag.pointerId) endDrag(true); });
$('#timers').addEventListener('pointercancel', event => { if (drag && event.pointerId === drag.pointerId) endDrag(false); });
$('#timers').addEventListener('keydown', event => {
  const grip = event.target.closest('[data-action="grip"]');
  const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
  if (!grip || grip.disabled || step === 0) return;
  event.preventDefault();
  const id = grip.closest('.card').dataset.id, from = indexOf(id), to = from + step;
  if (to < 0 || to >= state.timers.length) return;
  // sync keeps the focus on this grip, so holding the arrow key keeps moving the same row.
  if (commit(moveSibling(state, id, step))) ui.announce(`${find(id).name}を移動しました`);
});

/* ---------- editor ---------- */
function openEditorFor(timer) {
  editing = { ...timer, snapshotMs: elapsed(timer, Date.now()) };
  ui.fillGroupSelect(state, timer.groupId);
  ui.fillParentSelect(state, timer);
  ui.openEditor({ ...timer, elapsedMs: editing.snapshotMs }, false);
}
ui.selectOnFocus($('#editor'));
$('#target-presets').onclick = event => {
  const button = event.target.closest('button[data-preset]');
  if (button) ui.setTarget(Number(button.dataset.preset));
};
$('#edit-form').addEventListener('input', event => {
  // Fine tuning after a preset keeps the chips honest about what is actually set.
  if (event.target.name === 'targetH' || event.target.name === 'targetM') {
    const f = $('#edit-form').elements;
    ui.markPresets((Number(f.targetH.value || 0) * 60 + Number(f.targetM.value || 0)) * 60000);
  }
});
$('#cancel').onclick = () => ui.closeEditor();
$('#editor').addEventListener('close', () => { draft = null; editing = null; });
$('#edit-form').onsubmit = event => {
  event.preventDefault();
  const values = ui.readEditor();
  if (!values) return;
  const base = editing;
  // The elapsed fields start at the value shown when the dialog opened; an untouched field must not
  // freeze a running timer, so only an actual edit is applied.
  const changed = base.kind !== 'set' && values.elapsedMs !== Math.floor(base.snapshotMs / 1000) * 1000;
  const apply = t => {
    const edited = { ...t, name: values.name, memo: values.memo, color: values.color, targetMs: values.targetMs, groupId: values.groupId };
    return changed ? setElapsed(edited, values.elapsedMs, Date.now()) : edited;
  };
  if (draft) {
    const created = apply(draft);
    const parentId = $('#edit-form').elements.parent.value || null;
    const next = editItem({ ...state, timers: [...state.timers, created] }, created.id, {}, parentId, Date.now());
    if (commit(next)) {
      ui.closeEditor();
      if (created.kind === 'set') expanded.add(created.id);
      if (parentId) expanded.add(parentId);
      render();
      // A new set is empty by definition, so the next step is always the first child: land there.
      ui.focusRow(created.id, created.kind === 'set' ? 'add-child' : 'toggle');
    }
  } else {
    const parentId = $('#edit-form').elements.parent.value || null;
    if (commit(editItem(state, base.id, apply(find(base.id)), parentId, Date.now()))) {
      ui.closeEditor(); if (parentId) expanded.add(parentId); render(); ui.focusRow(base.id);
    }
  }
};

/* ---------- backup ---------- */
$('#export').onclick = () => {
  try {
    const raw = readOnly ? localStorage.getItem(KEY) : JSON.stringify(state, null, 2);
    if (raw === null) { ui.notice('取り出せる保存データがありません。'); return; }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `multi-stopwatch-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui.notice('バックアップを保存しました。');
  } catch { ui.notice('バックアップを取り出せませんでした。'); }
};
$('#import').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw Error('ファイルが大きすぎます');
    const next = readState(await file.text());
    const message = `現在の${state.timers.length}件を、バックアップの${next.timers.length}件で置き換えます。動作中の計測は保存時からの時間も含めて再開します。`;
    if (await ui.ask({ title: 'バックアップから復元しますか？', message, confirmLabel: '復元する' }) && commit(next)) ui.notice('バックアップから復元しました。');
  } catch { ui.notice('このファイルは復元できません。現在の記録は変更していません。', { sticky: true }); }
  finally { event.target.value = ''; }
};

/* ---------- bulk sort ---------- */
ui.fillSortOptions();
$('#apply-sort').onclick = () => {
  const key = $('#sort').value;
  if (key === 'manual') { ui.notice('「手動順のまま」を選ぶと並び順は変わりません。'); return; }
  // Applies to every timer, not only the ones a filter happens to show.
  if (commit(applySort(state, key, Date.now()))) {
    ui.announce(`${state.timers.length}件を${sortLabel(key)}に並べ替えました`);
    ui.notice(`${state.timers.length}件を「${sortLabel(key)}」で並べ替えました。ドラッグや上下キーで微調整できます。`);
  }
};

/* ---------- groups ---------- */
$('#manage-groups').onclick = () => { ui.renderGroupList(state); ui.openGroups(); };
$('#groups-close').onclick = () => ui.closeGroups();
$('#group-add').onsubmit = event => {
  event.preventDefault();
  const input = event.currentTarget.elements.groupName, name = input.value;
  const problem = groupNameError(state, name);
  if (problem) { ui.groupError(problem); input.focus(); return; }
  if (commit(addGroup(state, crypto.randomUUID(), name))) {
    ui.groupError('');
    input.value = '';
    input.focus();
    ui.announce(`グループ「${name.trim()}」を追加しました`);
  }
};
$('#group-list').addEventListener('change', event => {
  const input = event.target.closest('.group-name');
  if (!input) return;
  const id = input.closest('.group-row').dataset.id, before = groupName(state, id);
  const problem = groupNameError(state, input.value, id);
  if (problem) { ui.groupError(problem); input.value = before; input.focus(); return; }
  if (commit(renameGroup(state, id, input.value))) {
    ui.groupError('');
    ui.notice(`グループ「${before}」を「${input.value.trim()}」に変更しました。`);
  } else {
    input.value = before;
  }
});
$('#group-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-group="delete"]');
  if (!button || !editable()) return;
  const id = button.closest('.group-row').dataset.id, name = groupName(state, id);
  const members = state.timers.filter(timer => timer.groupId === id).length;
  const message = members === 0
    ? `グループ「${name}」を削除します。`
    : `グループ「${name}」を削除します。中の${members}件の計測は消えず、「未分類」へ移ります。`;
  if (await ui.ask({ title: 'グループを削除しますか？', message, confirmLabel: '削除する' }) && commit(removeGroup(state, id))) {
    ui.notice(`グループ「${name}」を削除しました。${members > 0 ? `${members}件を未分類へ移しました。` : ''}`);
    ui.openGroups();
  }
});

/* ---------- layout and tabs ---------- */
// Wide landscape screens show the list and the statistics side by side; everything else uses tabs.
const wide = matchMedia('(orientation: landscape) and (min-width: 800px)');
let activeTab = 'tab-timers';
function layout() {
  ui.applyLayout(wide.matches, activeTab);
  refresh();
}
function selectTab(tabId, focus = false) {
  activeTab = tabId;
  layout();
  if (focus) $(`#${tabId}`).focus();
}
wide.addEventListener('change', layout);
$('#view-tabs').addEventListener('click', event => {
  const tab = event.target.closest('[role="tab"]');
  if (tab) selectTab(tab.id);
});
$('#view-tabs').addEventListener('keydown', event => {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const tabs = ['tab-timers', 'tab-stats'];
  selectTab(tabs[(tabs.indexOf(activeTab) + step + tabs.length) % tabs.length], true);
});

/* ---------- lifecycle ---------- */
// Hold a single-writer lock for the lifetime of this page. Other tabs may view only.
if (navigator.locks) {
  navigator.locks.request('multi-stopwatch:writer', { ifAvailable: true }, async lock => {
    if (!lock) {
      readOnly = true;
      ui.notice('別の画面で開いているため閲覧専用です。編集するには他の画面を閉じて、この画面を再読み込みしてください。', { sticky: true });
      render();
      return;
    }
    ownsLock = true;
    render();
    await new Promise(() => {});
  });
} else {
  readOnly = true;
  ui.notice('このブラウザでは安全な保存に必要な機能が使えません。新しいブラウザで開いてください。', { sticky: true });
}

window.addEventListener('storage', event => {
  if (event.key !== KEY && event.key !== null) return;
  try {
    state = load(localStorage);
    clearUndo();
    revision += 1;
    if (ui.editorOpen()) ui.closeEditor();
    if (ui.sheetOpen()) ui.closeSheet();
    if (ui.groupsOpen()) ui.closeGroups();
    if (ui.helpOpen()) ui.closeHelp();
    render();
  } catch {
    readOnly = true;
    ui.notice('別の画面で保存データが変更されました。バックアップを確認してください。', { sticky: true });
    render();
  }
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  $('#install').hidden = false;
  $('#install').onclick = async () => { await event.prompt(); $('#install').hidden = true; };
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(registration => {
    // A new version waits until every window is closed, so timing in this window is never interrupted.
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', function () {
        if (this.state === 'installed' && navigator.serviceWorker.controller) {
          ui.notice('新しいバージョンを準備しました。この計測を続けたまま、すべての画面を閉じて開き直すと切り替わります。', { sticky: true });
        }
      });
    });
    return navigator.serviceWorker.ready;
  }).then(() => { $('#offline').textContent = 'オフラインで利用できます'; })
    .catch(() => { $('#offline').textContent = 'オフライン準備に失敗しました。通信状態を確認して再読み込みしてください。'; });
} else {
  $('#offline').textContent = 'この環境ではオフライン起動に対応していません';
}

layout();
render();
setInterval(tick, 250);
document.addEventListener('visibilitychange', tick);
