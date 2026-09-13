const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:8080/Multi-Stopwatch/';
const ready = page => page.getByText('オフラインで利用できます', { exact: true }).waitFor();
async function addTimer(page, name, fill = {}) {
  await page.getByRole('button', { name: /新しい計測/ }).click();
  await page.locator('[name=name]').fill(name);
  for (const [field, value] of Object.entries(fill)) await page.locator(`[name=${field}]`).fill(value);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator(`.card:has(.name:text-is(${JSON.stringify(name)}))`).waitFor();
}
const names = page => page.$$eval('.card .name', list => list.map(node => node.textContent));
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
  await addTimer(page, '資格の勉強', { memo: '今日の積み重ね', targetH: '20' });
  await page.getByRole('button', { name: '資格の勉強を開始' }).click();
  await page.locator('.time .sr-only').filter({ hasNotText: '0時間0分0秒' }).waitFor({ timeout: 3000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/visual/mobile-light.png', fullPage: true });

  // Compact list: several stopwatches have to be readable at once on a phone.
  for (const name of ['読書', '個人開発', '英語のリスニング', '筋トレ', 'ブログ執筆', '数学', 'ピアノの練習', '家事', '散歩']) await addTimer(page, name);
  await page.evaluate(() => scrollTo(0, 0));
  const density = await page.evaluate(() => {
    const limit = Math.min(innerHeight, document.querySelector('.toolbar').getBoundingClientRect().top);
    const cards = [...document.querySelectorAll('.card')];
    return cards.filter(card => { const box = card.getBoundingClientRect(); return box.top >= 0 && box.bottom <= limit; }).length;
  });
  assert.ok(density >= 4, `only ${density} rows visible at 390x844`);
  const smallest = await page.evaluate(() => Math.min(...[...document.querySelectorAll('button:not([hidden]), .theme-option')]
    .map(el => el.getBoundingClientRect())
    .filter(box => box.width > 0)
    .map(box => Math.min(box.width, box.height))));
  assert.ok(smallest >= 44, `tap target ${smallest}px is below 44px`);
  await page.screenshot({ path: 'test-results/visual/mobile-list.png', fullPage: true });

  // Finding one timer among many.
  await page.locator('#filter').fill('ピアノ');
  assert.deepEqual(await names(page), ['ピアノの練習']);
  await page.locator('#filter').fill('');

  // Reordering: keyboard must keep working, and the order has to survive a reload.
  await page.locator('.card:has(.name:text-is("散歩")) .grip').focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const reordered = await names(page);
  assert.deepEqual(reordered.slice(7), ['散歩', 'ピアノの練習', '家事']);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'grip');

  // Theme: an explicit choice applies at once and survives a reload.
  await page.getByRole('radio', { name: 'ダーク' }).check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.getAttribute('meta[name=theme-color]', 'content'), '#0b0e14');
  await page.screenshot({ path: 'test-results/visual/mobile-dark.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'test-results/visual/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await ready(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.evaluate(() => document.querySelector('#theme input:checked').value), 'dark');
  assert.deepEqual(await names(page), reordered);
  await page.getByRole('button', { name: '資格の勉強を停止' }).waitFor();

  // Offline start keeps the running measurement and the chosen theme.
  await context.setOffline(true);
  await page.reload();
  await ready(page).catch(() => {});
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.getByRole('button', { name: '資格の勉強を停止' }).click();
  assert.equal(await page.locator('.state-text').first().textContent(), '停止中');

  // The detail sheet carries the low frequency actions.
  await context.setOffline(false);
  await page.getByRole('button', { name: '読書の詳細と操作' }).click();
  await page.locator('#sheet[open]').waitFor();
  assert.equal(await page.locator('#sheet-title').textContent(), '読書');
  await page.locator('#sheet-close').click();

  assert.deepEqual(errors, []);
  await browser.close();
  console.log(`PASS: compact list (${density} rows visible, ${smallest}px tap targets), filter, keyboard reorder + persistence, theme choice + persistence, offline start, detail sheet, no browser errors`);
})().catch(error => { console.error(error); process.exit(1); });
