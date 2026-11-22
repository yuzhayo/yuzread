import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// FIXTURES — actual native admission plus reader priority/budget handoffs, not RSS/FPS.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const stamp = Date.now(),
  evidence = path.join(root, '.runtime', `reader-scheduling-${stamp}`);
const smallApp = path.join(root, '.runtime', `q5-${stamp}`);
await mkdir(evidence, { recursive: true });
const definitions = {
  budget: {
    'chapter1.cbz': Array(4).fill([800, 1500]),
    'chapter2.cbz': Array(4).fill([800, 1500]),
  },
  priority: {
    'chapter1.cbz': Array(6).fill([800, 1400]),
    'chapter2.cbz': Array(4).fill([800, 1000]),
    'chapter3.cbz': Array(8).fill([800, 900]),
  },
  single: { 'only.cbz': Array(3).fill([800, 900]) },
};
const hashes = new Map();
for (const [folder, entries] of Object.entries(definitions))
  for (const [name, pages] of Object.entries(entries)) {
    const input = path.join(evidence, folder, `${name}-pages`);
    await mkdir(input, { recursive: true });
    for (const [index, [width, height]] of pages.entries()) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#18243a"/><circle cx="${width / 2}" cy="${height / 2}" r="${width / 4}" fill="#7eabf5"/><text x="20" y="60" font-size="28" fill="white">${name} / ${index + 1}</text></svg>`;
      await sharp(Buffer.from(svg))
        .png()
        .toFile(path.join(input, `${String(index + 1).padStart(2, '0')}.png`));
    }
    await promisify(execFile)('python', [
      '-c',
      'import pathlib,zipfile,sys; p=pathlib.Path(sys.argv[1]); name=sys.argv[2]; z=zipfile.ZipFile(p.parent/name,"w",zipfile.ZIP_DEFLATED); [z.write(f,name+"/"+f.name) for f in sorted(p.glob("*.png"))]; z.close()',
      input,
      name,
    ]);
    const file = path.join(evidence, folder, name);
    hashes.set(
      file,
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    );
  }
// Copy compiled owners into a short isolated QA root to use a 64-MB config without
// editing the operator's real configuration or hitting Windows imaging path limits.
await mkdir(path.join(smallApp, 'screen'), { recursive: true });
await mkdir(path.join(smallApp, 'electron'), { recursive: true });
await cp(path.join(root, 'electron-built'), path.join(smallApp, 'electron-built'), {
  recursive: true,
});
await cp(path.join(root, 'screen-built'), path.join(smallApp, 'screen-built'), { recursive: true });
await cp(path.join(root, 'electron', 'assets'), path.join(smallApp, 'electron', 'assets'), {
  recursive: true,
});
await cp(
  path.join(root, 'electron', 'config.json'),
  path.join(smallApp, 'electron', 'config.json'),
);
const config = JSON.parse(await readFile(path.join(root, 'screen/config.json'), 'utf8'));
const lowConfig = structuredClone(config);
lowConfig.areas
  .find((area) => area.id === 'body')
  .children.find((child) => child.id === 'reader').maxDecodedMB = 64;
await writeFile(path.join(smallApp, 'screen', 'config.json'), JSON.stringify(lowConfig));
await writeFile(
  path.join(smallApp, 'package.json'),
  JSON.stringify({ name: 'yuzread-qa', main: 'electron-built/main.cjs' }),
);
const checks = [],
  observations = {};
