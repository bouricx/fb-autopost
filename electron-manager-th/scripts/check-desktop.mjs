import { _electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = await mkdtemp(join(tmpdir(), 'autopost-desktop-check-'));
const output = process.env.AUTOPOST_SCREENSHOTS || join(directory, 'screenshots');
await mkdir(output, { recursive: true });
let application;
try {
  application = await _electron.launch({ executablePath: process.env.AUTOPOST_EXE,
    env: { ...process.env, AUTOPOST_SESSION_TEST: '1', APPDATA: directory }, timeout: 60000 });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'ภาพรวม', exact: true }).waitFor();
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), '0.6.11');
  assert.deepEqual(await page.evaluate(() => window.autopost.listAccounts()), []);
  assert.equal((await page.evaluate(() => window.autopost.workerStatus())).running, false);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  for (const name of ['ภาพรวมและสถานะ', '1. บัญชีและปลายทาง', '2. สร้างงานและตั้งเวลา', '3. คิวและผลการทำงาน', 'Log การทำงาน', 'ตั้งค่า']) {
    await page.locator('nav').getByRole('button', { name, exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.screenshot({ path: join(output, 'desktop-settings.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Packaged Windows desktop passed: isolated data, session-test mode, queue disabled, six navigation views, small window. No social actions sent.');
} finally {
  try { await application?.close(); }
  finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
}
