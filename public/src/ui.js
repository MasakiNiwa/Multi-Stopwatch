// DOM rendering and dialogs. Holds no application state: every function is told what to show.
import { elapsed, format, parts, progress, shortDuration, speak, running, total, MAX_MS } from './model.js';

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
export function paint(shown, all, now) {
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
    return ms >= timer.targetMs ? '目標達成 ✓' : `目標まで ${100 - Math.floor(progress(ms, timer.targetMs) * 100)}%`;
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

export function setListState({ hasTimers, shown, count, filtering }) {
  $('#empty').hidden = hasTimers;
  $('#filter-bar').hidden = count < 6;
  $('#no-match').hidden = !(hasTimers && shown === 0);
  text($('#filter-count'), filtering ? `${count}件中 ${shown}件を表示` : '');
}

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
export function paintSheet(timer, now, { index, count, editable }) {
  if (!$('#sheet').open || !timer) return;
  const ms = elapsed(timer, now), isRunning = timer.startedAt !== null;
  text($('#sheet-title'), timer.name);
  text($('#sheet-time'), format(ms));
  text($('#sheet-toggle'), isRunning ? '■ 停止' : '▶ 開始');
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

export function openEditor(timer, isNew) {
  const form = $('#edit-form'), f = form.elements;
  text($('#editor-title'), isNew ? '計測を追加' : '計測を編集');
  text($('#edit-error'), '');
  f.name.value = timer.name;
  f.memo.value = timer.memo;
  form.querySelector(`input[name="color"][value="${timer.color}"]`).checked = true;
  f.targetH.value = Math.floor(timer.targetMs / 3600000);
  f.targetM.value = Math.floor(timer.targetMs / 60000) % 60;
  const { h, m, s } = parts(timer.elapsedMs);
  f.elapsedH.value = Number(h); f.elapsedM.value = Number(m); f.elapsedS.value = Number(s);
  $('#elapsed-fields').hidden = isNew;
  $('#editor').showModal();
  f.name.focus();
  f.name.select();
}

// Returns the submitted values, or null with a message shown when they are not usable.
export function readEditor() {
  const f = $('#edit-form').elements;
  const num = input => (input.value === '' ? NaN : Number(input.value));
  const name = f.name.value.trim();
  if (!name) { text($('#edit-error'), '名前を入力してください。'); f.name.focus(); return null; }
  const fields = [f.targetH, f.targetM, f.elapsedH, f.elapsedM, f.elapsedS];
  if (fields.some(input => !Number.isInteger(num(input)) || num(input) < 0)) {
    text($('#edit-error'), '時間・分・秒には0以上の整数を入力してください。');
    fields.find(input => !Number.isInteger(num(input)) || num(input) < 0).focus();
    return null;
  }
  return {
    name,
    memo: f.memo.value,
    color: f.color.value,
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
export function showTheme(mode) {
  const input = document.querySelector(`#theme input[value="${mode}"]`);
  if (input) input.checked = true;
}
