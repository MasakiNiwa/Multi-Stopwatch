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

  // A v1 record opens, keeps running, and is only rewritten as v2 once something is saved.
  await page.evaluate(record => localStorage.setItem('multi-stopwatch:state:v1', JSON.stringify(record)), v1Record);
  await page.reload();
  await ready(page);
  assert.deepEqual(await names(page), ['移行した計測', '移行した読書']);
  assert.equal(await page.getAttribute('.card', 'data-state'), 'running');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('multi-stopwatch:state:v1')).version), 1);
  await page.getByRole('button', { name: '移行した読書を開始' }).click();
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('multi-stopwatch:state:v1')));
  assert.equal(migrated.version, 2);
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
  const smallest = await page.evaluate(() => Math.min(...[...document.querySelectorAll('button:not([hidden]), .theme-option, select, input[type=search]')]
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
  await page.getByRole('radio', { name: 'ダーク' }).check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.getAttribute('meta[name=theme-color]', 'content'), '#121316');

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
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('multi-stopwatch:state:v1')).version), 2);

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(`PASS: v1→v2 migration, groups CRUD, statistics, bulk sort, compact list (${density} rows, ${smallest}px targets), tabs/split layout, theme + order persistence, offline start, no browser errors`);
})().catch(error => { console.error(error); process.exit(1); });
