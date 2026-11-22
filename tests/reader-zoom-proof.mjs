import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// FIXTURES — zoom/input/lifetime only; no chapter scheduler or FPS benchmark.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime', `reader-zoom-${Date.now()}`);
await mkdir(path.join(evidence, 'pages'), { recursive: true });
const fixtures = [
  [2400, 1500],
  [800, 2000],
  [1200, 1200],
  [1000, 2800],
  [2400, 2601],
];
for (const [index, [width, height]] of fixtures.entries()) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#18243a"/><circle cx="${width / 2}" cy="${height / 2}" r="${width / 4}" fill="#7eabf5"/><text x="35" y="70" font-size="38" fill="white">Page ${index + 1}</text></svg>`;
  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(evidence, 'pages', `${index + 1}.png`));
}
await promisify(execFile)('python', [
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/"zoom.cbz","w",zipfile.ZIP_DEFLATED); [z.write(f,f.name) for f in sorted((p/"pages").glob("*.png"))]; z.close()',
  evidence,
]);
const raw = JSON.parse(await readFile(path.join(root, 'screen/config.json'), 'utf8'));
const settings = raw.areas
  .find((area) => area.id === 'body')
  .children.find((child) => child.id === 'reader');
const near = (actual, expected, label, tolerance = 1.2) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
const scenarios = [];
let app;
try {
  for (const scale of [1, 1.25]) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      args: [root, '--qa', `--force-device-scale-factor=${scale}`],
      cwd: root,
      env,
      timeout: 15000,
    });
    const page = await app.firstWindow(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('[data-reader]');
    await app.evaluate(
      async ({ BrowserWindow, screen }, height) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
        window.focus();
        screen.getCursorScreenPoint = () => {
          const bounds = window.getContentBounds();
          return { x: bounds.x + bounds.width / 2, y: bounds.y + (bounds.height * height) / 200 };
        };
      },
      raw.areas.find((area) => area.id === 'windowsBar').bounds.height,
    );
    const tick = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    const resize = async (width, height = 850) => {
      const size = await app.evaluate(
        ({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0];
          window.setSize(...size);
          return window.getContentSize();
        },
        [width, height],
      );
      await page.waitForFunction(
        ([w, h]) => Math.abs(innerWidth - w) <= 1 && Math.abs(innerHeight - h) <= 1,
        size,
        { timeout: 5000 },
      );
      await tick();
    };
    const open = async () => {
      await app.evaluate(
        ({ dialog }, file) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
        },
        path.join(evidence, 'zoom.cbz'),
      );
      await page.getByRole('button', { name: /Open.*CBZ/ }).click({ timeout: 5000 });
    };
    const ready = () =>
      page.waitForFunction(
        () => document.querySelector('[data-reader-status]').dataset.prepared === '5',
        null,
        { timeout: 20000, polling: 50 },
      );
    const measure = () =>
      page.evaluate(() => {
        const view = document.querySelector('[data-reader-viewport]'),
          strip = document.querySelector('[data-reader-pages]');
        const box = strip.getBoundingClientRect(),
          bounds = view.getBoundingClientRect();
        return {
          zoom: Number(strip.dataset.zoom),
          styleZoom: Number(strip.style.zoom || 1),
          ratio: devicePixelRatio,
          scrollTop: view.scrollTop,
          scrollLeft: view.scrollLeft,
          scrollHeight: view.scrollHeight,
          scrollWidth: view.scrollWidth,
          width: view.clientWidth,
          height: view.clientHeight,
          left: bounds.left,
          top: bounds.top,
          column: { left: box.left, top: box.top, width: box.width, height: box.height },
          pages: [...strip.querySelectorAll('[data-reader-page]')].map((slot) => {
            const box = slot.getBoundingClientRect(),
              image = slot.querySelector('img');
            return {
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              src: image?.src,
            };
          }),
        };
      });
    const point = async (index = 1, offset = 35) =>
      page.evaluate(
        ({ index, offset }) => {
          const view = document.querySelector('[data-reader-viewport]'),
            slot = document.querySelectorAll('[data-reader-page]')[index];
          const viewBox = view.getBoundingClientRect(),
            box = slot.getBoundingClientRect();
          const x = viewBox.left + view.clientWidth / 2 + offset,
            y = viewBox.top + view.clientHeight * 0.38;
          return { index, x, y, u: (x - box.left) / box.width, v: (y - box.top) / box.height };
        },
        { index, offset },
      );
    const verifyAnchor = async (anchor, label, horizontal = true) => {
      const box = (await measure()).pages[anchor.index];
      if (horizontal) near(box.left + anchor.u * box.width, anchor.x, `${label} horizontal anchor`);
      near(box.top + anchor.v * box.height, anchor.y, `${label} vertical anchor`);
    };
    const burst = async (deltas, anchor) => {
      const result = await page.evaluate(
        async ({ deltas, anchor }) => {
          const view = document.querySelector('[data-reader-viewport]'),
            strip = document.querySelector('[data-reader-pages]');
          const original = requestAnimationFrame;
          let requests = 0,
            mutations = 0;
          const observer = new MutationObserver((records) => {
            mutations += records.filter((record) => record.attributeName === 'style').length;
          });
          observer.observe(strip, { attributes: true });
          window.requestAnimationFrame = (callback) => {
            requests++;
            return original(callback);
          };
          const before = strip.style.zoom;
          const consumed = deltas.map(
            (delta) =>
              !view.dispatchEvent(
                new WheelEvent('wheel', {
                  ctrlKey: true,
                  deltaY: delta,
                  clientX: anchor.x,
                  clientY: anchor.y,
                  cancelable: true,
                }),
              ),
          );
          const immediate = strip.style.zoom;
          await new Promise((resolve) => original(() => original(resolve)));
          window.requestAnimationFrame = original;
          observer.disconnect();
          return { requests, mutations, before, immediate, consumed };
        },
        { deltas, anchor },
      );
      assert.ok(result.consumed.every(Boolean), 'Ctrl+wheel default must be prevented');
      assert.equal(
        result.immediate,
        result.before,
        'wheel bursts must defer layout until the frame',
      );
      assert.equal(
        result.requests,
        deltas.some((delta) => delta !== 0) ? 1 : 0,
        'one animation request per synchronous burst',
      );
      assert.ok(result.mutations <= 1, 'at most one scale mutation per burst');
      return result;
    };
    const verifyScale = async (base, label) => {
      const current = await measure();
      near(current.zoom, current.styleZoom, `${label} applied zoom`, 0.0001);
      for (const [index, box] of current.pages.entries()) {
        near(
          box.width,
          base.pages[index].width * current.zoom,
          `${label} page ${index} width`,
          0.1,
        );
        near(
          box.height,
          base.pages[index].height * current.zoom,
          `${label} page ${index} height`,
          0.1,
        );
        assert.equal(box.src, base.pages[index].src, 'zoom cannot replace accepted image URLs');
      }
      near(
        current.column.height,
        base.column.height * current.zoom,
        `${label} whole strip height`,
        0.2,
      );
      near(
        current.scrollHeight,
        Math.max(current.height, current.column.height),
        `${label} matching scroll extent`,
      );
      assert.equal(
        await page.evaluate(() =>
          window.zoomImages.every(
            (image, index) => image === document.querySelectorAll('[data-reader-page] img')[index],
          ),
        ),
        true,
        'zoom cannot replace accepted image elements',
      );
      return current;
    };

    await resize(1100);
    await open();
    await ready();
    await tick();
    await page.evaluate(() => {
      window.zoomImages = [...document.querySelectorAll('[data-reader-page] img')];
    });
    const base = await measure();
    near(base.ratio, scale, 'DPI', 0.001);
    assert.equal(base.zoom, 1);
    await resize(1700);
    await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]');
      view.scrollTop = 800;
    });
    await tick();
    const anchor = await point();
    const coalescing = await burst(Array(8).fill(-100), anchor);
    near((await measure()).zoom, 1.8, 'all burst steps retained', 0.0001);
    await verifyAnchor(anchor, 'centered to horizontally overflowing column');
    const enlarged = await verifyScale(base, 'zoom in');
    assert.ok(enlarged.scrollLeft > 0);
    await page.screenshot({ path: path.join(evidence, `anchored-${scale}.png`) });
    // A real wheel/keyboard path also proves Chromium browser zoom did not run.
    const realAnchor = await point(1, -20);
    await page.mouse.move(realAnchor.x, realAnchor.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForFunction(
      () => document.querySelector('[data-reader-pages]').dataset.zoom === '1.9',
    );
    await verifyAnchor(realAnchor, 'real Ctrl+wheel with horizontal scrolling');
    await verifyScale(base, 'real wheel');
    const center = await point(1, 0);
    center.y = (await measure()).top + (await measure()).height / 2;
    const centerBox = (await measure()).pages[1];
    center.v = (center.y - centerBox.top) / centerBox.height;
    await page.locator('[data-reader-viewport]').focus();
    await page.keyboard.press('Control+0');
    await tick();
    assert.equal((await measure()).zoom, 1);
    // A fitted column has no horizontal scroll range to retain an off-center
    // content point. Vertical reading stays anchored; native bounds re-center it.
    await verifyAnchor(center, 'Ctrl+0 viewport center', false);
    const fitted = await measure();
    assert.equal(fitted.scrollLeft, 0);
    near(
      fitted.column.left,
      fitted.left + (fitted.width - fitted.column.width) / 2,
      'reset fitted column centering',
    );
    await verifyScale(base, 'reset');
    const browser = await app.evaluate(({ BrowserWindow }) => {
      const web = BrowserWindow.getAllWindows()[0].webContents;
      return { factor: web.getZoomFactor(), level: web.getZoomLevel() };
    });
    assert.equal(browser.factor, 1);
    assert.equal(browser.level, 0);
    assert.equal(await page.evaluate(() => visualViewport.scale), 1);

    // Clamp every input, not only the final sum: reversing at a limit works immediately.
    await burst([...Array(100).fill(-100), 100], await point());
    near(
      (await measure()).zoom,
      settings.maxZoom - settings.zoomStep,
      'reverse immediately from upper limit',
      0.0001,
    );
    await burst(Array(100).fill(-100), await point());
    assert.equal((await measure()).zoom, settings.maxZoom);
    await verifyScale(base, 'upper limit');
    await burst(Array(100).fill(100), await point());
    assert.equal((await measure()).zoom, settings.minZoom);
    await verifyScale(base, 'lower limit');
    await burst([0], await point());
    assert.equal((await measure()).zoom, settings.minZoom);
    // Reset wins over an older queued wheel request in the same event turn.
    await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]');
      view.dispatchEvent(
        new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '0', ctrlKey: true, cancelable: true }),
      );
    });
    await tick();
    assert.equal((await measure()).zoom, 1);
    await verifyScale(base, 'pending reset');
    const beforeNative = await measure();
    await page.mouse.move(500, 400);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(
      (before) => document.querySelector('[data-reader-viewport]').scrollTop > before,
      beforeNative.scrollTop,
    );
    assert.equal((await measure()).zoom, 1);
    // The overlay forwards exactly once to the same zoom owner.
    await page.mouse.move(1693, 300);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForFunction(
      () => document.querySelector('[data-reader-pages]').dataset.zoom === '1.1',
    );
    await verifyScale(base, 'overlay wheel');
    await resize(720);
    const narrow = await verifyScale(base, 'resize while zoomed');
    assert.ok(narrow.scrollWidth > narrow.width);
    await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]');
      view.scrollLeft = 0;
    });
    let edge = await measure();
    near(edge.column.left, edge.left, 'left horizontal edge');
    await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]');
      view.scrollLeft = view.scrollWidth;
    });
    edge = await measure();
    near(edge.column.left + edge.column.width, edge.left + edge.width, 'right horizontal edge');
    await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]');
      view.scrollLeft = (view.scrollWidth - view.clientWidth) / 2;
      view.scrollTop = 800;
    });
    const narrowCenter = await point(1, 0);
    const narrowBox = (await measure()).pages[1];
    const narrowView = await measure();
    narrowCenter.y = narrowView.top + narrowView.height / 2;
    narrowCenter.v = (narrowCenter.y - narrowBox.top) / narrowBox.height;
    await page.locator('[data-reader-viewport]').focus();
    await page.keyboard.press('Control+0');
    await tick();
    await verifyAnchor(narrowCenter, 'Ctrl+0 while column remains horizontally scrollable');
    assert.equal((await measure()).zoom, 1);
    await burst([-100], await point(1, 0));
    // Force a cancelled frame to execute anyway: identity/cancellation guards must
    // still prevent stale zoom from landing on the replacement or released chapter.
    const hold = () =>
      page.evaluate(() => {
        window.zoomOriginalFrame = requestAnimationFrame;
        window.zoomOriginalCancel = cancelAnimationFrame;
        window.zoomHeldFrames = [];
        window.zoomCancelledFrames = [];
        window.requestAnimationFrame = (callback) => {
          window.zoomHeldFrames.push(callback);
          return 2000000000 + window.zoomHeldFrames.length;
        };
        window.cancelAnimationFrame = (id) => {
          window.zoomCancelledFrames.push(id);
        };
        const view = document.querySelector('[data-reader-viewport]');
        view.dispatchEvent(
          new WheelEvent('wheel', {
            ctrlKey: true,
            deltaY: -100,
            clientX: 300,
            clientY: 300,
            cancelable: true,
          }),
        );
      });
    const replay = () =>
      page.evaluate(() => {
        window.requestAnimationFrame = window.zoomOriginalFrame;
        window.cancelAnimationFrame = window.zoomOriginalCancel;
        const count = window.zoomCancelledFrames.length;
        for (const callback of window.zoomHeldFrames) callback(performance.now());
        return count;
      });
    await hold();
    const oldSource = edge.pages[0].src;
    await app.evaluate(
      ({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      },
      path.join(evidence, 'zoom.cbz'),
    );
    await page.getByRole('button', { name: /Open.*CBZ/ }).evaluate((button) => button.click());
    await page.waitForFunction(
      (source) => document.querySelector('[data-reader-page] img')?.src !== source,
      oldSource,
      { timeout: 20000, polling: 50 },
    );
    await ready();
    assert.ok((await replay()) > 0, 'replacement must cancel the old pending frame');
    await tick();
    assert.equal((await measure()).zoom, 1.1, 'stale wheel must not change replacement zoom');
    const releasedSource = (await measure()).pages[0].src;
    await hold();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.ok((await replay()) > 0, 'pagehide must cancel the pending frame');
    await tick();
    assert.equal((await measure()).zoom, 1.1, 'stale wheel must not run after cleanup');
    assert.equal(
      await app.evaluate(async ({ net }, url) => (await net.fetch(url)).status, releasedSource),
      404,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.shellDev.records()), []);
    scenarios.push({ scale, coalescing, browser, initial: base, zoomed: enlarged });
    await app.close();
    app = null;
  }
  const result = {
    verdict: 'PASS',
    checks: [
      '100%/125% DPI: uniform page and scroll-extent scaling with retained images',
      'off-center anchor from centered column into overflow and with horizontal scrolling',
      'real Ctrl+wheel and viewport-center Ctrl+0; browser zoom stays 100%',
      'one frame/scale update per burst; all steps retained, configured limits and zero input',
      'reset supersedes pending wheel; ordinary native scrolling and overlay forwarding',
      'zoomed resize preserves base geometry and accessible horizontal edges',
      'replacement/pagehide cancel pending callbacks; forced stale callbacks cannot alter new state',
    ],
    scenarios,
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({ verdict: result.verdict, checks: result.checks, evidence }, null, 2),
  );
} catch (error) {
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({ verdict: 'FAIL', error: error.stack, scenarios, evidence }, null, 2),
  );
  throw error;
} finally {
  if (app) await app.close();
}
