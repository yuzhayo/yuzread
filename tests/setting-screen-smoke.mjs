import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// Focused persistent settings popup check in the real app, not a full reader suite.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime', `setting-screen-${Date.now()}`);
await mkdir(evidence, { recursive: true });
await sharp({ create: { width: 512, height: 1600, channels: 3, background: '#31455e' } })
  .png()
  .toFile(path.join(evidence, 'page.png'));
await promisify(execFile)('python', [
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/"chapter.cbz","w",zipfile.ZIP_DEFLATED); [z.write(p/"page.png","%d.png"%n) for n in (1,2)]; z.close()',
  evidence,
]);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let app;
try {
  app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root, '--qa', '--force-device-scale-factor=1'],
    cwd: root,
    env,
    timeout: 15000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.waitForSelector('[data-reader]');
  await app.evaluate(
    async ({ BrowserWindow, dialog, screen }, archive) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.webContents.isLoading())
        await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      if (!win.isVisible()) await new Promise((resolve) => win.once('show', resolve));
      win.setContentSize(900, 700);
      win.focus();
      globalThis.settingHeader = true;
      screen.getCursorScreenPoint = () => {
        const b = win.getContentBounds();
        return { x: b.x + 30, y: b.y + (globalThis.settingHeader ? 15 : 500) };
      };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] });
    },
    path.join(evidence, 'chapter.cbz'),
  );
  await page.waitForFunction(() => innerWidth === 900 && innerHeight === 700);
  const gear = page.getByRole('button', { name: 'Setting Screen', exact: true });
  const popup = page.getByRole('dialog', { name: 'Setting Screen', exact: true });
  const panel = page.locator('[data-setting-screen]');
  await gear.waitFor({ state: 'visible' });
  assert.equal(
    await popup.count(),
    0,
    'closed persistent screen must be absent from the accessibility tree',
  );
  assert.equal(await panel.count(), 1, 'screen must already be mounted, not created only on Open');
  assert.equal(await panel.getAttribute('inert'), '');
  const barGeometry = await page.evaluate(() =>
    ['settingScreen', 'readerScrollSpeed', 'readerOpen', 'windowControls'].map((id) => {
      const b = document.querySelector(`[data-instance="${id}"]`).getBoundingClientRect();
      return { id, x: b.x, width: b.width };
    }),
  );
  assert.ok(
    barGeometry[0].x < 20 && barGeometry[0].width > 30,
    'gear belongs in the far-left slot',
  );
  assert.ok(Math.abs(barGeometry[1].x - 900 * 0.8025) < 1);
  assert.ok(Math.abs(barGeometry[2].x - 900 * 0.85) < 1);
  assert.ok(Math.abs(barGeometry[3].x - 900 * 0.8975) < 1);
  await page.getByRole('button', { name: /Open.*CBZ/ }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-reader-pixi]').dataset.readerPixi === 'ready',
    null,
    { timeout: 15000 },
  );
  const readerBefore = await page.evaluate(() => {
    const v = document.querySelector('[data-reader-viewport]');
    window.settingCanvas = document.querySelector('[data-reader-pixi]');
    return { width: v.clientWidth, height: v.clientHeight, extent: v.scrollHeight };
  });
  await gear.click();
  await popup.waitFor({ state: 'visible' });
  assert.equal(await gear.getAttribute('aria-expanded'), 'true');
  assert.equal(await popup.getAttribute('aria-modal'), 'false');
  const body = popup.locator('[data-setting-screen-body]');
  assert.equal(await body.textContent(), '');
  assert.equal(
    await body.evaluate((node) => node.childElementCount),
    0,
    'body is intentionally empty',
  );
  assert.ok((await body.boundingBox()).height > 0, 'empty body still has its own reserved area');
  assert.equal(await popup.locator('[data-setting-screen-header]').textContent(), '');
  const title = await popup.locator('[data-part="title"]').boundingBox();
  const close = popup.getByRole('button', { name: 'Close Setting Screen', exact: true });
  const closeBox = await close.boundingBox();
  assert.ok(closeBox.x > title.x + title.width, 'close control belongs to the right of the title');
  await page.evaluate(() => {
    window.settingPanel = document.querySelector('[data-setting-screen]');
    window.settingBody = document.querySelector('[data-setting-screen-body]');
    window.settingBody.dataset.retained = 'same-body';
  });
  await app.evaluate(() => {
    globalThis.settingHeader = false;
  });
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-instance="settingScreen"]')).visibility ===
      'hidden',
  );
  assert.equal(await popup.isVisible(), true, 'popup must survive header hover exit');
  await page.mouse.click(850, 500);
  await page.keyboard.press('Escape');
  assert.equal(
    await popup.isVisible(),
    true,
    'outside click and Escape must not dismiss the persistent screen',
  );
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').scrollTop > 0,
    null,
    { timeout: 3000 },
  );
  assert.equal(
    await popup.isVisible(),
    true,
    'reading outside the modeless screen must not close it',
  );
  const windowBefore = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  const initialPanel = await popup.boundingBox();
  const handle = await popup.locator('[data-setting-screen-header]').boundingBox();
  await page.mouse.move(handle.x + 25, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 105, handle.y + handle.height / 2 + 50, { steps: 4 });
  await page.mouse.up();
  const moved = await popup.boundingBox();
  assert.ok(
    Math.abs(moved.x - initialPanel.x - 80) < 1 && Math.abs(moved.y - initialPanel.y - 50) < 1,
    'header drag must move only the popup',
  );
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()),
    windowBefore,
  );
  await popup.screenshot({ path: path.join(evidence, 'setting-screen.png') });
  await close.click();
  await popup.waitFor({ state: 'hidden' });
  assert.equal(await panel.count(), 1);
  assert.equal(await panel.getAttribute('inert'), '');
  await app.evaluate(() => {
    globalThis.settingHeader = true;
  });
  await gear.waitFor({ state: 'visible' });
  await gear.click();
  await popup.waitFor({ state: 'visible' });
  const reopened = await popup.boundingBox();
  assert.ok(
    Math.abs(reopened.x - moved.x) < 1 && Math.abs(reopened.y - moved.y) < 1,
    'reopening retains the dragged position',
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.settingPanel === document.querySelector('[data-setting-screen]') &&
        window.settingBody === document.querySelector('[data-setting-screen-body]') &&
        window.settingBody.dataset.retained === 'same-body',
    ),
    true,
    'close/open must retain the same screen and body nodes',
  );
  await gear.click();
  assert.equal(
    await popup.isVisible(),
    true,
    'gear opens/focuses rather than toggles an open screen closed',
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
    'settings is not another native window',
  );
  const readerAfter = await page.evaluate(() => {
    const v = document.querySelector('[data-reader-viewport]');
    return { width: v.clientWidth, height: v.clientHeight, extent: v.scrollHeight };
  });
  assert.deepEqual(readerAfter, readerBefore);
  assert.equal(
    await page.evaluate(
      () => window.settingCanvas === document.querySelector('[data-reader-pixi]'),
    ),
    true,
    'settings must not recreate the GPU reader',
  );
  await close.click();
  await popup.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  const result = {
    verdict: 'PASS',
    checks: [
      'far-left gear without moving existing controls',
      'modeless persistent screen with blank/draggable header, right-side local close and empty body',
      'hover/outside/Escape survival; hidden inert screen/body identity and dragged position retained on reopen',
      'same native window and reader geometry/renderer',
    ],
    barGeometry,
    position: reopened,
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  }
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({ verdict: 'FAIL', error: error.stack, errors, evidence }, null, 2),
  );
  throw error;
} finally {
  if (app) await app.close();
}
