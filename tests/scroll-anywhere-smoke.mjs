import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// One Scroll Anywhere integration check: latch, outside-window wheel bridge, no persistence.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime', `scroll-anywhere-${Date.now()}`);
await mkdir(path.join(evidence, 'pages'), { recursive: true });
for (let n = 1; n <= 4; n++)
  await sharp({ create: { width: 512, height: 1536, channels: 3, background: '#31455e' } })
    .png()
    .toFile(path.join(evidence, 'pages', `${n}.png`));
await promisify(execFile)('python', [
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/"chapter.cbz","w",zipfile.ZIP_DEFLATED); [z.write(f,f.name) for f in sorted((p/"pages").glob("*.png"))]; z.close()',
  evidence,
]);
const helperProcesses = async () => {
  try {
    const { stdout } = await promisify(execFile)('powershell', [
      '-NoProfile',
      '-Command',
      "(Get-Process -Name 'ReaderGlobalWheelHost' -ErrorAction SilentlyContinue | Measure-Object).Count",
    ]);
    return Number(stdout.trim());
  } catch {
    return 0;
  }
};
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let app;
try {
  app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root, '--qa'],
    cwd: root,
    env,
    timeout: 15000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('[data-reader]');
  await app.evaluate(
    async ({ BrowserWindow, dialog, screen }, archive) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.webContents.isLoading())
        await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      if (!win.isVisible()) await new Promise((resolve) => win.once('show', resolve));
      win.setSize(900, 700);
      win.focus();
      // Reveal the hover top overlay so its controls are clickable in the headless run.
      screen.getCursorScreenPoint = () => {
        const b = win.getContentBounds();
        return { x: b.x + b.width * 0.5, y: b.y + 12 };
      };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] });
    },
    path.join(evidence, 'chapter.cbz'),
  );
  await page.waitForFunction(() => innerWidth === 900 && innerHeight === 700);
  // Capture must stay off until the operator latches it.
  assert.equal(await helperProcesses(), 0, 'no wheel helper may run before the latch is on');
  await page.getByRole('button', { name: /Open.*CBZ/ }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-reader-status]').dataset.prepared === '4',
    null,
    { timeout: 15000 },
  );
  const anywhere = page.locator('[data-instance="readerScrollAnywhere"] button');
  await anywhere.waitFor({ state: 'attached' });
  assert.equal(await anywhere.getAttribute('aria-pressed'), 'false');
  assert.equal(
    /scroll anywhere/i.test((await anywhere.getAttribute('aria-label')) ?? ''),
    true,
    'the toggle must name the feature',
  );
  // Placement: immediately left of Scroll Speed, same row, same height.
  const placement = await page.evaluate(() => {
    const node = (id) => document.querySelector(`[data-instance="${id}"]`);
    const a = node('readerScrollAnywhere').getBoundingClientRect(),
      s = node('readerScrollSpeed').getBoundingClientRect(),
      order = [...node('readerScrollAnywhere').parentElement.children].map(
        (child) => child.dataset.instance,
      );
    return {
      before: order.indexOf('readerScrollAnywhere') + 1 === order.indexOf('readerScrollSpeed'),
      sameTop: Math.abs(a.top - s.top) < 0.5,
      sameHeight: Math.abs(a.height - s.height) < 0.5,
      gap: s.left - a.right,
    };
  });
  assert.equal(placement.before, true, 'toggle must sit immediately left of Scroll Speed');
  assert.equal(placement.sameTop, true);
  assert.equal(placement.sameHeight, true);
  assert.ok(placement.gap >= 0 && placement.gap < 4, `gap=${placement.gap}`);
  // OUTSIDE-WINDOW WHEEL BRIDGE — native helper delivery reaches the reader camera.
  const top = () => page.evaluate(() => document.querySelector('[data-reader-viewport]').scrollTop);
  const before = await top();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('reader:scroll-anywhere-wheel', {
      delta: 120,
      lines: 3,
      timestamp: Date.now(),
    }),
  );
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.readerMoving === 'true',
    null,
    { timeout: 3000 },
  );
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.readerMoving === 'false',
    null,
    { timeout: 4000 },
  );
  const after = await top();
  assert.ok(after - before > 20, `one notch must advance the reader: ${after - before}`);
  // Modified and horizontal input keep their meaning; only vertical unmodified wheel scrolls.
  await page.evaluate(() => {
    document.querySelector('[data-reader-viewport]').scrollTop = 0;
  });
  await app.evaluate(({ BrowserWindow }) => {
    const send = BrowserWindow.getAllWindows()[0].webContents.send.bind(
      BrowserWindow.getAllWindows()[0].webContents,
    );
    send('reader:scroll-anywhere-wheel', { delta: 0, lines: 3, timestamp: Date.now() });
    send('reader:scroll-anywhere-wheel', { delta: 120, lines: 101, timestamp: Date.now() });
  });
  await page.waitForTimeout(300);
  assert.ok((await top()) < 1, 'malformed external wheel input must be rejected');
  const pressed = () =>
    page.evaluate(
      () =>
        document.querySelector('[data-instance="readerScrollAnywhere"] button')?.dataset.pressed ??
        null,
    );
  // LATCH — click once, stay pressed, pause while minimized, release on second click.
  await anywhere.click();
  await page.waitForFunction(
    () => document.querySelector('[data-instance="readerScrollAnywhere"] button').dataset.pressed,
    null,
    { timeout: 5000 },
  );
  assert.equal(await pressed(), 'true');
  await page.waitForFunction(
    () =>
      /active/i.test(
        document
          .querySelector('[data-instance="readerScrollAnywhere"] button')
          .getAttribute('aria-label') ?? '',
      ),
    null,
    { timeout: 5000 },
  );
  assert.equal(await helperProcesses(), 1, 'latching on must start exactly one wheel helper');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForFunction(
    () =>
      /paused/i.test(
        document
          .querySelector('[data-instance="readerScrollAnywhere"] button')
          .getAttribute('aria-label') ?? '',
      ),
    null,
    { timeout: 5000 },
  );
  assert.equal(await pressed(), 'true', 'pause must not unlatch');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  await page.waitForFunction(
    () =>
      !/paused/i.test(
        document
          .querySelector('[data-instance="readerScrollAnywhere"] button')
          .getAttribute('aria-label') ?? '',
      ),
    null,
    { timeout: 5000 },
  );
  assert.equal(await pressed(), 'true', 'restore must keep the latch');
  const focus = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return win.isFocused();
  });
  assert.equal(focus, true, 'the reader window must keep focus');
  assert.equal(
    await page.evaluate(() => document.hasFocus()),
    true,
    'the reader document must keep focus',
  );
  await page.locator('[data-instance="readerScrollAnywhere"] button').waitFor({ state: 'visible' });
  await anywhere.click();
  await page.waitForFunction(
    () => !document.querySelector('[data-instance="readerScrollAnywhere"] button').dataset.pressed,
    null,
    { timeout: 5000 },
  );
  assert.equal(await pressed(), null, 'releasing the latch must clear the pressed state');
  await page.waitForTimeout(500);
  assert.equal(await helperProcesses(), 0, 'releasing the latch must stop the wheel helper');
  // SESSION-ONLY — the latch never becomes a stored preference.
  const bootstrap = await page.evaluate(() => window.shellHost.bootstrap());
  assert.equal('ok' in bootstrap, false);
  assert.deepEqual(
    Object.keys(bootstrap.readerPreferences.values).filter((id) => /anywhere/i.test(id)),
    [],
  );
  const preferenceFile = path.join(
    await app.evaluate(({ app }) => app.getPath('userData')),
    'reader-preferences.json',
  );
  const stored = await readFile(preferenceFile, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => ({ version: 1, values: {} }));
  assert.deepEqual(
    Object.keys(stored.values ?? {}).filter((id) => /anywhere/i.test(id)),
    [],
    'preferences file must not store the latch',
  );
  assert.deepEqual(errors, []);
  const result = {
    verdict: 'PASS',
    checks: [
      'no helper process before the latch; latch is session-only and never stored',
      'toggle sits immediately left of Scroll Speed with matching row geometry',
      'native outside-window wheel delivery advances the reader and rejects malformed input',
      'latch stays pressed, pauses while minimized, keeps window focus and stops the helper on release',
    ],
    evidence,
    wheelTravel: after - before,
    placement,
    preferences: stored.values ?? {},
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({ verdict: 'FAIL', error: error.stack, errors, evidence }, null, 2),
  );
  throw error;
} finally {
  if (app) await app.close();
}
