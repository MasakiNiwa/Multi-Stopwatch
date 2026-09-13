import { createTimer, elapsed, start, stop, reset, format, validate } from './model.js';
import { load, save, KEY } from './storage.js';
const $ = selector => document.querySelector(selector);
let state, editingId, readOnly = false, ownsLock = false;
function notice(text) { $('#notice').textContent = text; }
try { state = load(localStorage); } catch { state = { version: 1, timers: [] }; readOnly = true; notice('保存データを読み込めません。元データの上書きを防ぐため編集を停止しました。バックアップで元データを取り出せます。'); }
function render() {
  $('#timers').replaceChildren();
  state.timers.forEach((t, index) => {
    const card = $('#card').content.firstElementChild.cloneNode(true);
    card.dataset.id = t.id; card.dataset.color = t.color;
    card.querySelector('h2').textContent = t.name;
    card.querySelector('.memo').textContent = t.memo;
    card.querySelector('[data-action="up"]').disabled = index === 0;
    card.querySelector('[data-action="down"]').disabled = index === state.timers.length - 1;
    if (readOnly || !ownsLock) card.querySelectorAll('button').forEach(b => b.disabled = true);
    $('#timers').append(card);
  });
  $('#empty').hidden = state.timers.length > 0;
  $('#add').disabled = readOnly || !ownsLock || state.timers.length >= 100;
  $('#stop-all').disabled = readOnly || !ownsLock || !state.timers.some(t => t.startedAt !== null);
  $('#import').disabled = readOnly || !ownsLock;
  tick();
}
function commit(next) {
  if (readOnly || !ownsLock) return false;
  try { save(localStorage, next); state = next; render(); return true; }
  catch { notice('保存できませんでした。操作は反映していません。空き容量やブラウザの保存設定を確認してください。'); return false; }
}
function update(id, fn) { return commit({ ...state, timers: state.timers.map(t => t.id === id ? fn(t) : t) }); }
function tick() {
  if (document.hidden) return;
  const now = Date.now();
  let total = 0;
  for (const [index, card] of [...$('#timers').children].entries()) {
    const t = state.timers[index], ms = elapsed(t, now);
    total += ms;
    card.querySelector('.time').textContent = format(ms);
    card.querySelector('.state').textContent = t.startedAt === null ? '停止中' : '● 計測中';
    const toggle = card.querySelector('[data-action="toggle"]');
    toggle.textContent = t.startedAt === null ? '▶ 開始' : 'Ⅱ 停止';
    toggle.setAttribute('aria-label', `${t.name}を${t.startedAt === null ? '開始' : '停止'}`);
    card.querySelector('.goal').textContent = t.targetMs ? `${ms >= t.targetMs ? '目標達成 ✓ · ' : ''}目標 ${format(t.targetMs)}` : '目標は「編集」から設定できます';
    const progress = card.querySelector('progress');
    progress.value = t.targetMs ? Math.min(100, ms / t.targetMs * 100) : 0;
    progress.setAttribute('aria-label', `${t.name}の目標達成率`);
  }
  $('#total').textContent = format(total);
  $('#running').textContent = state.timers.filter(t => t.startedAt !== null).length;
}
$('#add').onclick = () => { const t = createTimer(crypto.randomUUID()); if (commit({ ...state, timers: [...state.timers, t] })) edit(t); };
$('#stop-all').onclick = () => { const now = Date.now(); commit({ ...state, timers: state.timers.map(t => stop(t, now)) }); };
function edit(t) {
  editingId = t.id;
  const f = $('#edit-form').elements;
  f.name.value = t.name; f.memo.value = t.memo; f.color.value = t.color; f.target.value = t.targetMs / 60000; f.elapsed.value = '';
  $('#editor').showModal();
}
$('#cancel').onclick = () => $('#editor').close();
$('#edit-form').onsubmit = e => {
  e.preventDefault();
  const f = e.currentTarget.elements;
  const name = f.name.value.trim();
  if (!name) { f.name.focus(); return; }
  if (update(editingId, t => ({ ...t, name, memo: f.memo.value, color: f.color.value, targetMs: Number(f.target.value) * 60000, ...(f.elapsed.value !== '' ? { elapsedMs: Number(f.elapsed.value) * 1000, startedAt: t.startedAt === null ? null : Date.now() } : {}) }))) $('#editor').close();
};
$('#timers').onclick = e => {
  const button = e.target.closest('button[data-action]');
  if (!button || readOnly) return;
  const id = button.closest('.card').dataset.id, t = state.timers.find(t => t.id === id), action = button.dataset.action;
  if (action === 'toggle') update(id, t => t.startedAt === null ? start(t, Date.now()) : stop(t, Date.now()));
  if (action === 'edit') edit(t);
  if (action === 'reset' && confirm(`「${t.name}」を停止し、時間を0に戻しますか？`)) update(id, reset);
  if (action === 'delete' && confirm(`「${t.name}」の記録を削除しますか？`)) commit({ ...state, timers: state.timers.filter(t => t.id !== id) });
  if (action === 'up' || action === 'down') {
    const timers = [...state.timers], i = timers.findIndex(t => t.id === id), j = i + (action === 'up' ? -1 : 1);
    if (j >= 0 && j < timers.length) { [timers[i], timers[j]] = [timers[j], timers[i]]; commit({ ...state, timers }); }
  }
};
$('#export').onclick = () => {
  try {
    const raw = readOnly ? localStorage.getItem(KEY) : JSON.stringify(state, null, 2);
    if (raw === null) { notice('取り出せる保存データがありません。'); return; }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'multi-stopwatch-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { notice('バックアップを取り出せませんでした。'); }
};
$('#import').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw Error('ファイルが大きすぎます');
    const next = validate(JSON.parse(await file.text()));
    if (confirm('現在の記録をバックアップの内容で置き換えますか？ 動作中の計測は保存時からの時間も含めて再開します。')) commit(next);
  } catch { notice('このファイルは復元できません。現在の記録は変更していません。'); }
  finally { e.target.value = ''; }
};
// Hold a single-writer lock for the lifetime of this page. Other tabs may view only.
if (navigator.locks) navigator.locks.request('multi-stopwatch:writer', { ifAvailable: true }, async lock => {
  if (!lock) { readOnly = true; notice('別の画面で開いているため閲覧専用です。編集するには他の画面を閉じて再読み込みしてください。'); render(); return; }
  ownsLock = true; render();
  await new Promise(() => {});
});
else { readOnly = true; notice('このブラウザでは安全な保存に必要な機能が使えません。新しいブラウザで開いてください。'); }
window.addEventListener('storage', e => {
  if (e.key !== KEY && e.key !== null) return;
  try { state = load(localStorage); $('#editor').close(); render(); } catch { readOnly = true; notice('別の画面で保存データが変更されました。バックアップを確認してください。'); render(); }
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); $('#install').hidden = false; $('#install').onclick = async () => { await e.prompt(); $('#install').hidden = true; }; });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => { $('#offline').textContent = 'オフラインで利用できます'; }).catch(() => { $('#offline').textContent = 'オフライン準備に失敗しました。通信状態を確認して再読み込みしてください。'; });
} else $('#offline').textContent = 'この環境ではオフライン起動に対応していません';
render(); setInterval(tick, 250); document.addEventListener('visibilitychange', tick);
