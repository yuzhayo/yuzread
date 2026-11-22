import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// FIXTURES — diagnostics toggling and honest signals, not a presented-frame benchmark.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const stamp = Date.now(),
  evidence = path.join(root, '.runtime', `reader-diagnostics-${stamp}`),
  enabledRoot = path.join(root, '.runtime', `q6-${stamp}`);
await mkdir(path.join(evidence, 'pages'), { recursive: true });
for (let index = 0; index < 6; index++) {
  const width = index === 0 ? 1600 : 800,
    height = 1200;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#18243a"/><circle cx="${width / 2}" cy="${height / 2}" r="${width / 4}" fill="#7eabf5"/><text x="20" y="60" font-size="28" fill="white">Diagnostic page ${index + 1}</text></svg>`;
  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(evidence, 'pages', `${index + 1}.png`));
}
await promisify(execFile)('python', [
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/"diagnostic.cbz","w",zipfile.ZIP_DEFLATED); [z.write(f,f.name) for f in sorted((p/"pages").glob("*.png"))]; z.close()',
  evidence,
]);
const config = JSON.parse(await readFile(path.join(root, 'screen/config.json'), 'utf8'));
const selectedIndex = process.argv.indexOf('--archive');
const archive =
  selectedIndex >= 0
    ? path.resolve(process.argv[selectedIndex + 1])
    : path.join(evidence, 'diagnostic.cbz');
const enabledConfig = structuredClone(config);
enabledConfig.areas
  .find((area) => area.id === 'body')
  .children.find((child) => child.id === 'reader').diagnostics = true;
await mkdir(path.join(enabledRoot, 'screen'), { recursive: true });
await mkdir(path.join(enabledRoot, 'electron'), { recursive: true });
await cp(path.join(root, 'screen-built'), path.join(enabledRoot, 'screen-built'), {
  recursive: true,
});
await cp(path.join(root, 'electron-built'), path.join(enabledRoot, 'electron-built'), {
  recursive: true,
});
await cp(path.join(root, 'electron', 'assets'), path.join(enabledRoot, 'electron', 'assets'), {
  recursive: true,
});
await cp(
  path.join(root, 'electron', 'config.json'),
  path.join(enabledRoot, 'electron', 'config.json'),
);
await writeFile(path.join(enabledRoot, 'screen', 'config.json'), JSON.stringify(enabledConfig));
await writeFile(
  path.join(enabledRoot, 'package.json'),
  JSON.stringify({ name: 'yuzread-diagnostic-qa', main: 'electron-built/main.cjs' }),
);
const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) <= 1.2, `${label}: ${actual} != ${expected}`);
const checks = [],
  observations = {};
