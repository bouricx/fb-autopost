import { _electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = await mkdtemp(join(tmpdir(), 'autopost-desktop-check-'));
const output = process.env.AUTOPOST_SCREENSHOTS || join(directory, 'screenshots');
await mkdir(output, { recursive: true });
let application;
const watchdog = setTimeout(() => { console.error('Desktop check exceeded 120 seconds'); process.exit(1); }, 120000);
watchdog.unref();
try {
  console.log('Launching packaged Electron:', process.env.AUTOPOST_EXE);
  application = await _electron.launch({ executablePath: process.env.AUTOPOST_EXE,
    env: { ...process.env, AUTOPOST_SESSION_TEST: '1', APPDATA: directory }, timeout: 60000 });
  application.process().stdout?.on('data', data => process.stdout.write(data));
  application.process().stderr?.on('data', data => process.stderr.write(data));
  console.log('Electron inspector connected; waiting for first window');
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'ภาพรวม', exact: true }).waitFor();
  console.log('Renderer ready');
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), '0.6.11');
  assert.deepEqual(await page.evaluate(() => window.autopost.listAccounts()), []);
  assert.equal((await page.evaluate(() => window.autopost.workerStatus())).running, false);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  for (const name of ['ภาพรวมและสถานะ', '1. บัญชีและปลายทาง', '2. สร้างงานและตั้งเวลา', '3. คิวและผลการทำงาน', 'Log การทำงาน', 'ตั้งค่า']) {
    console.log('Checking view:', name);
    await page.locator('nav').getByRole('button', { name, exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.screenshot({ path: join(output, 'desktop-settings.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Packaged Windows desktop passed: isolated data, session-test mode, queue disabled, six navigation views, small window. No social actions sent.');
} finally {
  try {
    console.log('Closing desktop');
    if (application) await Promise.race([application.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('Desktop did not exit within 20 seconds')), 20000).unref())]);
  } finally {
    if (application?.process().exitCode === null) application.process().kill();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    clearTimeout(watchdog);
  }
}