let app;
const near = (actual, expected, label, tolerance = 1.4) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
const validBudget = (budget) => {
  assert.ok(budget);
  assert.ok(
    budget.residentBytes + budget.inFlightBytes <= budget.limitBytes,
    'aggregate estimate must stay within one budget',
  );
  assert.ok(budget.activeJobs <= 1);
  assert.ok(budget.queuedJobs <= 64);
  return budget;
};
try {
  const launch = async (appRoot) => {
    const env = { ...process.env };
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
    await app.evaluate(
      async ({ BrowserWindow, screen }, height) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
        window.focus();
        screen.getCursorScreenPoint = () => {
          const bounds = window.getContentBounds();
          return { x: bounds.x + bounds.width / 2, y: bounds.y + (bounds.height * height) / 200 };
        };
        window.setSize(900, 700);
      },
      config.areas.find((area) => area.id === 'windowsBar').bounds.height,
    );
    await page.waitForFunction(() => innerWidth === 900 && innerHeight === 700, null, {
      timeout: 5000,
    });
    const tick = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    const select = (file) =>
      app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
    const open = async (folder, name) => {
      await select(path.join(evidence, folder, name));
      await page.getByRole('button', { name: /Open.*CBZ/ }).click({ timeout: 5000 });
    };
    const snapshot = () =>
      page.evaluate(() => {
        const view = document.querySelector('[data-reader-viewport]'),
          strip = document.querySelector('[data-reader-pages]');
        return {
          top: view.scrollTop,
          left: view.scrollLeft,
          current: strip.dataset.currentChapter,
          catalog: strip.dataset.readerCatalog,
          chapters: [...strip.querySelectorAll('[data-reader-chapter]')].map((root) => {
            const box = root.getBoundingClientRect();
            return {
              name: root.getAttribute('aria-label'),
              entry: root.dataset.readerChapter,
              id: root.dataset.readerSession,
              top: box.top,
              left: box.left,
              height: box.height,
              pages: [...root.querySelectorAll('[data-reader-page]')].map((slot) => {
                const box = slot.getBoundingClientRect(),
                  image = slot.querySelector('img');
                return { width: box.width, height: box.height, src: image?.src };
              }),
            };
          }),
        };
      });
    const chapter = (name) => page.locator(`[data-reader-chapter][aria-label="${name}"]`);
    const ready = () =>
      page.waitForFunction(
        () => {
          const status = document.querySelector('[data-reader-status]');
          return (
            status.dataset.total === status.dataset.prepared && Number(status.dataset.total) > 0
          );
        },
        null,
        { timeout: 20000, polling: 50 },
      );
    const fetchStatus = (url) =>
      app.evaluate(async ({ net }, url) => (await net.fetch(url)).status, url);
    return { page, tick, select, open, snapshot, chapter, ready, fetchStatus, errors };
  };

  const low = await launch(smallApp);
  const options = { renderWidth: 800, maxDecodeWidth: 4096, maxDecodedMB: 64 };
  await low.select(path.join(evidence, 'budget', 'chapter1.cbz'));
  const first = await low.page.evaluate(
    (options) => window.shellHost.reader.open(options),
    options,
  );
  assert.equal(first.ok, true);
  const prepared = await low.page.evaluate(
    (id) => window.shellHost.reader.prepare(id, 0, 800, 'visible'),
    first.chapter.id,
  );
  assert.equal(prepared.ok, true);
  validBudget(prepared.budget);
  await low.select(path.join(evidence, 'budget', 'chapter2.cbz'));
  const second = await low.page.evaluate(
    (options) => window.shellHost.reader.open(options),
    options,
  );
  assert.equal(second.ok, true);
  const deferred = await low.page.evaluate(
    (id) => window.shellHost.reader.prepare(id, 0, 800, 'background'),
    second.chapter.id,
  );
  assert.equal(deferred.ok, false);
  assert.equal(deferred.code, 'deferred');
  validBudget(deferred.budget);
  assert.equal(deferred.budget.limitBytes, 64 * 1048576);
  assert.ok(
    deferred.budget.residentBytes > prepared.budget.residentBytes,
    'both catalogs share resident accounting',
  );
  assert.equal(await low.fetchStatus(prepared.url), 200);
  assert.equal(await low.fetchStatus(`yuzread-page://page/${second.chapter.id}/0-800.png`), 404);
  await low.page.evaluate((id) => window.shellHost.reader.release(id), first.catalog.id);
  const admitted = await low.page.evaluate(
    (id) => window.shellHost.reader.prepare(id, 0, 800, 'demand'),
    second.chapter.id,
  );
  assert.equal(admitted.ok, true);
  validBudget(admitted.budget);
  assert.equal(admitted.budget.limitBytes, 64 * 1048576);
  for (const priority of ['gpu', null, 42])
    assert.equal(
      (
        await low.page.evaluate(
          ({ id, priority }) => window.shellHost.reader.prepare(id, 1, 800, priority),
          { id: second.chapter.id, priority },
        )
      ).ok,
      false,
    );
  await low.page.evaluate((id) => window.shellHost.reader.release(id), second.catalog.id);
  observations.native = {
    prepared: prepared.budget,
    deferred: deferred.budget,
    admitted: admitted.budget,
  };
  checks.push(
    'actual native workers share 64 MB across catalogs; decode/variants defer instead of oversubscribing; old tokens survive and work resumes after release',
  );

  await low.open('budget', 'chapter1.cbz');
  await low.ready();
  await low.page.waitForFunction(
    () => document.querySelector('[data-reader-status]').textContent.includes('reader budget'),
    null,
    { timeout: 20000, polling: 50 },
  );
  const before = await low.snapshot();
  assert.equal(before.chapters.length, 1);
  await low.page.evaluate(() => {
    window.budgetKeptImages = [...document.querySelectorAll('[data-reader-page] img')];
  });
  assert.equal(await low.fetchStatus(before.chapters[0].pages[0].src), 200);
  await low.tick();
  assert.deepEqual((await low.snapshot()).chapters[0].pages, before.chapters[0].pages);
  assert.equal(
    await low.page.evaluate(() =>
      window.budgetKeptImages.every(
        (image, index) => image === document.querySelectorAll('[data-reader-page] img')[index],
      ),
    ),
    true,
  );
  const handoff = await low.page.evaluate(() => {
    const view = document.querySelector('[data-reader-viewport]'),
      current = document.querySelector('[data-reader-chapter]');
    view.scrollTop +=
      current.getBoundingClientRect().bottom - view.getBoundingClientRect().top + 20;
    return {
      top: view.scrollTop,
      chapterTop: current.getBoundingClientRect().bottom - view.getBoundingClientRect().top,
    };
  });
  await low.chapter('chapter2.cbz').waitFor({ state: 'attached', timeout: 20000 });
  await low.ready();
  await low.tick();
  const after = await low.snapshot();
  assert.deepEqual(
    after.chapters.map((chapter) => chapter.name),
    ['chapter2.cbz'],
  );
  near(after.top, handoff.top, 'budget handoff preserves absolute history offset');
  near(after.chapters[0].top, handoff.chapterTop, 'new chapter anchor');
  assert.deepEqual(
    after.chapters[0].pages.map(({ width, height }) => ({ width, height })),
    before.chapters[0].pages.map(({ width, height }) => ({ width, height })),
  );
  assert.equal(await low.fetchStatus(before.chapters[0].pages[0].src), 404);
  await low.page.screenshot({ path: path.join(evidence, 'budget-handoff.png') });
  observations.handoff = { before, after };
  checks.push(
    '64-MB UI defers next without changing visible images; entering next retires only offscreen content and resumes decode with unchanged geometry/anchor',
  );
  assert.deepEqual(low.errors, []);
  assert.deepEqual(await low.page.evaluate(() => window.shellDev.records()), []);
  await app.close();
  app = null;

  const normal = await launch(root);
  await normal.open('priority', 'chapter1.cbz');
  await normal.ready();
  await normal.chapter('chapter2.cbz').waitFor({ state: 'attached', timeout: 20000 });
  const initial = await normal.snapshot(),
    old = initial.chapters[0];
  await normal.page.evaluate(() => {
    window.schedulingEvents = [];
    window.schedulingGates = {};
    window.schedulingOriginalDecode = Image.prototype.decode;
    Image.prototype.decode = function () {
      window.schedulingEvents.push(this.alt);
      const promise = window.schedulingOriginalDecode.call(this),
        gate = window.schedulingGates[this.alt];
      if (!gate) return promise;
      gate.source = this.src;
      return promise.then(
        () =>
          new Promise((resolve) => {
            gate.hit = true;
            gate.release = resolve;
          }),
      );
    };
    window.schedulingGates['chapter3.cbz/01.png'] = {};
    window.schedulingGates['chapter1.cbz/06.png'] = {};
    window.priorityKeptImages = [
      ...document
        .querySelector('[data-reader-chapter][aria-label="chapter2.cbz"]')
        .querySelectorAll('img'),
    ];
  });
  await normal.page.evaluate(() => {
    const view = document.querySelector('[data-reader-viewport]'),
      current = document.querySelector('[data-reader-chapter]');
    view.scrollTop +=
      current.getBoundingClientRect().bottom - view.getBoundingClientRect().top + 20;
  });
  await normal.page.waitForFunction(() => window.schedulingGates['chapter3.cbz/01.png'].hit, null, {
    timeout: 20000,
    polling: 50,
  });
  assert.equal(await normal.fetchStatus(old.pages[0].src), 404);
  await normal.page.evaluate((height) => {
    document.querySelector('[data-reader-viewport]').scrollTop = height - 150;
  }, old.height);
  await normal.page.evaluate(() => {
    const gate = window.schedulingGates['chapter3.cbz/01.png'];
    delete window.schedulingGates['chapter3.cbz/01.png'];
    gate.release();
  });
  await normal.page.waitForFunction(() => window.schedulingGates['chapter1.cbz/06.png'].hit, null, {
    timeout: 20000,
    polling: 50,
  });
  const preempted = await normal.page.evaluate(() => ({
    events: [...window.schedulingEvents],
    source: window.schedulingGates['chapter1.cbz/06.png'].source,
  }));
  assert.deepEqual(
    preempted.events,
    ['chapter3.cbz/01.png', 'chapter1.cbz/06.png'],
    'visible tail page must preempt next before page 2, not after a whole chapter',
  );
  await normal.page.evaluate((height) => {
    document.querySelector('[data-reader-viewport]').scrollTop = height + 30;
  }, old.height);
  await normal.tick();
  await normal.page.evaluate(() => {
    const gate = window.schedulingGates['chapter1.cbz/06.png'];
    delete window.schedulingGates['chapter1.cbz/06.png'];
    gate.release();
  });
  await normal.chapter('chapter3.cbz').waitFor({ state: 'attached', timeout: 20000 });
  const resumed = await normal.page.evaluate(() => [...window.schedulingEvents]);
  assert.equal(
    resumed.filter((name) => name === 'chapter3.cbz/01.png').length,
    1,
    'paused speculative page 1 must be reused, not decoded again',
  );
  assert.equal(resumed[2], 'chapter3.cbz/02.png', 'still-needed next resumes at page 2');
  assert.equal(
    await normal.fetchStatus(preempted.source),
    404,
    'unused backward candidate must release its token',
  );
  assert.equal(
    await normal.page.evaluate(() =>
      window.priorityKeptImages.every(
        (image, index) =>
          image ===
          document
            .querySelector('[data-reader-chapter][aria-label="chapter2.cbz"]')
            .querySelectorAll('img')[index],
      ),
    ),
    true,
  );
  observations.priority = { preempted, resumed };
  checks.push(
    'active page finishes, demanded history tail page preempts next immediately, and still-needed next resumes from cached page 2 with unchanged current images',
  );

  // Demand publication shows accepted visible tail pages before remaining offscreen
  // pages finish; replacement then cancels that mounted page's pending image safely.
  await normal.page.evaluate(() => {
    window.schedulingGates['chapter1.cbz/01.png'] = {};
  });
  const backward = await normal.page.evaluate((height) => {
    const view = document.querySelector('[data-reader-viewport]');
    view.scrollTop = height - 150;
    return view.scrollTop;
  }, old.height);
  await normal.page.waitForFunction(() => window.schedulingGates['chapter1.cbz/01.png'].hit, null, {
    timeout: 20000,
    polling: 50,
  });
  const demanded = await normal.snapshot(),
    history = demanded.chapters.find((chapter) => chapter.name === 'chapter1.cbz');
  assert.ok(history);
  assert.ok(history.pages[5].src, 'visible tail must be accepted before offscreen page 1 finishes');
  assert.equal(history.pages[0].src, undefined);
  near(demanded.top, backward, 'demand publication anchor');
  const pending = await normal.page.evaluate(
      () => window.schedulingGates['chapter1.cbz/01.png'].source,
    ),
    oldCatalog = demanded.catalog;
  await normal.open('single', 'only.cbz');
  await normal.chapter('only.cbz').waitFor({ state: 'attached', timeout: 20000 });
  await normal.ready();
  await normal.page.evaluate(() => {
    const gate = window.schedulingGates['chapter1.cbz/01.png'];
    Image.prototype.decode = window.schedulingOriginalDecode;
    gate.release();
  });
  await normal.tick();
  assert.deepEqual(
    (await normal.snapshot()).chapters.map((chapter) => chapter.name),
    ['only.cbz'],
  );
  assert.equal(await normal.fetchStatus(pending), 404);
  assert.equal(
    (
      await normal.page.evaluate(
        ({ catalog, entry }) =>
          window.shellHost.reader.chapter(
            catalog,
            entry,
            { renderWidth: 800, maxDecodeWidth: 4096, maxDecodedMB: 512 },
            'demand',
          ),
        { catalog: oldCatalog, entry: old.entry },
      )
    ).ok,
    false,
  );
  assert.deepEqual(normal.errors, []);
  assert.deepEqual(await normal.page.evaluate(() => window.shellDev.records()), []);
  checks.push(
    'demanded visible pages publish early in natural slots; replacement cancels pending image/work/catalog without stale append or status',
  );
  await app.close();
  app = null;
  for (const [file, hash] of hashes)
    assert.equal(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
      hash,
      'reader never rewrites source archives',
    );
  const result = {
    verdict: 'PASS',
    checks,
    observations,
    evidence,
    limits: [
      'Admission estimates, not measured process RSS or GPU VRAM',
      'No GPU decoder, full suite or FPS benchmark',
    ],
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ verdict: result.verdict, checks, evidence }, null, 2));
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