let app;
try {
  for (const enabled of [false, true]) {
    const appRoot = enabled ? enabledRoot : root,
      env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
      args: [appRoot, '--qa', '--force-device-scale-factor=1'],
      cwd: appRoot,
      env,
      timeout: 15000,
    });
    const page = await app.firstWindow(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('[data-reader]');
    await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window.webContents.isLoading()) await new Promise(resolve => window.webContents.once('did-finish-load',resolve));
      if (!window.isVisible()) await new Promise(resolve => window.once('show',resolve));
    });
    // Instrument a fresh document before the reader mounts. The original RAF is
    // used for test waits, so test callbacks cannot masquerade as diagnostic work.
    await page.addInitScript(() => {
      window.diagCounts = { raf: 0, observers: 0 };
      window.diagOriginalRAF = requestAnimationFrame;
      window.requestAnimationFrame = (callback) => {
        window.diagCounts.raf++;
        return window.diagOriginalRAF(callback);
      };
      const Original = PerformanceObserver;
      window.PerformanceObserver = class extends Original {
        constructor(callback) {
          super(callback);
          window.diagCounts.observers++;
        }
      };
    });
    await page.reload();
    await page.waitForSelector('[data-reader]');
    const log = await app.evaluate(
      async ({ BrowserWindow, app, screen }, height) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
        window.focus();
        window.setSize(900, 700);
        screen.getCursorScreenPoint = () => {
          const b = window.getContentBounds();
          return { x: b.x + b.width / 2, y: b.y + (b.height * height) / 200 };
        };
        return app.getPath('userData') + '/reader-diagnostics.log';
      },
      config.areas.find((area) => area.id === 'windowsBar').bounds.height,
    );
    await page.waitForFunction(() => innerWidth === 900 && innerHeight === 700, null, {
      timeout: 5000,
      polling: 50,
    });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, archive);
    await page.getByRole('button', { name: /Open.*CBZ/ }).click({ timeout: 5000 });
    await page.waitForFunction(
      () => {
        const status = document.querySelector('[data-reader-status]');
        return status.dataset.prepared === status.dataset.total && Number(status.dataset.total) > 0;
      },
      null,
      { timeout: 30000, polling: 50 },
    );
    const tick = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => window.diagOriginalRAF(() => window.diagOriginalRAF(resolve))),
      );
    const snapshot = () =>
      page.evaluate(() => ({
        top: document.querySelector('[data-reader-viewport]').scrollTop,
        zoom: Number(document.querySelector('[data-reader-pages]').dataset.zoom),
        pages: [...document.querySelectorAll('[data-reader-page]')].map((slot) => {
          const box = slot.getBoundingClientRect(),
            image = slot.querySelector('img');
          return { width: box.width, height: box.height, src: image?.src };
        }),
      }));
    const initial = await snapshot();
    await page.evaluate(() => {
      window.diagImages = [...document.querySelectorAll('[data-reader-page] img')];
    });
    if (!enabled) {
      const before = await page.evaluate(() => ({ ...window.diagCounts }));
      await page.evaluate(() => {
        document.querySelector('[data-reader-viewport]').scrollTop = 100;
      });
      await tick();
      const after = await page.evaluate(() => ({ ...window.diagCounts }));
      assert.equal(after.observers, 0, 'disabled mode must create no PerformanceObserver');
      assert.equal(after.raf, before.raf, 'ordinary scrolling must add no diagnostic RAF work');
      assert.equal(
        (
          await page.evaluate(() =>
            window.shellHost.reader.diagnostics([
              { kind: 'image', clockMs: 0, values: { durationMs: 1 } },
            ]),
          )
        ).ok,
        true,
      );
      assert.equal(
        await access(log)
          .then(() => true)
          .catch(() => false),
        false,
        'disabled native service must not create reader log',
      );
      assert.deepEqual((await snapshot()).pages, initial.pages);
      observations.disabled = { before, after };
      checks.push(
        'default-off creates no reader log, PerformanceObserver or ordinary-scroll frame loop, even after a direct valid metric call',
      );
    } else {
      await page.mouse.move(400, 300);
      await page.mouse.wheel(0, 120);
      await page.evaluate(() => new Promise((resolve) => window.diagOriginalRAF(resolve)));
      // One controlled UI stall proves the signal, not the machine's normal FPS.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              const until = performance.now() + 60;
              while (performance.now() < until) {}
              resolve();
            }, 0),
          ),
      );
      await page.locator('[data-reader-viewport]').focus();
      await page.keyboard.press('Control+0');
      await tick();
      await page.waitForTimeout(1100); // Outside the documented input/layout attribution window.
      const beforeJump = await snapshot();
      await page.evaluate(() => {
        document.querySelector('[data-reader-viewport]').scrollTop += 37;
      });
      await tick();
      await page.waitForTimeout(1100); // Flush the one-second bounded renderer batch.
      assert.equal((await page.evaluate(() => window.shellHost.reader.diagnostics([]))).ok, true);
      const records = (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.ok(
        records.some(
          (record) =>
            record.source === 'native' &&
            record.kind === 'work' &&
            typeof record.values.queuedMs === 'number' &&
            typeof record.values.workMs === 'number',
        ),
      );
      assert.ok(
        records.some(
          (record) =>
            record.source === 'native' &&
            record.kind === 'image' &&
            typeof record.values.imageWorkMs === 'number',
        ),
      );
      assert.ok(
        records.some(
          (record) =>
            record.source === 'renderer' &&
            record.kind === 'image' &&
            typeof record.values.imageDecodeMs === 'number',
        ),
      );
      assert.ok(records.some((record) => record.source === 'renderer' && record.kind === 'attach'));
      assert.ok(
        records.some((record) => record.kind === 'frame-gap' && record.values.durationMs >= 25),
        'controlled stall must produce a callback hitch',
      );
      assert.ok(
        records.some((record) => record.kind === 'long-task' && record.values.durationMs >= 50),
        'controlled stall must produce a long-task observation',
      );
      const jumps = records.filter((record) => record.kind === 'scroll-jump');
      assert.equal(jumps.length, 1, 'known input/Open/layout/zoom must not be misclassified');
      near(jumps[0].values.dy, 37, 'unexplained jump displacement');
      const frames = records.filter((record) => record.kind === 'frame-summary');
      assert.ok(frames.length > 0);
      assert.ok(
        frames.every(
          (record) =>
            record.values.metric === 'raf-callback-cadence' && record.values.callbackHz > 0,
        ),
      );
      const environment = records.find((record) => record.kind === 'environment');
      assert.ok(environment);
      assert.equal(environment.values.presentedFrames, 'not-collected');
      assert.equal(environment.values.backend, 'sharp-cpu');
      assert.ok(
        records.some(
          (record) =>
            record.kind === 'memory' &&
            record.values.scope === 'main-process-only' &&
            record.values.mainProcessRssBytes > 0,
        ),
      );
      assert.ok((await stat(log)).size <= 4 * 1048576);
      assert.equal(
        (
          await page.evaluate(() =>
            window.shellHost.reader.diagnostics([{ kind: 'bad', clockMs: 0, values: {} }]),
          )
        ).ok,
        false,
      );
      const after = await snapshot();
      near(after.top, beforeJump.top + 37, 'observing must not repair/mutate scroll');
      assert.deepEqual(after.pages, initial.pages);
      assert.equal(
        await page.evaluate(() =>
          window.diagImages.every(
            (image, index) => image === document.querySelectorAll('[data-reader-page] img')[index],
          ),
        ),
        true,
      );
      await page.waitForTimeout(500);
      const quiet = await page.evaluate(() => window.diagCounts.raf);
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(() => window.diagCounts.raf),
        quiet,
        'sampling must stop when idle',
      );
      // Shutdown removes callbacks/listeners; a later raw scroll cannot restart them.
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await tick();
      const closed = await page.evaluate(() => ({ ...window.diagCounts }));
      await page.evaluate(() => {
        document.querySelector('[data-reader-viewport]').scrollTop += 40;
      });
      await tick();
      assert.equal(await page.evaluate(() => window.diagCounts.raf), closed.raf);
      observations.enabled = {
        recordCount: records.length,
        displayHz: environment.values.displayHz,
        frameSummaries: frames.map((record) => record.values),
        jumps: jumps.map((record) => record.values),
        log,
      };
      checks.push(
        'opt-in writes bounded native/renderer timings, estimated-budget context and separately labeled main-process RSS',
      );
      checks.push(
        'controlled hitch/long task and 37-pixel unexplained jump detected; known input/layout not flagged; cadence is explicitly not presented FPS',
      );
      checks.push(
        'diagnostics preserve images/geometry/scroll, stop sampling while idle and remove activity on pagehide',
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.shellDev.records()), []);
    await app.close();
    app = null;
  }
  const result = {
    verdict: 'PASS',
    checks,
    observations,
    evidence,
    coverage: {
      archive: selectedIndex >= 0 ? 'caller-supplied' : 'generated-fixture',
      presentedFrames: 'not measured',
      performanceTarget: 'not certified',
    },
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      { verdict: result.verdict, checks, coverage: result.coverage, evidence },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify(
      { verdict: 'FAIL', error: error.stack, checks, observations, evidence },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (app) await app.close();
}
