import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// One speed-control interaction check; no FPS benchmark or real user archives.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime', `scroll-speed-${Date.now()}`);
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
      globalThis.speedHeader = true;
      screen.getCursorScreenPoint = () => {
        const b = win.getContentBounds();
        return { x: b.x + b.width * 0.83, y: b.y + (globalThis.speedHeader ? 15 : b.height * 0.5) };
      };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] });
    },
    path.join(evidence, 'chapter.cbz'),
  );
  await page.waitForFunction(() => innerWidth === 900 && innerHeight === 700);
  await page.getByRole('button', { name: /Open.*CBZ/ }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-reader-status]').dataset.prepared === '4',
    null,
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    window.speedCanvas = document.querySelector('[data-reader-pixi]');
  });
  const setHeader = (flag) =>
    app.evaluate((_electron, flag) => {
      globalThis.speedHeader = flag;
    }, flag);
  const speed = (value) =>
    page.waitForFunction(
      (value) =>
        Number(document.querySelector('[data-reader-viewport]').dataset.workerSpeed) === value,
      value,
      { timeout: 3000 },
    );
  await setHeader(false);
  await page.mouse.move(450, 300);
  const worker = page.workers()[0];
  assert.ok(worker);
  await worker.evaluate(() => {
    globalThis.wheelCurve = [];
    globalThis.curveStart = performance.now();
    globalThis.captureCurve = true;
    const post = globalThis.postMessage.bind(globalThis);
    globalThis.postMessage = (value, ...args) => {
      if (globalThis.captureCurve && value.kind === 'position') {
        globalThis.wheelCurve.push({
          ...value,
          elapsed: performance.now() - globalThis.curveStart,
        });
        if (globalThis.wheelCurve.length > 512) globalThis.wheelCurve.shift();
      }
      return post(value, ...args);
    };
  });
  await page.evaluate(async () => {
    const v = document.querySelector('[data-reader-viewport]');
    for (let n = 0; n < 20; n++) {
      v.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 120, deltaMode: 0, bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
  const curve = await worker.evaluate(() => {
    globalThis.captureCurve = false;
    return globalThis.wheelCurve;
  });
  const stable = curve.filter((value) => value.elapsed >= 1100 && value.elapsed < 1800);
  assert.ok(stable.length >= 10);
  assert.ok(
    stable.every((value) => value.gestureActive && value.moving && value.velocity > 0),
    'nearby ticks must remain one active gesture',
  );
  const speeds = stable.map((value) => value.velocity),
    mean = speeds.reduce((sum, n) => sum + n, 0) / speeds.length;
  const ripple = (Math.max(...speeds) - Math.min(...speeds)) / mean;
  assert.ok(ripple < 0.15, `live worker velocity must not retain per-notch sawtooth: ${ripple}`);
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.readerWheelGesture === 'false',
    null,
    { timeout: 1000 },
  );
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.readerMoving === 'false',
    null,
    { timeout: 3000 },
  );
  const gestureTravel = await page.evaluate(
    () => document.querySelector('[data-reader-viewport]').scrollTop,
  );
  assert.ok(
    gestureTravel > 3500 && gestureTravel < 3700,
    'joined movement must preserve about 180 pixels per ordinary notch',
  );
  // Precision input remains native, without a second gesture/inertia tail.
  await page.mouse.wheel(0, 10);
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator('[data-reader-viewport]').getAttribute('data-reader-wheel-gesture'),
    'false',
  );
  const preciseTop = await page.evaluate(
    () => document.querySelector('[data-reader-viewport]').scrollTop,
  );
  await page.waitForTimeout(100);
  assert.ok(
    Math.abs(
      (await page.evaluate(() => document.querySelector('[data-reader-viewport]').scrollTop)) -
        preciseTop,
    ) < 1,
  );
  await page.evaluate(() => {
    const v = document.querySelector('[data-reader-viewport]');
    v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    v.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.readerMoving === 'true',
    null,
    { timeout: 3000 },
  );
  await setHeader(true);
  await page.getByRole('button', { name: 'Scroll speed', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Scroll speed' }),
    input = page.getByRole('spinbutton', { name: 'Speed value' }),
    slider = page.getByRole('slider', { name: 'Scroll speed' });
  await panel.waitFor({ state: 'visible' });
  await setHeader(false);
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-instance="readerScrollSpeed"]')).visibility ===
      'hidden',
  );
  assert.equal(await panel.isVisible(), true, 'popup must survive leaving the hover header');
  await input.fill('100');
  await speed(10);
  assert.equal(
    await page.evaluate(
      () => document.querySelector('[data-reader-viewport]').dataset.readerMoving,
    ),
    'true',
    'changing speed must preserve active momentum',
  );
  assert.equal(
    await page.evaluate(() => window.speedCanvas === document.querySelector('[data-reader-pixi]')),
    true,
    'speed changes must not rebuild the renderer',
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
    'popup is not another native window',
  );
  await input.fill('999');
  await input.press('Tab');
  assert.equal(await panel.isVisible(), true, 'numeric input blur must not dismiss the popup');
  assert.equal(await input.inputValue(), '100');
  assert.equal(await slider.getAttribute('aria-valuenow'), '100');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await speed(1);
  assert.equal(await input.inputValue(), '10');
  await slider.focus();
  await slider.press('End');
  await speed(10);
  assert.equal(await input.inputValue(), '100');
  await slider.press('Home');
  await speed(1);
  const before = await panel.boundingBox(),
    windowBefore = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
  const handle = await page.locator('[data-speed-drag-handle]').boundingBox();
  await page.mouse.move(handle.x + 30, handle.y + 12);
  await page.mouse.down();
  await page.mouse.move(handle.x + 90, handle.y + 57, { steps: 4 });
  await page.mouse.up();
  const after = await panel.boundingBox();
  assert.ok(
    Math.abs(after.x - before.x - 60) < 2 && Math.abs(after.y - before.y - 45) < 2,
    'drag must move the popup',
  );
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()),
    windowBefore,
    'drag must not move the native window',
  );
  await input.fill('37');
  await speed(3.7);
  await page.mouse.click(30, 300);
  await panel.waitFor({ state: 'hidden' });
  await speed(3.7);
  await setHeader(true);
  await page.getByRole('button', { name: 'Scroll speed', exact: true }).click();
  await panel.waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), '37');
  await setHeader(false);
  await page.mouse.move(450, 300);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.readerMoving === 'true',
    null,
    { timeout: 3000 },
  );
  await slider.focus();
  await slider.press('ArrowRight');
  await speed(3.8);
  assert.equal(
    await page.evaluate(
      () => document.querySelector('[data-reader-viewport]').dataset.readerMoving,
    ),
    'true',
    'slider keys must not cancel reader momentum',
  );
  await panel.screenshot({ path: path.join(evidence, 'panel.png') });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  const result = {
    verdict: 'PASS',
    checks: [
      'live timestamped joined-wheel gesture with low velocity ripple, preserved travel, quiet coast and precision-input separation',
      'hover-independent popup; direct input/clamping; synchronized slider; reset=1x',
      '100=10x and immediate ongoing-momentum update without renderer restart',
      'draggable popup without moving native window; outside close preserves value; keyboard/Escape',
    ],
    evidence,
    gesture: { ripple, meanVelocity: mean, travel: gestureTravel, samples: stable.length },
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
