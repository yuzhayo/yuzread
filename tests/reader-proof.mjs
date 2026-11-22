import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// CONFIG AND FIXTURES — only this reader path; no shell suite or real user archives.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime', `reader-proof-${Date.now()}`);
const pages = path.join(evidence, 'pages');
await mkdir(pages, { recursive: true });
for (let index = 1; index <= 20; index++) {
  const width = 1400, height = 2000 + index % 3 * 200;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgb(${30 + index * 5},${40 + index * 3},${60 + index * 2})"/>${Array.from({ length: 16 }, (_, row) => `<rect x="40" y="${row * 140 + 10}" width="1320" height="100" fill="none" stroke="#eadcb4" stroke-width="4"/><text x="80" y="${row * 140 + 75}" font-size="34" fill="white">PAGE ${index} · YUZREAD</text>`).join('')}</svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 93 }).toFile(path.join(pages, `${index}.jpg`));
}
const execute = promisify(execFile);
await execute('python', ['-c',
  'import sys,zipfile,pathlib; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/"chapter.cbz","w",zipfile.ZIP_DEFLATED); [z.write(f,"pages/"+f.name) for f in sorted((p/"pages").glob("*.jpg"),reverse=True)]; z.writestr("ComicInfo.xml","<ComicInfo/>"); z.close(); z=zipfile.ZipFile(p/"empty.cbz","w"); z.writestr("notes.txt","empty"); z.close(); z=zipfile.ZipFile(p/"damaged.cbz","w",zipfile.ZIP_DEFLATED); [z.writestr("pages/"+f.name,f.read_bytes()[:4096] if f.name=="7.jpg" else f.read_bytes()) for f in (p/"pages").glob("*.jpg")]; z.close(); (p/"invalid.cbz").write_text("invalid archive")', evidence]);

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({ args: [root, '--qa'], cwd: root, env, timeout: 15000 });
const checks = [], errors = [];
let result;
try {
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('[data-reader]');
  await application.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
    window.focus();
  });
  const pointer = async (fractionY) => {
    // The pointer is moved with one native call per attempt; the point is clamped
    // to the display work area so a stale window rect cannot fail the move.
    const point = await application.evaluate(({ BrowserWindow, screen }, y) => {
      const area = BrowserWindow.getAllWindows()[0].getContentBounds();
      const display = screen.getDisplayMatching(area);
      const x = Math.min(Math.max(area.x + Math.round(area.width / 2), display.workArea.x + 1), display.workArea.x + display.workArea.width - 2);
      const raw = area.y + Math.round(area.height * y);
      const top = Math.min(Math.max(raw, display.workArea.y + 1), display.workArea.y + display.workArea.height - 2);
      return { x, y: top };
    }, fractionY);
    const command = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class ProofPointer { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'; if (-not [ProofPointer]::SetCursorPos(${point.x},${point.y})) { exit 1 }`;
    await execute('pwsh', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { timeout: 10000 });
  };
  const movePointer = async (fractionY) => {
    const point = await application.evaluate(({ BrowserWindow, screen }, y) => {
      const area = BrowserWindow.getAllWindows()[0].getContentBounds();
      const display = screen.getDisplayMatching(area);
      const x = Math.min(Math.max(area.x + Math.round(area.width / 2), display.workArea.x + 1), display.workArea.x + display.workArea.width - 2);
      const raw = area.y + Math.round(area.height * y);
      const top = Math.min(Math.max(raw, display.workArea.y + 1), display.workArea.y + display.workArea.height - 2);
      return { x, y: top };
    }, fractionY);
    await execute('pwsh', ['-NoProfile', '-File', path.join(root, 'tests', 'move-pointer.ps1'),
      '-X', String(point.x), '-Y', String(point.y)], { timeout: 10000 });
  };
  const choose = (name, canceled = false) => application.evaluate(({ dialog }, selection) => {
    dialog.showOpenDialog = async () => selection;
  }, { canceled, filePaths: canceled ? [] : [path.join(evidence, name)] });
  const open = async (name, canceled = false) => {
    await choose(name, canceled);
    await movePointer(0.02);
    // The bar is revealed on hover; wait for the control before acting on it.
    const button = page.getByRole('button', { name: /Open.*CBZ/ });
    await button.waitFor({ state: 'visible', timeout: 5000 });
    await button.click({ timeout: 10000 });
  };

  // The open control lives in the hover-revealed Windows area, not a permanent row.
  assert.equal(await page.locator('[data-reader-toolbar]').count(), 0);
  assert.equal(await page.locator('[data-instance="readerOpen"]').count(), 0, 'the open control must not be visible before hover');
  await movePointer(0.02);
  await page.getByRole('button', { name: 'Open CBZ', exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await page.locator('[data-instance="readerOpen"]').count(), 1);
  checks.push('Open CBZ lives in the hover-revealed Windows area; no permanent reader bottom row');
  console.log('STEP: open control placement');

  await page.evaluate(() => {
    window.readerProof = [];
    const status = document.querySelector('[data-reader-status]');
    new MutationObserver(() => {
      const count = Number(status.dataset.prepared);
      if (count && !window.readerProof.some((sample) => sample.count === count)) {
        const view = document.querySelector('[data-reader-viewport]');
        window.readerProof.push({ count, slots: document.querySelectorAll('[data-reader-page]').length,
          images: document.querySelectorAll('[data-reader-page] img').length, height: view.scrollHeight, offset: view.scrollTop });
      }
    }).observe(status, { attributes: true });
  });
  await open('chapter.cbz');
  await page.waitForSelector('[data-reader-page="0"] img', { timeout: 20000 });
  const first = await page.evaluate(() => window.readerProof[0]);
  assert.equal(first.count, 5); assert.equal(first.images, 5); assert.equal(first.slots, 20);
  checks.push('first five decoded images visible before all twenty; every page slot exists at initial display'); console.log('STEP');;
  await page.mouse.move(500, 500);
  await page.mouse.wheel(0, 1400);
  await page.waitForFunction(() => document.querySelector('[data-reader-viewport]').scrollTop > 0);
  await page.waitForFunction(() => Number(document.querySelector('[data-reader-status]').dataset.prepared) === 20, null, { timeout: 30000 });
  const samples = await page.evaluate(() => window.readerProof);
  assert.ok(samples.every((sample) => sample.height === first.height));
  assert.equal(await page.locator('[data-reader-page] img').count(), 20);
  const names = await page.locator('[data-reader-page] img').evaluateAll((images) => images.map((image) => image.alt));
  assert.deepEqual(names, Array.from({ length: 20 }, (_, index) => `pages/${index + 1}.jpg`));
  checks.push('natural page order; background chapter completion; constant scroll extent; wheel works during loading'); console.log('STEP');;

  // A page is never shown wider than its own natural pixel width.
  const geometry = await page.evaluate(() => {
    const ratio = window.devicePixelRatio || 1;
    return [...document.querySelectorAll('[data-reader-page]')].map((slot) => {
      const image = slot.querySelector('img');
      const box = slot.getBoundingClientRect();
      return { name: image.alt, boxWidth: box.width, imageWidth: image.getBoundingClientRect().width,
        naturalWidth: image.naturalWidth / ratio, ratio: +(box.width / box.height).toFixed(4),
        naturalRatio: +(image.naturalWidth / image.naturalHeight).toFixed(4),
        centred: Math.abs((box.left + box.right) / 2 - (slot.parentElement.getBoundingClientRect().left + slot.parentElement.getBoundingClientRect().right) / 2) < 2 };
    });
  });
  for (const page of geometry) {
    assert.ok(page.boxWidth <= page.naturalWidth + 1, `${page.name} is wider than its natural width`);
    assert.ok(Math.abs(page.ratio - page.naturalRatio) < 0.01, `${page.name} aspect ratio changed`);
    assert.equal(page.centred, true);
  }
  checks.push('no page exceeds its natural width; aspect ratio preserved; narrow pages stay centred'); console.log('STEP');;

  // Zoom scales pages and the scroll extent together.
  const zoomBefore = await page.evaluate(() => ({
    zoom: document.querySelector('[data-reader-pages]').style.zoom,
    pageWidth: document.querySelector('[data-reader-page]').getBoundingClientRect().width,
    scrollHeight: document.querySelector('[data-reader-viewport]').scrollHeight }));
  await page.keyboard.down('Control');
  await page.mouse.move(500, 500);
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await page.waitForFunction((previous) => document.querySelector('[data-reader-pages]').style.zoom !== previous, zoomBefore.zoom);
  const zoomAfter = await page.evaluate(() => ({
    zoom: document.querySelector('[data-reader-pages]').style.zoom,
    pageWidth: document.querySelector('[data-reader-page]').getBoundingClientRect().width,
    scrollHeight: document.querySelector('[data-reader-viewport]').scrollHeight }));
  assert.equal(zoomAfter.zoom, '1.1');
  assert.ok(zoomAfter.pageWidth > zoomBefore.pageWidth, 'zoom did not widen the page');
  assert.ok(zoomAfter.scrollHeight > zoomBefore.scrollHeight, 'zoom did not extend the scroll extent');
  checks.push('Ctrl+wheel zoom scales pages and scroll extent together'); console.log('STEP');;

  const src = await page.locator('[data-reader-page="0"] img').getAttribute('src');
  const scroll = await page.locator('[data-reader-viewport]').evaluate((view) => view.scrollTop);
  await open('', true);
  await page.waitForFunction(() => !document.querySelector('[data-reader-toolbar] button')?.disabled ?? true);
  assert.equal(await page.locator('[data-reader-page="0"] img').getAttribute('src'), src);
  assert.equal(await page.locator('[data-reader-viewport]').evaluate((view) => view.scrollTop), scroll);
  for (const name of ['empty.cbz', 'invalid.cbz']) {
    await open(name);
    await page.waitForFunction(() => document.querySelector('[data-reader-status]').textContent.includes('Cannot load CBZ'));
    assert.equal(await page.locator('[data-reader-page="0"] img').getAttribute('src'), src);
  }
  checks.push('cancel, image-free archive and invalid ZIP preserve current chapter and scroll position'); console.log('STEP');;
  const authorization = await page.evaluate(async () => ({
    invalidPage: await window.shellHost.reader.prepare('../../outside', 0, 800),
    invalidSettings: await window.shellHost.reader.open({ renderWidth: 0, maxDecodeWidth: 0, maxDecodedMB: 0 }),
  }));
  assert.equal(authorization.invalidPage.ok, false); assert.equal(authorization.invalidSettings.ok, false);
  assert.equal(await application.evaluate(async ({ net }) => (await net.fetch('yuzread-page://page/00000000-0000-0000-0000-000000000000/0-800.png')).status), 404);
  checks.push('page protocol and IPC reject unknown sessions/invalid settings'); console.log('STEP');;

  const timingPromise = page.evaluate(() => new Promise((resolve) => {
    const times = []; let first, previous;
    const step = (time) => {
      if (first === undefined) first = time;
      if (previous !== undefined) times.push(time - previous);
      previous = time;
      if (time - first < 3000) requestAnimationFrame(step);
      else { const sorted = [...times].sort((a, b) => a - b); resolve({ frames: times.length,
        averageMs: times.reduce((a, b) => a + b, 0) / times.length,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)], worstMs: sorted.at(-1), over16ms: times.filter((value) => value > 16.8).length }); }
    }; requestAnimationFrame(step);
  }));
  const scrollingStarted = performance.now();
  while (performance.now() - scrollingStarted < 3000) {
    await page.mouse.wheel(0, 90);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  }
  const timing = await timingPromise;
  const graphics = await application.evaluate(async ({ app, screen }) => {
    await app.getGPUInfo('basic');
    return { features: app.getGPUFeatureStatus(), displays: screen.getAllDisplays().map(({ size, displayFrequency }) => ({ size, displayFrequency })) };
  });
  await page.screenshot({ path: path.join(evidence, 'reader-scroll.png') });
  checks.push('scroll-cadence sample collected alongside actual GPU feature/display status'); console.log('STEP');;

  await open('damaged.cbz');
  await page.waitForFunction((old) => document.querySelector('[data-reader-page="0"] img')?.src !== old, src, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[data-reader-status]').textContent.includes('Cannot load CBZ'), null, { timeout: 20000 });
  assert.ok(Number(await page.locator('[data-reader-status]').getAttribute('data-prepared')) >= 5);
  assert.equal(await page.locator('[data-reader-page]').count(), 20);
  checks.push('damaged later page reports background error while preserving visible pages and reserved geometry'); console.log('STEP');;
  assert.deepEqual(errors, []);
  const profile = await application.evaluate(({ app }) => app.getPath('userData'));
  result = { verdict: 'PASS', checks, timing, graphics, samples, geometry, evidence, profile };
  await application.close();
  assert.deepEqual(await readdir(path.join(profile, 'reader-cache')), []);
  checks.push('normal app close terminates archive workers and removes session page files'); console.log('STEP');;
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ verdict: 'FAIL', checks, error: error.stack, errors }, null, 2));
  throw error;
} finally { await application.close().catch(() => {}); }
