const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:8080/Multi-Stopwatch/';
const ready = page => page.getByText('オフラインで利用できます', { exact: true }).waitFor();
const names = page => page.$$eval('.card .name', list => list.map(node => node.textContent));
async function addGroup(page, name) {
  await page.locator('#group-add [name=groupName]').fill(name);
  await page.locator('#group-add button[type=submit]').click();
  await page.locator(`.group-row .group-name[aria-label="${name}の名前"]`).waitFor();
}
async function addTimer(page, name, { group, ...fill } = {}) {
  await page.getByRole('button', { name: /新しい計測/ }).click();
  await page.locator('#edit-form [name=name]').fill(name);
  if (group) await page.locator('#edit-form [name=group]').selectOption({ label: group });
  for (const [field, value] of Object.entries(fill)) await page.locator(`#edit-form [name=${field}]`).fill(value);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator(`.card:has(.name:text-is(${JSON.stringify(name)}))`).waitFor();
}
async function openSheet(page, name) {
  await page.getByRole('button', { name: `${name}の詳細と操作` }).click();
  await page.locator('#sheet[open]').waitFor();
}
// A record written by the shipped v0.4 app, used to prove the migration on real data.
const v1Record = {
  version: 1,
  timers: [
    { id: 'a', name: '移行した計測', memo: '毎日', color: 'mint', elapsedMs: 45000000, startedAt: Date.now() - 60000, targetMs: 72000000 },
    { id: 'b', name: '移行した読書', memo: '', color: 'blue', elapsedMs: 11100000, startedAt: null, targetMs: 0 },
  ],
};

