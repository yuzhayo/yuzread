import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// Focused UI/catalog navigation, not the full reader suite or FPS benchmarking.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime', `chapter-navigation-${Date.now()}`);
await mkdir(path.join(evidence, 'pages'), { recursive: true });
for (const chapter of [1, 2, 10])
  for (let n = 1; n <= 2; n++)
    await sharp({
      create: {
        width: 512,
        height: 1536,
        channels: 3,
        background: chapter === 1 ? '#b84e3b' : chapter === 2 ? '#438c62' : '#4363bd',
      },
    })
      .png()
      .toFile(path.join(evidence, 'pages', `${chapter}-${n}.png`));
await promisify(execFile)('python', [
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); [(lambda i,z: ([z.write(p/"pages"/("%d-%d.png"%(i,n)),"%d.png"%n) for n in (1,2)],z.close()))(i,zipfile.ZipFile(p/("chapter%d.cbz"%i),"w",zipfile.ZIP_DEFLATED)) for i in (1,2,10)]',
  evidence,
]);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
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
      globalThis.navZone = 'bottom';
      globalThis.navDialogs = 0;
      screen.getCursorScreenPoint = () => {
        const b = win.getContentBounds();
        return {
          x: b.x + b.width * 0.5,
          y:
            b.y +
            (globalThis.navZone === 'top'
              ? 15
              : globalThis.navZone === 'bottom'
                ? b.height - 10
                : b.height * 0.5),
        };
      };
      dialog.showOpenDialog = async () => {
        globalThis.navDialogs++;
        return { canceled: false, filePaths: [archive] };
      };
    },
    path.join(evidence, 'chapter2.cbz'),
  );
  await page.waitForFunction(() => innerWidth === 900 && innerHeight === 700);
  const zone = (value) =>
    app.evaluate((_electron, value) => {
      globalThis.navZone = value;
    }, value);
  const previous = page.getByRole('button', { name: 'Previous chapter', exact: true }),
    next = page.getByRole('button', { name: 'Next chapter', exact: true }),
    list = page.getByRole('button', { name: 'Chapter list', exact: true });
  await previous.waitFor({ state: 'visible' });
  assert.equal(await previous.isDisabled(), true);
  assert.equal(await next.isDisabled(), true);
  const initialHeight = await page.evaluate(
    () => document.querySelector('[data-reader-viewport]').clientHeight,
  );
  await zone('top');
  await page.getByRole('button', { name: /Open.*CBZ/ }).click();
  const chapter = (name) =>
    page.waitForFunction(
      (name) =>
        document.querySelector('[data-reader-status]').textContent.includes(name) &&
        document.querySelector('[data-reader-status]').dataset.prepared === '2',
      name,
      { timeout: 15000 },
    );
  await chapter('chapter2.cbz');
  await page.getByRole('button', { name: 'Scroll speed', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Speed value' }).fill('37');
  await page.keyboard.press('Enter');
  await page.mouse.click(30, 300);
  await zone('body');
  await page.mouse.move(450, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await page.waitForFunction(
    () => Number(document.querySelector('[data-reader-pages]').dataset.zoom) === 1.1,
  );
  await zone('bottom');
  await previous.waitFor({ state: 'visible' });
  assert.equal(await previous.isEnabled(), true);
  assert.equal(await next.isEnabled(), true);
  await list.click();
  const popup = page.getByRole('dialog', { name: 'Chapters' });
  await popup.waitFor({ state: 'visible' });
  assert.deepEqual(await popup.getByRole('button').allTextContents(), [
    'chapter1.cbz',
    'chapter2.cbz',
    'chapter10.cbz',
  ]);
  assert.equal(
    await popup
      .getByRole('button', { name: 'chapter2.cbz', exact: true })
      .getAttribute('aria-current'),
    'page',
  );
  await zone('body');
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#bottomBar').firstElementChild).visibility ===
      'hidden',
  );
  assert.equal(await popup.isVisible(), true);
  const before = await popup.boundingBox(),
    handle = await page.locator('[data-chapter-drag-handle]').boundingBox();
  await page.mouse.move(handle.x + 30, handle.y + 12);
  await page.mouse.down();
  await page.mouse.move(handle.x + 70, handle.y + 32, { steps: 3 });
  await page.mouse.up();
  const after = await popup.boundingBox();
  assert.ok(Math.abs(after.x - before.x - 40) < 2 && Math.abs(after.y - before.y - 20) < 2);
  await popup.screenshot({ path: path.join(evidence, 'chapters.png') });
  await popup.getByRole('button', { name: 'chapter1.cbz', exact: true }).click();
  await chapter('chapter1.cbz');
  await popup.waitFor({ state: 'hidden' });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const pixels = await sharp(await page.locator('[data-reader-pixi]').screenshot())
    .extract({ left: 450, top: 300, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.ok(
    Math.abs(pixels[0] - 184) <= 2 &&
      Math.abs(pixels[1] - 78) <= 2 &&
      Math.abs(pixels[2] - 59) <= 2,
    'selected chapter pixels must replace the previous scene',
  );
  await zone('bottom');
  assert.equal(await previous.isDisabled(), true);
  assert.equal(await next.isEnabled(), true);
  await next.click();
  await chapter('chapter2.cbz');
  await list.click();
  await popup.getByRole('button', { name: 'chapter10.cbz', exact: true }).click();
  await chapter('chapter10.cbz');
  assert.equal(await next.isDisabled(), true);
  assert.equal(await previous.isEnabled(), true);
  await previous.click();
  await chapter('chapter2.cbz');
  await list.click();
  await page.mouse.click(30, 300);
  await popup.waitFor({ state: 'hidden' });
  await zone('bottom');
  await list.click();
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  const final = await page.evaluate(() => ({
    zoom: Number(document.querySelector('[data-reader-pages]').dataset.zoom),
    speed: Number(document.querySelector('[data-reader-viewport]').dataset.scrollSpeed),
    height: document.querySelector('[data-reader-viewport]').clientHeight,
    canvases: document.querySelectorAll('[data-reader-pixi]').length,
  }));
  assert.equal(final.zoom, 1.1);
  assert.equal(final.speed, 3.7);
  assert.equal(final.canvases, 1);
  // Zoom may expose the existing horizontal scrollbar, but the overlay itself never reserves height.
  await page.keyboard.press('Control+0');
  await page.waitForFunction(
    () => Number(document.querySelector('[data-reader-pages]').dataset.zoom) === 1,
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('[data-reader-viewport]').clientHeight),
    initialHeight,
  );
  assert.equal(
    await app.evaluate(() => globalThis.navDialogs),
    1,
    'navigation must not reopen the file picker',
  );
  assert.deepEqual(errors, []);
  const result = {
    verdict: 'PASS',
    checks: [
      'bottom hover overlay with no reader gutter; empty/boundary states',
      'natural chapter list/current highlight; draggable popup survives hover exit; outside/Escape close',
      'unloaded/resident Previous, Next and list selection without picker; zoom/speed preserved; one GPU canvas',
    ],
    final,
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await writeFile(
      path.join(evidence, 'state.json'),
      JSON.stringify(
        await page.evaluate(() => ({
          status: document.querySelector('[data-reader-status]')?.textContent,
          overlay: document.querySelector('[data-reader-overlay]')?.textContent,
          pixiError: document.querySelector('[data-reader-viewport]')?.dataset.pixiError,
          chapters: [...document.querySelectorAll('[data-reader-chapter]')].map((e) => ({
            name: e.getAttribute('aria-label'),
            index: e.dataset.readerIndex,
          })),
          dialog: document.querySelector('[data-chapter-popup]')?.textContent,
          records: window.shellDev?.records?.(),
        })),
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
