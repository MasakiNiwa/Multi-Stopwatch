// DOM rendering and dialogs. Holds no application state: every function is told what to show.
import { elapsed, format, parts, progress, speak, running, total, MAX_MS } from './model.js';

const $ = selector => document.querySelector(selector);
const cards = () => $('#timers').children;
// Action buttons show a short label; assistive technology also hears which timer it belongs to.
const LABELS = [['up', '上へ移動'], ['down', '下へ移動'], ['edit', '編集'], ['reset', 'リセット'], ['delete', '削除']];

function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

// Rebuild only what changed. Cards keep their identity so focus and scrolling survive an update.
export function sync(timers, editable) {
  const list = $('#timers');
  const existing = new Map([...cards()].map(card => [card.dataset.id, card]));
  const ordered = timers.map(t => {
    const card = existing.get(t.id) ?? $('#card').content.firstElementChild.cloneNode(true);
    existing.delete(t.id);
    card.dataset.id = t.id;
    card.dataset.color = t.color;
    text(card.querySelector('h2'), t.name);
    card.querySelector('h2').title = t.name; // Long names are clamped to three lines in the card.
    text(card.querySelector('.memo'), t.memo);
    return card;
  });
  for (const card of existing.values()) card.remove();
  ordered.forEach((card, index) => {
    if (list.children[index] !== card) list.insertBefore(card, list.children[index] ?? null);
    card.querySelectorAll('button').forEach(b => { b.disabled = !editable; });
    card.querySelector('[data-action="up"]').disabled = !editable || index === 0;
    card.querySelector('[data-action="down"]').disabled = !editable || index === timers.length - 1;
    for (const [action, label] of LABELS) card.querySelector(`[data-action="${action}"]`).setAttribute('aria-label', `${timers[index].name}を${label}`);
  });
  $('#empty').hidden = timers.length > 0;
}

// Called on every tick: only time-dependent parts of the view.
export function paint(timers, now, editable = true) {
  [...cards()].forEach((card, index) => {
    const t = timers[index];
    if (!t) return;
    const ms = elapsed(t, now), isRunning = t.startedAt !== null, { h, m, s } = parts(ms);
    card.dataset.state = isRunning ? 'running' : 'stopped';
    card.dataset.length = h.length > 4 ? 'long' : 'normal';
    text(card.querySelector('.h'), h);
    text(card.querySelector('.m'), m);
    text(card.querySelector('.sec'), s);
    text(card.querySelector('.time .sr-only'), speak(ms));
    text(card.querySelector('.state-text'), isRunning ? '計測中' : '停止中');
    const toggle = card.querySelector('[data-action="toggle"]');
    text(toggle, isRunning ? '■ 停止' : '▶ 開始');
    toggle.setAttribute('aria-label', `${t.name}を${isRunning ? '停止' : '開始'}`);
    // Resetting a timer that already reads zero would do nothing; keep the button out of the way.
    card.querySelector('[data-action="reset"]').disabled = !editable || ms === 0;
    const goal = card.querySelector('.goal'), bar = card.querySelector('.bar');
    bar.hidden = goal.hidden = t.targetMs === 0;
    if (t.targetMs > 0) {
      const ratio = progress(ms, t.targetMs), done = ms >= t.targetMs;
      bar.firstElementChild.style.width = `${ratio * 100}%`;
      goal.classList.toggle('done', done);
      text(goal, done ? `目標 ${format(t.targetMs)} を達成 ✓` : `目標 ${format(t.targetMs)}・${Math.floor(ratio * 100)}%`);
    }
  });
  const count = running(timers);
  text($('#total'), format(total(timers, now)));
  text($('#running'), String(count));
  $('#running-note').dataset.running = count > 0 ? '1' : '0';
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
export function focusCard(id) {
  requestAnimationFrame(() => document.querySelector(`.card[data-id="${id}"] [data-action="toggle"]`)?.focus());
}
