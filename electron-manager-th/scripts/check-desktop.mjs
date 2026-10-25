import { _electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = await mkdtemp(join(tmpdir(), 'autopost-desktop-check-'));
const output = process.env.AUTOPOST_SCREENSHOTS || join(directory, 'screenshots');
await mkdir(output, { recursive: true });
let application;
let child;
const watchdog = setTimeout(() => { console.error('Desktop check exceeded 120 seconds'); process.exit(1); }, 120000);
watchdog.unref();
try {
  console.log('Launching packaged Electron:', process.env.AUTOPOST_EXE);
  application = await _electron.launch({ executablePath: process.env.AUTOPOST_EXE,
    env: { ...process.env, AUTOPOST_SESSION_TEST: '1', APPDATA: directory }, timeout: 60000 });
  child = application.process();
  child.stdout?.on('data', data => process.stdout.write(data));
  child.stderr?.on('data', data => process.stderr.write(data));
  console.log('Electron inspector connected; waiting for first window');
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'ภาพรวม', exact: true }).waitFor();
  console.log('Renderer ready');
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), '0.7.0');
  assert.deepEqual(await page.evaluate(() => window.autopost.listAccounts()), []);
  assert.equal((await page.evaluate(() => window.autopost.workerStatus())).running, false);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  for (const name of ['ภาพรวมและสถานะ', '1. บัญชีและปลายทาง', '2. สร้างงานและตั้งเวลา', 'โปรไฟล์ข้อความ', 'แชร์ / คอมเมนต์ / ถูกใจ', '3. คิวและผลการทำงาน', 'Log การทำงาน', 'ตั้งค่า']) {
    console.log('Checking view:', name);
    await page.locator('nav').getByRole('button', { name, exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  await page.locator('nav').getByRole('button', {name:'โปรไฟล์ข้อความ',exact:true}).click();
  const sets=page.locator('.profile-set');
  for (const [index,id] of ['123','456'].entries()) {
    await sets.nth(index).locator('textarea').nth(0).fill(`https://www.facebook.com/groups/${id}/`);
    await sets.nth(index).locator('textarea').nth(1).fill(`ข้อความชุด ${index+1}`);
  }
  await page.keyboard.press('Control+s');
  await page.getByRole('status').filter({hasText:'บันทึกแล้ว ทุกบัญชี'}).waitFor();
  assert.equal((await page.evaluate(()=>window.autopost.listMessageProfiles()))[0].sets.length,2);
  await page.locator('.content').evaluate(node=>node.scrollTop=0);
  await page.screenshot({ path: join(output, 'desktop-profiles.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Packaged Windows desktop passed: isolated data, session-test mode, queue disabled, eight navigation views and native profile save IPC, small window. No social actions sent.');
} finally {
  try {
    console.log('Closing desktop');
    if (application) await Promise.race([application.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('Desktop did not exit within 20 seconds')), 20000).unref())]);
  } finally {
    if (child?.exitCode === null) child.kill();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    clearTimeout(watchdog);
  }
}
