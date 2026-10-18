'use strict';
const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fsh777-smoke-'));
  const app = await electron.launch({ args: ['.', `--user-data-dir=${temp}`], timeout: 60000 });
  try {
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL('fsh777://studio/index.html');
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 });
    await expect(page.locator('.layer-row')).toHaveCount(7);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => window.fsh777.desktop), true);
    await app.evaluate(({ session }, directory) => session.defaultSession.on('will-download', (_event, item) => item.setSavePath(require('node:path').join(directory, item.getFilename()))), temp);
    await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
    await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Файл сохранён', { timeout: 30000 });
    const files = await fs.readdir(temp), png = files.find(file => file.endsWith('.png')); assert.ok(png);
    const bytes = await fs.readFile(path.join(temp, png)); assert.equal(bytes.readUInt32BE(16), 1600); assert.equal(bytes.readUInt32BE(20), 1000);
    await page.screenshot({ path: 'test-results/desktop.png' });
    assert.deepEqual(errors, []);
    console.log('Desktop smoke passed: sandbox, custom protocol, layers and actual PNG export.');
  } finally { await app.close(); await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
})().catch(error => { console.error(error); process.exit(1); });
