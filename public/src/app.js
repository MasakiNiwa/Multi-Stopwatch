// Wiring: owns the state, applies domain functions, persists, then asks the UI to redraw.
import { createTimer, elapsed, start, stop, reset, setElapsed, running, validate, format, MAX_TIMERS } from './model.js';
import { load, save, KEY } from './storage.js';
import { sync, paint, notice, ask, openEditor, readEditor, closeEditor, editorOpen, focusCard } from './ui.js';

const $ = selector => document.querySelector(selector);
let state, draft = null, editing = null, readOnly = false, ownsLock = false;
const editable = () => !readOnly && ownsLock;

try {
  state = load(localStorage);
} catch {
  state = { version: 1, timers: [] };
  readOnly = true;
  notice('保存データを読み込めません。元データの上書きを防ぐため編集を停止しました。「バックアップを保存」で元データを取り出せます。', { sticky: true });
  document.querySelector('.help').open = true; // The recovery button must not stay behind a closed section.
}

function render() {
  sync(state.timers, editable());
  $('#add').disabled = !editable() || state.timers.length >= MAX_TIMERS;
  $('#stop-all').disabled = !editable() || running(state.timers) === 0;
  $('#import').disabled = !editable();
  paint(state.timers, Date.now(), editable());
}
function commit(next) {
  if (!editable()) return false;
  try { save(localStorage, next); state = next; render(); return true; }
  catch { notice('保存できませんでした。操作は反映していません。空き容量やブラウザの保存設定を確認してください。', { sticky: true }); return false; }
}
const update = (id, fn) => commit({ ...state, timers: state.timers.map(t => (t.id === id ? fn(t) : t)) });
const find = id => state.timers.find(t => t.id === id);

function tick() {
  if (document.hidden) return;
  paint(state.timers, Date.now(), editable());
}

$('#add').onclick = () => {
  draft = createTimer(crypto.randomUUID(), '');
  editing = { ...draft, snapshotMs: 0 };
  openEditor(draft, true);
};
$('#stop-all').onclick = () => {
  const now = Date.now(), count = running(state.timers);
  if (commit({ ...state, timers: state.timers.map(t => stop(t, now)) })) notice(`${count}件の計測を停止しました。`);
};
$('#cancel').onclick = () => closeEditor();
$('#editor').addEventListener('close', () => { draft = null; editing = null; });

$('#edit-form').onsubmit = event => {
  event.preventDefault();
  const values = readEditor();
  if (!values) return;
  const base = editing;
  // The elapsed fields start at the value shown when the dialog opened; an untouched field must not
  // freeze a running timer, so only an actual edit is applied.
  const changed = values.elapsedMs !== Math.floor(base.snapshotMs / 1000) * 1000;
  const apply = t => {
    const edited = { ...t, name: values.name, memo: values.memo, color: values.color, targetMs: values.targetMs };
    return changed ? setElapsed(edited, values.elapsedMs, Date.now()) : edited;
  };
  if (draft) {
    const created = apply(draft);
    if (commit({ ...state, timers: [...state.timers, created] })) { closeEditor(); focusCard(created.id); }
  } else if (update(base.id, apply)) {
    closeEditor();
    focusCard(base.id);
  }
  // The dialog restores focus to its opener on close; move it onto the card the user just worked on.
};

$('#timers').onclick = async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || !editable()) return;
  const id = button.closest('.card').dataset.id, action = button.dataset.action, timer = find(id);
  if (!timer) return;
  if (action === 'toggle') update(id, t => (t.startedAt === null ? start(t, Date.now()) : stop(t, Date.now())));
  if (action === 'edit') { editing = { ...timer, snapshotMs: elapsed(timer, Date.now()) }; openEditor({ ...timer, elapsedMs: editing.snapshotMs }, false); }
  if (action === 'reset'
    && await ask({ title: '時間を0に戻しますか？', message: `「${timer.name}」を停止して、${format(elapsed(timer, Date.now()))} を0に戻します。元には戻せません。`, confirmLabel: 'リセットする' })) {
    update(id, reset);
  }
  if (action === 'delete'
    && await ask({ title: 'この計測を削除しますか？', message: `「${timer.name}」（${format(elapsed(timer, Date.now()))}）の記録を削除します。元には戻せません。`, confirmLabel: '削除する' })) {
    if (commit({ ...state, timers: state.timers.filter(t => t.id !== id) })) { notice(`「${timer.name}」を削除しました。`); $('#add').focus(); }
  }
  if (action === 'up' || action === 'down') {
    const timers = [...state.timers], i = timers.findIndex(t => t.id === id), j = i + (action === 'up' ? -1 : 1);
    if (j >= 0 && j < timers.length) {
      [timers[i], timers[j]] = [timers[j], timers[i]];
      // Keep the keyboard on the card that moved, even when it reached an end and that button is now disabled.
      if (commit({ ...state, timers })) {
        const card = document.querySelector(`.card[data-id="${id}"]`);
        (card?.querySelector(`[data-action="${action}"]:not(:disabled)`) ?? card?.querySelector('[data-action]:not(:disabled)'))?.focus();
      }
    }
  }
};

$('#export').onclick = () => {
  try {
    const raw = readOnly ? localStorage.getItem(KEY) : JSON.stringify(state, null, 2);
    if (raw === null) { notice('取り出せる保存データがありません。'); return; }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `multi-stopwatch-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('バックアップを保存しました。');
  } catch { notice('バックアップを取り出せませんでした。'); }
};
$('#import').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw Error('ファイルが大きすぎます');
    const next = validate(JSON.parse(await file.text()));
    const message = `現在の${state.timers.length}件を、バックアップの${next.timers.length}件で置き換えます。動作中の計測は保存時からの時間も含めて再開します。`;
    if (await ask({ title: 'バックアップから復元しますか？', message, confirmLabel: '復元する' }) && commit(next)) notice('バックアップから復元しました。');
  } catch { notice('このファイルは復元できません。現在の記録は変更していません。', { sticky: true }); }
  finally { event.target.value = ''; }
};

// Hold a single-writer lock for the lifetime of this page. Other tabs may view only.
if (navigator.locks) {
  navigator.locks.request('multi-stopwatch:writer', { ifAvailable: true }, async lock => {
    if (!lock) {
      readOnly = true;
      notice('別の画面で開いているため閲覧専用です。編集するには他の画面を閉じて、この画面を再読み込みしてください。', { sticky: true });
      render();
      return;
    }
    ownsLock = true;
    render();
    await new Promise(() => {});
  });
} else {
  readOnly = true;
  notice('このブラウザでは安全な保存に必要な機能が使えません。新しいブラウザで開いてください。', { sticky: true });
}

window.addEventListener('storage', event => {
  if (event.key !== KEY && event.key !== null) return;
  try {
    state = load(localStorage);
    if (editorOpen()) closeEditor();
    render();
  } catch {
    readOnly = true;
    notice('別の画面で保存データが変更されました。バックアップを確認してください。', { sticky: true });
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
          notice('新しいバージョンを準備しました。この計測を続けたまま、すべての画面を閉じて開き直すと切り替わります。', { sticky: true });
        }
      });
    });
    return navigator.serviceWorker.ready;
  }).then(() => { $('#offline').textContent = 'オフラインで利用できます'; })
    .catch(() => { $('#offline').textContent = 'オフライン準備に失敗しました。通信状態を確認して再読み込みしてください。'; });
} else {
  $('#offline').textContent = 'この環境ではオフライン起動に対応していません';
}

render();
setInterval(tick, 250);
document.addEventListener('visibilitychange', tick);
