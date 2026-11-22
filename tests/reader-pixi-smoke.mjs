import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// One reader integration check, not a FPS benchmark or a separate demo application.
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = path.join(root, '.runtime', `reader-pixi-${Date.now()}`);
const appRoot = path.join(evidence, 'app');
await mkdir(path.join(evidence, 'pages'), { recursive: true });
for (let index = 0; index < 3; index++) {
  await sharp({
    create: {
      width: 1200,
      height: 1800,
      channels: 3,
      background: ['#db4939', '#428556', '#436cc2'][index],
    },
  })
    .png()
    .toFile(path.join(evidence, 'pages', `${index + 1}.png`));
}
await promisify(execFile)('python', [
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); [(lambda z: ([z.write(f,f.name) for f in sorted((p/"pages").glob("*.png"))],z.close()))(zipfile.ZipFile(p/("chapter%d.cbz"%i),"w",zipfile.ZIP_DEFLATED)) for i in (1,2)]',
  evidence,
]);
await mkdir(path.join(appRoot, 'screen'), { recursive: true });
await mkdir(path.join(appRoot, 'electron'), { recursive: true });
for (const directory of ['screen-built', 'electron-built', 'electron/assets'])
  await cp(path.join(root, directory), path.join(appRoot, directory), { recursive: true });
await cp(path.join(root, 'electron/config.json'), path.join(appRoot, 'electron/config.json'));
const config = JSON.parse(await readFile(path.join(root, 'screen/config.json'), 'utf8'));
config.areas
  .find((area) => area.id === 'body')
  .children.find((child) => child.id === 'reader').renderer = 'pixi';