(async () => {
  fs.mkdirSync('test-results/visual', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await ready(page);

  // A v1 record opens, keeps running, and is only rewritten as v3 once something is saved.
  await page.evaluate(record => localStorage.setItem('multi-stopwatch:state:v1', JSON.stringify(record)), v1Record);
  await page.reload();
  await ready(page);
  assert.deepEqual(await names(page), ['移行した計測', '移行した読書']);
  assert.equal(await page.getAttribute('.card', 'data-state'), 'running');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('multi-stopwatch:state:v1')).version), 1);
  await page.getByRole('button', { name: '移行した読書を開始' }).click();
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('multi-stopwatch:state:v1')));
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.groups, []);
  assert.deepEqual(migrated.timers.map(t => t.groupId), [null, null]);
  assert.deepEqual(migrated.timers.map(t => t.elapsedMs), v1Record.timers.map(t => t.elapsedMs));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);

  // Groups: create, assign, and delete without losing the timers inside.
  await page.locator('#manage-groups').click();
  await page.locator('#groups[open]').waitFor();
  await addGroup(page, '学習');
  await addGroup(page, '趣味');
  await page.locator('#groups-close').click();
  await addTimer(page, '資格の勉強', { group: '学習', memo: '今日の積み重ね', targetH: '20' });
  await addTimer(page, '読書', { group: '趣味' });
  await addTimer(page, '個人開発');
  await page.getByRole('button', { name: '資格の勉強を開始' }).click();
  await page.locator('.time .sr-only').filter({ hasNotText: '0時間0分0秒' }).first().waitFor({ timeout: 3000 });
  assert.deepEqual(await page.$$eval('.meta-group', list => list.map(n => n.textContent)), ['学習', '趣味', '']);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/visual/mobile-light.png', fullPage: true });

  // Statistics: subtotals add up to the overall total and stay finite.
  await page.locator('#tab-stats').click();
  await page.locator('#panel-stats:not([hidden])').waitFor();
  assert.deepEqual(await page.$$eval('#stat-groups .stat-name', list => list.map(n => n.textContent)), ['学習', '趣味', '未分類']);
  assert.equal(await page.locator('#stat-running').textContent(), '1 / 3');
  assert.equal((await page.$$eval('#stat-ranking .stat-item', list => list.length)), 3);
  for (const share of await page.$$eval('#stat-groups .stat-share', list => list.map(n => n.textContent))) {
    assert.match(share, /^\d+%$/, `share "${share}" must be a plain percentage`);
  }
  await page.screenshot({ path: 'test-results/visual/mobile-stats.png', fullPage: true });
  await page.locator('#tab-timers').click();

  // Number entry: a focused box is fully selected, so typing replaces the value instead of appending.
  await openSheet(page, '個人開発');
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#editor[open]').waitFor();
  await page.locator('#edit-form [name=targetH]').focus();
  await page.keyboard.type('2');
  assert.equal(await page.locator('#edit-form [name=targetH]').inputValue(), '2', '0を置換できること');
  // A preset fills both boxes, and fine tuning afterwards releases the preset.
  await page.getByRole('button', { name: '30分', exact: true }).click();
  assert.equal(await page.locator('#edit-form [name=targetH]').inputValue(), '0');
  assert.equal(await page.locator('#edit-form [name=targetM]').inputValue(), '30');
  assert.equal(await page.getAttribute('#target-presets [data-preset="30"]', 'aria-pressed'), 'true');
  await page.locator('#edit-form [name=targetM]').focus();
  await page.keyboard.type('45');
  assert.equal(await page.getAttribute('#target-presets [data-preset="30"]', 'aria-pressed'), 'false');
  // The correction is folded away by default, with the current value visible on the summary.
  assert.equal(await page.evaluate(() => document.querySelector('#elapsed-fields').open), false);
  assert.equal(await page.locator('#elapsed-current').textContent(), '現在 00:00:00');
  await page.locator('#elapsed-fields > summary').click();
  await page.locator('#edit-form [name=elapsedH]').focus();
  await page.keyboard.type('3');
  // An emptied box is treated as zero on save rather than refused while typing.
  await page.locator('#edit-form [name=elapsedM]').fill('');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('#editor[open]').waitFor({ state: 'detached' }).catch(() => {});
  assert.equal(await page.locator('.card:has(.name:text-is("個人開発")) .time .sr-only').textContent(), '3時間0分0秒');
  assert.equal(await page.locator('.card:has(.name:text-is("個人開発")) .meta-note').textContent(), '目標達成 ✓', '3時間は45分の目標を超える');

  // Bulk sort applies to every timer and is saved.
  await page.locator('#sort').selectOption('name-asc');
  await page.locator('#apply-sort').click();
  const sorted = await names(page);
  assert.deepEqual(sorted, ['個人開発', '資格の勉強', '読書']);

  // The statistics update in place instead of rebuilding their rows, and keep step with the hero.
  await page.locator('#tab-stats').click();
  await page.locator('#panel-stats:not([hidden])').waitFor();
  await page.evaluate(() => {
    window.__added = 0;
    for (const id of ['stat-ranking', 'stat-groups']) {
      new MutationObserver(records => { for (const record of records) window.__added += record.addedNodes.length; })
        .observe(document.querySelector(`#${id}`), { childList: true });
    }
  });
  const before = await page.locator('#stat-total').textContent();
  await page.waitForTimeout(2100);
  const added = await page.evaluate(() => window.__added);
  assert.equal(added, 0, `statistics recreated ${added} rows in 2s; rows should be updated in place`);
  assert.notEqual(await page.locator('#stat-total').textContent(), before, '稼働中は1秒以内に更新される');
  // Both views of the same number must agree at the moment they are read.
  assert.deepEqual(...await page.evaluate(() => {
    const panel = document.querySelector('#stat-total').textContent;
    return [panel, document.querySelector('#total').textContent];
  }).then(([panel, hero]) => [[panel], [hero]]));
  await page.locator('#tab-timers').click();

  // Compact list and tap targets survive the new controls.
  for (const name of ['英語のリスニング', '筋トレ', 'ブログ執筆', '数学', 'ピアノの練習', '家事']) await addTimer(page, name);
  await page.evaluate(() => { document.querySelector('#notice').textContent = ''; scrollTo(0, 0); });
  const density = await page.evaluate(() => {
    const toolbar = document.querySelector('.toolbar');
    const limit = getComputedStyle(toolbar).position === 'fixed'
      ? Math.min(innerHeight, toolbar.getBoundingClientRect().top) : innerHeight;
    return [...document.querySelectorAll('.card')]
      .filter(card => { const box = card.getBoundingClientRect(); return box.top >= 0 && box.bottom <= limit; }).length;
  });
  assert.ok(density >= 4, `only ${density} rows visible at 390x844`);
  const smallest = await page.evaluate(() => Math.min(...[...document.querySelectorAll('button:not([hidden]), select, input[type=search]')]
    .map(el => el.getBoundingClientRect())
    .filter(box => box.width > 0)
    .map(box => Math.min(box.width, box.height))));
  assert.ok(smallest >= 44, `tap target ${smallest}px is below 44px`);

  // Reordering by keyboard still works and is kept.
  await page.locator('#filter').fill('ピアノ');
  assert.deepEqual(await names(page), ['ピアノの練習']);
  await page.locator('#filter').fill('');
  await page.locator('.card:has(.name:text-is("家事")) .grip').focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const reordered = await names(page);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'grip');

  // Theme choice applies at once and survives a reload, together with groups and order.
  // One button flips to the opposite of what is on screen and says so.
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light', '端末がライトなら初回はライト');
  assert.equal(await page.getAttribute('#theme-toggle', 'aria-label'), 'ダークテーマに切り替える');
  await page.locator('#theme-toggle').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.getAttribute('#theme-toggle', 'aria-label'), 'ライトテーマに切り替える');
  assert.equal(await page.getAttribute('meta[name=theme-color]', 'content'), '#121316');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('multi-stopwatch:prefs:v1')).theme), 'dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.icon-moon')).display), 'none', 'ダーク中は太陽（次の状態）を出す');
  await page.locator('#theme-toggle').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.locator('#theme-toggle').click();

  // The list's action bar does not sit over the statistics while they are being read.
  await page.locator('#tab-stats').click();
  await page.locator('#panel-stats:not([hidden])').waitFor();
  assert.equal(await page.evaluate(() => {
    const bar = document.querySelector('.toolbar');
    if (getComputedStyle(bar).display === 'none') return true;
    const barBox = bar.getBoundingClientRect();
    return [...document.querySelectorAll('#stat-ranking .stat-item')]
      .every(row => { const box = row.getBoundingClientRect(); return box.bottom <= barBox.top || box.top >= barBox.bottom; });
  }), true, '統計タブで固定バーがランキングに重ならないこと');
  await page.screenshot({ path: 'test-results/visual/mobile-stats-dark.png', fullPage: true });
  await page.locator('#tab-timers').click();
  await page.screenshot({ path: 'test-results/visual/mobile-dark.png', fullPage: true });

  // Landscape and desktop show the list and the statistics side by side.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('body[data-layout="split"]').waitFor();
  assert.equal(await page.evaluate(() => !document.querySelector('#panel-stats').hidden && !document.querySelector('#panel-timers').hidden), true);
  assert.equal(await page.evaluate(() => document.querySelector('#view-tabs').hidden), true);
  await page.screenshot({ path: 'test-results/visual/desktop-dark.png', fullPage: true });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('body[data-layout="split"]').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/visual/landscape.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#view-tabs:not([hidden])').waitFor();

  await page.reload();
  await ready(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.deepEqual(await names(page), reordered);
  await page.getByRole('button', { name: '資格の勉強を停止' }).waitFor();

  // Deleting a group keeps its timers and moves them to 未分類.
  await page.locator('#manage-groups').click();
  await page.locator('#groups[open]').waitFor();
  await page.locator('[aria-label="学習を削除"]').click();
  await page.locator('#confirm[open]').waitFor();
  await page.locator('#confirm-ok').click();
  await page.locator('.group-row .group-name[aria-label="学習の名前"]').waitFor({ state: 'detached' });
  await page.locator('#groups-close').click();
  assert.equal((await names(page)).length, sorted.length + 6);
  assert.equal(await page.locator('.card:has(.name:text-is("資格の勉強")) .meta-group').textContent(), '');

  // Offline start keeps records, groups and the chosen theme.
  await context.setOffline(true);
  await page.reload();
  await ready(page).catch(() => {});
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.getByRole('button', { name: '資格の勉強を停止' }).click();
  assert.equal(await page.locator('.state-text').first().textContent(), '停止中');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('multi-stopwatch:state:v1')).version), 3);

  // Help: opens from the header, carries the backup controls, closes on Escape, returns focus.
  assert.equal(await page.locator('#help').evaluate(element => getComputedStyle(element).display), 'none', '閉じたヘルプが本文として表示されないこと');
  await page.locator('#help-open').click();
  await page.locator('#help[open]').waitFor();
  assert.equal(await page.locator('#help-title').textContent(), '使い方とデータについて');
  assert.equal(await page.locator('#help #export').isVisible(), true, 'バックアップ操作がヘルプ内にあること');
  assert.equal(await page.locator('#help #import').count(), 1);
  assert.equal(await page.evaluate(() => document.querySelectorAll('details.help').length), 0, '旧ヘルプの二重導線が残っていないこと');
  const beforeHelp = await page.evaluate(() => scrollY);
  await page.keyboard.press('Escape');
  await page.locator('#help[open]').waitFor({ state: 'detached' }).catch(() => {});
  assert.equal(await page.evaluate(() => document.activeElement.id), 'help-open', 'フォーカスが開いたボタンへ戻ること');
  assert.equal(await page.evaluate(() => scrollY), beforeHelp, 'ヘルプを閉じてもスクロール位置を壊さないこと');
  await page.locator('#help-open').click();
  await page.locator('#help[open]').waitFor();
  await page.locator('#help-close').click();
  assert.equal(await page.evaluate(() => document.querySelector('#help').open), false);
  assert.equal(await page.locator('#help').evaluate(element => getComputedStyle(element).display), 'none', '閉じるボタン後もヘルプが非表示であること');

  // Every icon the browser and the home screen ask for must actually exist.
  const iconStatuses = await page.evaluate(async () => {
    const manifestHref = document.querySelector('link[rel=manifest]').href;
    const manifest = await (await fetch(manifestHref)).json();
    const urls = [
      ...[...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map(link => link.href),
      ...manifest.icons.map(icon => new URL(icon.src, manifestHref).href),
    ];
    const seen = {};
    for (const url of [...new Set(urls)]) seen[new URL(url).pathname.split('/').pop()] = (await fetch(url)).status;
    return { seen, manifest: { name: manifest.name, short_name: manifest.short_name, icons: manifest.icons } };
  });
  for (const [file, status] of Object.entries(iconStatuses.seen)) assert.equal(status, 200, `${file} が ${status}`);
  assert.ok(Object.keys(iconStatuses.seen).length >= 6, `参照アイコンが少なすぎる: ${Object.keys(iconStatuses.seen)}`);
  assert.equal(iconStatuses.manifest.name, 'Multi Stopwatch');
  assert.equal(iconStatuses.manifest.short_name, 'Multi Stopwatch');
  assert.equal(await page.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content'), 'Multi Stopwatch');
  // any and maskable must be separate files, not the same image declared twice.
  const anySources = iconStatuses.manifest.icons.filter(icon => icon.purpose === 'any').map(icon => icon.src);
  const maskableSources = iconStatuses.manifest.icons.filter(icon => icon.purpose === 'maskable').map(icon => icon.src);
  assert.ok(anySources.length >= 2 && maskableSources.length >= 2, 'any と maskable をそれぞれ用意すること');
  assert.equal(anySources.some(src => maskableSources.includes(src)), false, 'any と maskable が同じ資産を指していないこと');

  // The header stays on one line and keeps 44px targets on the narrowest phones.
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const header = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.header-actions button')].map(b => b.getBoundingClientRect());
      const intro = document.querySelector('.intro').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        smallest: Math.round(Math.min(...buttons.map(box => Math.min(box.width, box.height)))),
        rows: new Set(buttons.map(box => Math.round(box.top))).size,
        withinIntro: buttons.every(box => box.right <= intro.right + 0.5),
      };
    });
    assert.equal(header.overflow, 0, `${width}px で横スクロールが出ている`);
    assert.ok(header.smallest >= 44, `${width}px でヘッダーのボタンが ${header.smallest}px`);
    assert.equal(header.rows, 1, `${width}px でヘッダーのボタンが折り返している`);
    assert.equal(header.withinIntro, true);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  assert.deepEqual(errors, []);
  // v0.7: use a fresh context so existing regression fixtures remain independent.
  await context.close();
  const setsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const setsPage = await setsContext.newPage();
  setsPage.on('pageerror', e => errors.push(String(e)));
  await setsPage.goto(base); await ready(setsPage);
  const record = () => setsPage.evaluate(() => JSON.parse(localStorage.getItem('multi-stopwatch:state:v1')));
  async function addChild(name) {
    await setsPage.locator('[data-action="add-child"]:visible').click();
    await setsPage.locator('#edit-form [name=name]').fill(name);
    await setsPage.getByRole('button', { name:'保存', exact:true }).click();
    await setsPage.getByRole('button', {name:`${name}を開始`,exact:true}).waitFor();
  }
  await setsPage.locator('#add-set').click();
  await setsPage.locator('#edit-form [name=name]').fill('資格勉強');
  await setsPage.getByRole('button', {name:'保存',exact:true}).click();
  // v0.8: a new set is empty, so the keyboard lands on 「＋ 子を追加」 rather than the set's own toggle.
  await setsPage.waitForFunction(() => document.activeElement?.dataset.action === 'add-child', null, { timeout: 2000 });
  await addChild('テキスト'); await addChild('問題演習');
  await setsPage.getByRole('button', {name:'テキストを開始',exact:true}).click();
  await setsPage.getByRole('button', {name:'問題演習を開始',exact:true}).click();
  let data = await record();
  assert.equal(data.timers.filter(t=>t.kind==='timer' && t.startedAt!==null).length, 1);
  assert.equal(data.timers.find(t=>t.name==='テキスト').startedAt, null);
  assert.equal(data.timers.find(t=>t.name==='資格勉強').lastChildId, data.timers.find(t=>t.name==='問題演習').id);
  await setsPage.getByRole('button', {name:'資格勉強を停止',exact:true}).click();
  await setsPage.getByRole('button', {name:'資格勉強を開始',exact:true}).click();
  assert.notEqual((await record()).timers.find(t=>t.name==='問題演習').startedAt, null);
  // v0.8: the set row carries its own disclosure, so it keeps a timer row's controls and height.
  const setRow = setsPage.locator('.card[data-kind=set]');
  assert.equal(await setsPage.locator('[data-action=expand]').count(), 0, '専用の展開ボタンは廃止');
  assert.equal(await setRow.locator('[data-action=open]').getAttribute('aria-expanded'), 'true');
  await setRow.locator('[data-action=open]').click();
  assert.equal(await setsPage.locator('.card').count(),1);
  assert.equal(await setRow.locator('[data-action=open]').getAttribute('aria-expanded'), 'false');
  await setsPage.reload(); await ready(setsPage);
  assert.equal(await setsPage.locator('.card').count(),1);
  await setRow.locator('[data-action=open]').click();
  assert.equal(await setsPage.locator('.card').count(),3);
  // The row proper, without the actions an expanded set adds underneath it.
  const heights = await setsPage.evaluate(() => ({
    set: Math.round(document.querySelector('.card[data-kind=set] > .row').getBoundingClientRect().height),
    timer: Math.round(document.querySelector('.card[data-kind=timer] > .row').getBoundingClientRect().height),
  }));
  assert.equal(heights.set, heights.timer, `セット行 ${heights.set}px と通常行 ${heights.timer}px の高さが揃っていない`);
  assert.equal(await setRow.locator('.meta-kind').textContent(), 'セット');
  assert.equal(await setRow.locator('.sum').isVisible(), true, '合計であることを示す印');
  assert.equal(await setRow.locator('.state').isVisible(), false, '状態は注記が言葉で伝える');
  await setsPage.locator('#stop-all').click();
  await setsPage.screenshot({ path:'test-results/visual/sets-light.png',fullPage:true });
  await setsPage.locator('#theme-toggle').click();
  await setsPage.waitForTimeout(200); // Let the 150ms theme transition settle before visual review.
  await setsPage.screenshot({ path:'test-results/visual/sets-dark.png',fullPage:true });
  await setsPage.locator('#tab-stats').click();
  assert.equal(await setsPage.locator('#stat-ranking .stat-item').count(),2);
  // v0.8: a set is listed with its children under it instead of one run-on line.
  assert.equal(await setsPage.locator('#stat-sets .stat-item').count(),3, 'セット1行＋子2行');
  assert.equal(await setsPage.locator('#stat-sets .stat-item[data-child=false]').count(),1);
  assert.deepEqual(await setsPage.$$eval('#stat-sets .stat-item[data-child=true] .stat-name', xs=>xs.map(x=>x.textContent)).then(xs=>xs.sort()), ['テキスト','問題演習']);
  assert.equal(await setsPage.locator('#stat-total').textContent(),await setsPage.locator('#stat-sets .stat-item[data-child=false] .stat-time').textContent());
  // Children's shares are relative to their own set, so a breakdown adds up on its own.
  const breakdown = await setsPage.$$eval('#stat-sets .stat-item[data-child=true] .stat-share', xs=>xs.map(x=>parseInt(x.textContent,10)));
  assert.equal(breakdown.reduce((a,b)=>a+b,0) >= 99, true, `子の割合合計 ${breakdown}`);
  await setsPage.locator('#tab-timers').click();
  // Direct delete and undo preserve the complete family and running state.
  await setsPage.locator('#delete-mode').click();
  await setsPage.getByRole('button',{name:'テキストを削除',exact:true}).click();
  assert.equal((await record()).timers.length,2);
  await setsPage.locator('#undo').click();
  assert.equal((await record()).timers.length,3);
  await setsPage.getByRole('button',{name:'資格勉強を削除',exact:true}).click();
  assert.equal((await record()).timers.every(t=>t.parentId===null),true);
  await setsPage.locator('#undo').click();
  assert.equal((await record()).timers.filter(t=>t.parentId!==null).length,2);
  await setsPage.getByRole('button',{name:'テキストを削除',exact:true}).click();
  await setsPage.getByRole('button',{name:'問題演習を開始',exact:true}).click();
  assert.equal(await setsPage.locator('#undo-delete').isVisible(),false,'a subsequent record change invalidates undo');
  // v0.8: deleting several in a row keeps the keyboard on the list instead of the toolbar.
  await setsPage.getByRole('button',{name:'問題演習を削除',exact:true}).click();
  // Focus moves on the next frame, after the list has been rebuilt.
  await setsPage.waitForFunction(() => document.activeElement?.dataset.action === 'delete', null, { timeout: 2000 });
  assert.match(await setsPage.locator('#undo-delete span').textContent(),/次の操作まで/,'取り消せる期間を伝えること');
  await setsPage.locator('#undo').click();
  await setsPage.locator('#delete-mode').click();
  // v0.8: one tap takes a child out of its set, without going through the editor.
  await openSheet(setsPage,'問題演習');
  assert.match(await setsPage.locator('#sheet-group').textContent(),/セット：資格勉強/);
  await setsPage.getByRole('button',{name:'セットから出す',exact:true}).click();
  assert.equal((await record()).timers.find(t=>t.name==='問題演習').parentId,null);
  assert.equal((await record()).timers.find(t=>t.kind==='set').lastChildId,null);
  await openSheet(setsPage,'問題演習');
  assert.equal(await setsPage.locator('[data-sheet=unparent]').isVisible(),false,'単独の計測には出さない');
  await setsPage.locator('#sheet-close').click();
  await setsPage.locator('#undo-delete').isVisible();
  // Editing a child can detach it; the old parent no longer resumes a foreign child.
  await openSheet(setsPage,'問題演習');
  await setsPage.getByRole('button',{name:'編集',exact:true}).click();
  assert.equal(await setsPage.locator('#edit-form [name=parent]').inputValue(),'','出したあとは所属なしで開く');
  await setsPage.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal((await record()).timers.find(t=>t.kind==='set').lastChildId,null);
  await setsPage.locator('#stop-all').click();
  for (const [width,height] of [[320,844],[844,390],[1280,900]]) {
    await setsPage.setViewportSize({width,height});
    assert.equal(await setsPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`sets overflow at ${width}`);
    await setsPage.screenshot({path:`test-results/visual/sets-${width}.png`,fullPage:true});
  }
  await setsContext.setOffline(true);
  await setsPage.reload();
  await setsPage.locator('.card').first().waitFor();
  assert.equal(await setsPage.locator('#help').isVisible(),false);
  // A second page cannot edit or delete while the writer still owns its lock.
  const viewer = await setsContext.newPage(); await viewer.goto(base);
  await viewer.getByText(/別の画面で開いているため閲覧専用/).waitFor();
  assert.equal(await viewer.locator('#delete-mode').isDisabled(),true);
  assert.equal(await viewer.locator('#add-set').isDisabled(),true);
  await viewer.close();
  await setsContext.setOffline(false);
  // Large hierarchy: only parents take space until expanded; search keeps matching parent context.
  await setsPage.evaluate(() => {
    const timers = [];
    for (let p=0;p<10;p++) {
      timers.push({id:`set-${p}`,kind:'set',parentId:null,name:`資格勉強 ${p}`,memo:'',color:'mint',groupId:null,targetMs:0,lastChildId:null});
      for (let c=0;c<5;c++) timers.push({id:`child-${p}-${c}`,kind:'timer',parentId:`set-${p}`,name:`演習 ${p}-${c}`,memo:'',color:'mint',groupId:null,targetMs:0,elapsedMs:60000,startedAt:null});
    }
    localStorage.setItem('multi-stopwatch:state:v1',JSON.stringify({version:3,timers,groups:[]}));
  });
  await setsPage.setViewportSize({width:390,height:844});
  await setsPage.reload(); await ready(setsPage);
  assert.equal(await setsPage.locator('.card').count(),10);
  const parentDensity = await setsPage.locator('.card').evaluateAll(rows => rows.filter(row=>{
    const r=row.getBoundingClientRect(), bottom=document.querySelector('.toolbar').getBoundingClientRect().top;
    return r.top>=0 && r.bottom<=bottom;
  }).length);
  assert.ok(parentDensity>=5,`only ${parentDensity} collapsed parents visible`);
  await setsPage.locator('#filter').fill('演習 3-2');
  assert.deepEqual(await names(setsPage),['資格勉強 3','演習 3-2']);
  await setsPage.locator('#filter').fill('');
  await setsPage.screenshot({path:'test-results/visual/sets-dense.png',fullPage:true});
  // v0.8: the documented ceiling, 20 sets and 100 timers, has to load, sort and cap the add buttons.
  await setsPage.evaluate(() => {
    const timers = [];
    for (let p=0;p<20;p++) {
      timers.push({id:`s${p}`,kind:'set',parentId:null,name:`セット${p}`,memo:'',color:'blue',groupId:null,targetMs:0,lastChildId:null});
      for (let c=0;c<5;c++) timers.push({id:`c${p}-${c}`,kind:'timer',parentId:`s${p}`,name:`子 ${p}-${c}`,memo:'',color:'blue',groupId:null,targetMs:0,elapsedMs:(p*5+c)*60000,startedAt:null});
    }
    localStorage.setItem('multi-stopwatch:state:v1',JSON.stringify({version:3,timers,groups:[]}));
  });
  await setsPage.reload(); await ready(setsPage);
  assert.equal(await setsPage.locator('.card').count(),20);
  assert.equal(await setsPage.locator('#add').isDisabled(),true,'100計測で追加を止めること');
  assert.equal(await setsPage.locator('#add-set').isDisabled(),true,'20セットで追加を止めること');
  await setsPage.locator('#sort').selectOption({index:1});
  await setsPage.locator('#apply-sort').click();
  assert.equal((await record()).timers.filter(t=>t.parentId!==null).length,100,'並べ替えが親子を壊さないこと');
  await setsPage.locator('#tab-stats').click();
  // Every set keeps a bounded breakdown: one parent row plus at most three children and a remainder.
  assert.equal(await setsPage.locator('#stat-sets .stat-item[data-child=false]').count(),20);
  assert.equal(await setsPage.locator('#stat-sets .stat-item[data-child=true]').count(),20*4);
  assert.equal(await setsPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'20セットの統計で横スクロールなし');
  await setsPage.locator('#tab-timers').click();
  assert.deepEqual(errors,[]);
  await setsContext.close();
  await browser.close();
  console.log(`PASS: v1→v3 migration, groups, statistics, sorting, compact list (${density} rows, ${smallest}px targets), theme, help, icons, offline; sets, exclusive switch, resume, undo, detach, 10-set/50-timer density, 20-set/100-timer ceiling, search and writer lock`);
})().catch(error => { console.error(error); process.exit(1); });
