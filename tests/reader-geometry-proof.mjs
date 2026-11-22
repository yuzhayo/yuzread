import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// CONFIG AND FIXTURES — only page sizing/resize, not zoom or chapter navigation.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime', `reader-geometry-${Date.now()}`);
const input = path.join(evidence, 'pages');
await mkdir(input, { recursive: true });
const fixtures = [
  { name: '01-wide.png', width: 2400, height: 1500 },
  { name: '02-narrow.png', width: 800, height: 2000 },
  { name: '03-square.png', width: 1200, height: 1200 },
  { name: '04-tall.png', width: 1000, height: 2800 },
  { name: '05-wide-tall.png', width: 2400, height: 2601 },
  { name: '06-tiny.png', width: 11, height: 1 },
];
for (const { name, width, height } of fixtures) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#18243a"/><rect x="5" y="5" width="${Math.max(1, width - 10)}" height="${Math.max(1, height - 10)}" fill="none" stroke="#edcd78" stroke-width="5"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 5}" fill="#7eabf5"/><text x="35" y="70" font-size="38" fill="white">${name} ${width}x${height}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(input, name));
}
const run = promisify(execFile);
await run('python', ['-c', 'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/"mixed.cbz","w",zipfile.ZIP_DEFLATED); [z.write(f,"pages/"+f.name) for f in sorted((p/"pages").glob("*.png"),reverse=True)]; z.close()', evidence]);
const raw = JSON.parse(await readFile(path.join(root, 'screen/config.json'), 'utf8'));
const settings = raw.areas.find((node) => node.id === 'body').children.find((node) => node.id === 'reader');
const near = (actual, expected, message, tolerance = 0.04) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${message}: expected ${expected}, got ${actual}`);
const scenarios = [];
const migrationSmoke = process.argv.includes('--migration-smoke');
const migrationChecks = [];
let application;

try {
  // A fractional display-scale run proves physical-pixel rounding, not just 100% DPI.
  for (const scale of [1, 1.25]) {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ args: [root, '--qa', `--force-device-scale-factor=${scale}`], cwd: root, env, timeout: 15000 });
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('[data-reader]');
    await application.evaluate(async ({ BrowserWindow, screen }, stripHeight) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
      window.focus();
      // Keep the existing Open control revealed in this isolated QA process.
      // Native cursor/DPI hover is outside this page-geometry proof's scope.
      screen.getCursorScreenPoint = () => {
        const area = window.getContentBounds();
        return { x: area.x + area.width / 2, y: area.y + area.height * stripHeight / 200 };
      };
    }, raw.areas.find((node) => node.id === 'windowsBar').bounds.height);
    const resize = async (width, height = 850) => {
      const content = await application.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setSize(...size);
        return window.getContentSize();
      }, [width, height]);
      // Windows' fractional-DPI minimum-size conversion can differ by one DIP
      // between getContentSize() and the renderer's rounded innerWidth.
      await page.waitForFunction(([w, h]) => Math.abs(innerWidth - w) <= 1 && Math.abs(innerHeight - h) <= 1,
        content, { timeout: 5000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const measure = () => page.evaluate(() => new Promise((resolve) => {
      const view = document.querySelector('[data-reader-viewport]');
      // clientWidth is rounded to an integer. Use the exact content box at
      // fractional DPI so correct subpixel centering isn't reported as a defect.
      const observer = new ResizeObserver(([entry]) => {
      observer.disconnect();
      const column = document.querySelector('[data-reader-pages]');
      const viewport = view.getBoundingClientRect(), strip = column.getBoundingClientRect();
      resolve({ ratio: devicePixelRatio, viewport: { width: entry.contentRect.width, left: viewport.left + view.clientLeft },
        column: { width: strip.width, left: strip.left }, scrollHeight: view.scrollHeight, scrollTop: view.scrollTop,
        scrollWidth: view.scrollWidth, scrollLeft: view.scrollLeft,
        pages: [...document.querySelectorAll('[data-reader-page]')].map((slot) => {
          const box = slot.getBoundingClientRect(), image = slot.querySelector('img');
          return { name: image.alt, width: box.width, height: box.height, left: box.left, right: box.right,
            naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, fit: getComputedStyle(image).objectFit, src: image.src };
        }) });
      });
      observer.observe(view);
    }));
    const open = async (delay = 0) => {
      await application.evaluate(({ dialog }, selection) => {
        dialog.showOpenDialog = async () => {
          if (selection.delay) await new Promise((resolve) => setTimeout(resolve, selection.delay));
          return { canceled: false, filePaths: [selection.file] };
        };
      }, { file: path.join(evidence, 'mixed.cbz'), delay });
      await page.getByRole('button', { name: /Open.*CBZ/ }).click({ timeout: 5000 });
    };
    const ready = async () => {
      await page.waitForFunction(() => document.querySelector('[data-reader-status]').dataset.prepared === '6', null, { timeout: 20000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    };
    const verify = (measurement, maximum) => {
      near(measurement.ratio, scale, 'DPI scale');
      for (const [index, actual] of measurement.pages.entries()) {
        const expected = fixtures[index];
        assert.equal(actual.name, `pages/${expected.name}`);
        const width = Math.min(expected.width, maximum);
        const height = Math.max(1, Math.round(expected.height * width / expected.width));
        near(actual.width, width / scale, `${expected.name} display width`);
        near(actual.height, height / scale, `${expected.name} display height`);
        assert.ok(actual.width * scale <= expected.width + 0.05);
        near(actual.height * scale, Math.round(actual.height * scale), 'whole physical-pixel height');
        assert.equal(actual.fit, 'contain');
        near(actual.left + actual.width / 2, measurement.column.left + measurement.column.width / 2, 'page centered in chapter');
      }
      near(measurement.column.width, Math.max(...measurement.pages.map((image) => image.width)), 'column matches widest page');
      if (measurement.column.width <= measurement.viewport.width) {
        near(measurement.column.left + measurement.column.width / 2,
          measurement.viewport.left + measurement.viewport.width / 2, 'chapter centered in viewport');
      }
    };

    const opening = await page.evaluate(() => ({ width: document.querySelector('[data-reader-viewport]').clientWidth, ratio: devicePixelRatio }));
    const maximum = Math.min(settings.maxRenderWidth, Math.max(1, Math.floor((opening.width - settings.pageInset) * opening.ratio)));
    await open(); await ready();
    const initial = await measure(); verify(initial, maximum);
    if (migrationSmoke && scale === 1) {
      const view = await page.locator('[data-reader-viewport]').boundingBox();
      const layout = await page.evaluate(() => {
        const view = document.querySelector('[data-reader-viewport]'), body = document.querySelector('#body');
        return { bodyWidth: body.clientWidth, viewportWidth: view.clientWidth };
      });
      assert.equal(layout.viewportWidth, layout.bodyWidth, 'overlay must not reserve a vertical gutter');
      await page.mouse.move(view.x + 100, view.y + 400);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-reader-scrollbar]')).opacity === '0');
      await page.mouse.move(view.x + view.width - 7, view.y + 120);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-reader-scrollbar]')).opacity === '1');
      await page.mouse.down();
      await page.mouse.move(view.x + view.width - 70, view.y + 350, { steps: 10 });
      assert.ok(await page.evaluate(() => document.querySelector('[data-reader-viewport]').scrollTop > 0), 'overlay drag moves native scroll position');
      await page.mouse.up(); await page.mouse.move(view.x + 100, view.y + 400);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-reader-scrollbar]')).opacity === '0');
      const beforeWheel = await page.evaluate(() => document.querySelector('[data-reader-viewport]').scrollTop);
      await page.mouse.wheel(0, 100);
      await page.waitForFunction((before) => document.querySelector('[data-reader-viewport]').scrollTop > before, beforeWheel);
      assert.deepEqual((await measure()).pages.map(({width,height,src}) => ({width,height,src})), initial.pages.map(({width,height,src}) => ({width,height,src})));
      migrationChecks.push('full-width overlay hover/drag/wheel with unchanged pages');
    }
    await page.evaluate(() => {
      window.geometryImages = [...document.querySelectorAll('[data-reader-page] img')];
      document.querySelector('[data-reader-viewport]').scrollTop = 300;
    });
    await resize(2200);
    // The old resize loop ran every 500 ms. This observation window catches replacement.
    await page.waitForTimeout(900);
    const wide = await measure(); verify(wide, maximum);
    near(wide.scrollTop, 300, 'vertical reading offset after widening');
    assert.equal(await page.evaluate(() => window.geometryImages.every((image, index) => image === document.querySelectorAll('[data-reader-page] img')[index])), true,
      'resize must not replace already-decoded image elements');
    assert.deepEqual(wide.pages.map(({ width, height, src }) => ({ width, height, src })),
      initial.pages.map(({ width, height, src }) => ({ width, height, src })));
    await page.screenshot({ path: path.join(evidence, `wide-${scale}.png`) });

    await resize(720);
    const narrow = await measure(); verify(narrow, maximum);
    assert.ok(narrow.scrollWidth > narrow.viewport.width, 'wide loaded pages must remain horizontally scrollable');
    near(narrow.pages[0].left, narrow.viewport.left, 'left edge accessible at scrollLeft zero');
    await page.evaluate(() => { const view = document.querySelector('[data-reader-viewport]'); view.scrollLeft = view.scrollWidth; });
    const right = await measure();
    assert.ok(right.scrollLeft > 0);
    near(right.pages[0].right, right.viewport.left + right.viewport.width, 'right edge accessible', 1.1);
    near(narrow.scrollTop, 300, 'vertical reading offset after narrowing');
    await page.screenshot({ path: path.join(evidence, `narrow-${scale}.png`) });

    // Resize while the dialog/preparation is pending: snapshot one size for the chapter.
    const before = await page.evaluate(() => ({ width: document.querySelector('[data-reader-viewport]').clientWidth, ratio: devicePixelRatio }));
    const nextMaximum = Math.min(settings.maxRenderWidth, Math.max(1, Math.floor((before.width - settings.pageInset) * before.ratio)));
    const oldSource = narrow.pages[0].src;
    await open(500);
    await resize(1600);
    await page.waitForFunction((source) => document.querySelector('[data-reader-page] img')?.src !== source, oldSource, { timeout: 20000 });
    await ready();
    const reopened = await measure(); verify(reopened, nextMaximum);
    if (migrationSmoke) {
      assert.equal(await application.evaluate(async ({ net }, source) => (await net.fetch(source)).status, oldSource), 404,
        'replacement must revoke the released session image token');
      migrationChecks.push(`released session token unavailable at DPI ${scale}`);
    }
    assert.deepEqual(await page.evaluate(() => window.shellDev.records()), []);
    assert.deepEqual(errors, []);
    scenarios.push({ scale, maximum, initial, wide, narrow, reopened });
    await application.close(); application = null;
  }
  const result = { verdict: 'PASS', checks: ['per-page natural-width cap and physical-pixel rounding',
    'fixed chapter column centered on wider viewport', 'no resize image replacement or size change',
    'horizontal overflow has accessible left/right edges', 'vertical reading offset preserved',
    'one opening geometry snapshot during resize', '100% and 125% DPI', ...migrationChecks], scenarios, evidence };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ verdict: result.verdict, checks: result.checks, evidence,
    pages: scenarios[0].wide.pages.map(({ name, width, height }) => ({ name, width, height })) }, null, 2));
} catch (error) {
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ verdict: 'FAIL', error: error.stack, scenarios }, null, 2));
  throw error;
} finally { if (application) await application.close(); }