await writeFile(path.join(appRoot, 'screen/config.json'), JSON.stringify(config));
await writeFile(
  path.join(appRoot, 'package.json'),
  JSON.stringify({ name: 'yuzread-pixi-m1-qa', main: 'electron-built/main.cjs' }),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [appRoot, '--qa'],
    cwd: appRoot,
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
    async ({ BrowserWindow, dialog, screen }, file) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window.webContents.isLoading())
        await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
      if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
      window.setSize(900, 700);
      window.focus();
      screen.getCursorScreenPoint = () => {
        const b = window.getContentBounds();
        return { x: b.x + b.width * 0.875, y: b.y + 15 };
      };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    },
    path.join(evidence, 'chapter1.cbz'),
  );
  await page.waitForFunction(() => innerWidth === 900 && innerHeight === 700, null, {
    timeout: 5000,
  });
  await page.getByRole('button', { name: /Open.*CBZ/ }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-reader-pixi]')?.dataset.readerPixi === 'ready',
    null,
    { timeout: 15000 },
  );
  const canvas = page.locator('[data-reader-pixi]');
  const initial = await page.evaluate(() => {
    const canvas = document.querySelector('[data-reader-pixi]'),
      image = document.querySelector('[data-reader-page="0"] img');
    const box = image.getBoundingClientRect();
    return {
      backend: canvas.dataset.pixiBackend,
      version: canvas.dataset.pixiWebgl,
      bitmapHidden: image.style.visibility === 'hidden',
      width: box.width,
      height: box.height,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      revision: Number(canvas.dataset.pixiRevision),
    };
  });
  assert.equal(initial.backend, 'webgl');
  assert.equal(initial.bitmapHidden, true);
  const ratio = await page.evaluate(() => devicePixelRatio);
  assert.equal(initial.canvasWidth, Math.round(900 * ratio));
  assert.equal(initial.canvasHeight, Math.round(700 * ratio));
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll('[data-reader-page] img')].every(
        (image) => !image.getAttribute('src'),
      ),
    ),
    true,
  );
  const screenshot = await canvas.screenshot({ path: path.join(evidence, 'gpu-first-page.png') });
  const center = await sharp(screenshot)
    .extract({ left: 450, top: 300, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.ok(
    Math.abs(center[0] - 219) <= 2 &&
      Math.abs(center[1] - 73) <= 2 &&
      Math.abs(center[2] - 57) <= 2,
    `GPU page pixel is ${[...center]}, not the prepared page color`,
  );
  const top = () => page.evaluate(() => document.querySelector('[data-reader-viewport]').scrollTop);
  await page.mouse.move(450, 300);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').scrollTop > 0,
    null,
    { timeout: 3000 },
  );
  const firstMotion = await top();
  await page.waitForTimeout(100);
  assert.ok((await top()) > firstMotion, 'motion must continue after the wheel event');
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.readerMoving === 'false',
    null,
    { timeout: 3000 },
  );
  const settled = await top();
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await top()) - settled) < 1, 'momentum must stop when idle');
  await page.waitForFunction(
    () => Number(document.querySelector('[data-reader-pixi]').dataset.pixiPages) >= 6,
    null,
    { timeout: 10000 },
  );
  async function goToPage(index) {
    const revision = await page.evaluate((index) => {
      const view = document.querySelector('[data-reader-viewport]'),
        slots = [...document.querySelectorAll('[data-reader-page]')];
      const old = Number(document.querySelector('[data-reader-pixi]').dataset.pixiRevision);
      view.scrollTop +=
        slots[index].getBoundingClientRect().top - view.getBoundingClientRect().top + 40;
      return old;
    }, index);
    await page.waitForFunction(
      (revision) =>
        Number(document.querySelector('[data-reader-pixi]').dataset.pixiRevision) > revision,
      revision,
      { timeout: 3000 },
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  await goToPage(1);
  const green = await sharp(await canvas.screenshot())
    .extract({ left: 450, top: 300, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.ok(
    Math.abs(green[0] - 66) <= 2 && Math.abs(green[1] - 133) <= 2 && Math.abs(green[2] - 86) <= 2,
    'page 2 must also be GPU-rendered',
  );
  await page.evaluate(() => {
    const view = document.querySelector('[data-reader-viewport]');
    const first = document.querySelector('[data-reader-chapter]');
    view.scrollTop += first.getBoundingClientRect().bottom - view.getBoundingClientRect().top - 40;
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(
    () => document.querySelector('[data-reader-status]').textContent.includes('chapter2.cbz'),
    null,
    { timeout: 3000 },
  );
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('[data-reader-pixi]').length),
    1,
    'chapter handoff must retain one worker canvas',
  );
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.readerMoving === 'false',
    null,
    { timeout: 3000 },
  );
  const oldRevision = initial.revision;
  await page.evaluate(() => {
    document.querySelector('[data-reader-viewport]').scrollTop = 100;
  });
  await page.waitForFunction(
    (revision) =>
      Number(document.querySelector('[data-reader-pixi]').dataset.pixiRevision) > revision,
    oldRevision,
    { timeout: 3000 },
  );
  await page.waitForFunction(
    () => document.querySelector('[data-reader-status]').textContent.includes('chapter1.cbz'),
    null,
    { timeout: 10000 },
  );
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.readerMoving === 'true',
    null,
    { timeout: 3000 },
  );
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await page.waitForFunction(
    () => Number(document.querySelector('[data-reader-pages]').dataset.zoom) === 1.1,
    null,
    { timeout: 3000 },
  );
  await page.keyboard.press('Control+0');
  await page.waitForFunction(
    () => Number(document.querySelector('[data-reader-pages]').dataset.zoom) === 1,
    null,
    { timeout: 3000 },
  );
  const resetTop = await top();
  await page.waitForTimeout(120);
  assert.ok(Math.abs((await top()) - resetTop) < 1, 'zoom/reset must stop old momentum');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 650));
  await page.waitForFunction(() => innerWidth === 800 && innerHeight === 650, null, {
    timeout: 3000,
  });
  await page.waitForFunction(
    () => document.querySelector('[data-reader-pixi]').width === Math.round(800 * devicePixelRatio),
    null,
    { timeout: 3000 },
  );
  const after = await page.evaluate(() => {
    const box = document.querySelector('[data-reader-page="0"] img').getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  assert.equal(after.width, initial.width);
  assert.equal(after.height, initial.height);
  assert.deepEqual(errors, []);
  const gpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus().gpu_compositing);
  assert.match(gpu, /^enabled/);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForFunction(() => !document.querySelector('[data-reader-pixi]'), null, {
    timeout: 4000,
  });
  const result = {
    verdict: 'PASS',
    checks: [
      'real CBZ token -> worker ImageBitmap -> WebGL page pixels',
      'all six loaded pages use GPU resources, second-page pixels, momentum across chapter handoff and backward reload',
      'worker momentum coasts/stops, Ctrl+wheel/reset interruption, fixed resize geometry, GPU compositing and cleanup',
    ],
    initial,
    gpu,
    coverage: {
      stage: 'full-page Pixi rendering and momentum',
      presentedFPS: 'not measured',
      fullPixiReader: true,
    },
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow().catch(() => null);
    if (page)
      await writeFile(
        path.join(evidence, 'browser-state.json'),
        JSON.stringify(
          await page
            .evaluate(() => ({
              error: document.querySelector('[data-reader-viewport]')?.dataset.pixiPreviewError,
              canvas: document.querySelector('[data-reader-pixi]')?.outerHTML,
              status: document.querySelector('[data-reader-status]')?.textContent,
            }))
            .catch(() => null),
          null,
          2,
        ),
      );
  }
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({ verdict: 'FAIL', error: error.stack, errors, evidence }, null, 2),
  );
  throw error;
} finally {
  if (app) await app.close();
}
