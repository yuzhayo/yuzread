import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// FIXTURES — authorized continuation, current+next residency and anchors, not FPS.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime', `reader-chapters-${Date.now()}`);
await mkdir(evidence, { recursive: true });
const definitions = {
  main: {
    'chapter1.cbz': [[1600, 1400], ...Array(5).fill([800, 1200])],
    'chapter2.CBZ': [
      [1600, 1000],
      [800, 1100],
      [800, 900],
      [1100, 1200],
    ],
    'chapter10.cbz': Array(3).fill([1000, 1500]),
  },
  short: {
    'chapter1.cbz': [[100, 300]],
    'chapter2.cbz': [[100, 300]],
    'chapter10.cbz': [[100, 300]],
  },
  broken: { 'chapter1.cbz': Array(4).fill([800, 1200]) },
  single: { 'only.cbz': Array(3).fill([800, 1200]) },
};
for (const [folder, chapters] of Object.entries(definitions)) {
  for (const [name, pages] of Object.entries(chapters)) {
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
  }
}
await writeFile(path.join(evidence, 'broken', 'chapter2.cbz'), 'not a zip archive');
const archives = Object.entries(definitions).flatMap(([folder, entries]) =>
  Object.keys(entries).map((name) => path.join(evidence, folder, name)),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baseline = new Map(
  await Promise.all(archives.map(async (file) => [file, digest(await readFile(file))])),
);
const near = (actual, expected, label, tolerance = 1.4) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
const raw = JSON.parse(await readFile(path.join(root, 'screen/config.json'), 'utf8'));
const settings = raw.areas
  .find((area) => area.id === 'body')
  .children.find((child) => child.id === 'reader');
const options = {
  renderWidth: 600,
  maxDecodeWidth: settings.maxRenderWidth,
  maxDecodedMB: settings.maxDecodedMB,
};
const checks = [],
  scenarios = [];
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
    const cache = await app.evaluate(
      async ({ BrowserWindow, app, screen }, height) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
        window.focus();
        screen.getCursorScreenPoint = () => {
          const b = window.getContentBounds();
          return { x: b.x + b.width / 2, y: b.y + (b.height * height) / 200 };
        };
        return app.getPath('userData') + '/reader-cache';
      },
      raw.areas.find((area) => area.id === 'windowsBar').bounds.height,
    );
    const tick = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    const resize = async (w, h = 700) => {
      const size = await app.evaluate(
        ({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0];
          window.setSize(...size);
          return window.getContentSize();
        },
        [w, h],
      );
      await page.waitForFunction(
        ([w, h]) => Math.abs(innerWidth - w) <= 1 && Math.abs(innerHeight - h) <= 1,
        size,
        { timeout: 5000 },
      );
      await tick();
    };
    const select = async (file) =>
      app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
    const open = async (folder, name) => {
      await select(path.join(evidence, folder, name));
      await page.getByRole('button', { name: /Open.*CBZ/ }).click({ timeout: 5000 });
    };
    const chapter = (name) => page.locator(`[data-reader-chapter][aria-label="${name}"]`);
    const waitChapter = (name) => chapter(name).waitFor({ state: 'attached', timeout: 20000 });
    const snapshot = () =>
      page.evaluate(() => {
        const view = document.querySelector('[data-reader-viewport]'),
          strip = document.querySelector('[data-reader-pages]'),
          b = view.getBoundingClientRect();
        return {
          zoom: Number(strip.dataset.zoom),
          ratio: devicePixelRatio,
          top: view.scrollTop,
          left: view.scrollLeft,
          width: view.clientWidth,
          height: view.clientHeight,
          catalog: strip.dataset.readerCatalog,
          current: strip.dataset.currentChapter,
          next: strip.dataset.nextChapter,
          chapters: [...document.querySelectorAll('[data-reader-chapter]')].map((root) => {
            const b = root.getBoundingClientRect();
            return {
              entry: root.dataset.readerChapter,
              id: root.dataset.readerSession,
              name: root.getAttribute('aria-label'),
              top: b.top,
              left: b.left,
              width: b.width,
              height: b.height,
              pages: [...root.querySelectorAll('[data-reader-page]')].map((slot) => {
                const b = slot.getBoundingClientRect(),
                  image = slot.querySelector('img');
                return { width: b.width, height: b.height, src: image?.src };
              }),
            };
          }),
          viewTop: b.top,
          spacers: [...strip.querySelectorAll('[data-reader-spacer]')].map((element) => ({
            kind: element.dataset.readerSpacer,
            start: Number(element.dataset.readerStart),
            end: Number(element.dataset.readerEnd),
            height: element.getBoundingClientRect().height,
          })),
        };
      });
    const statusReady = () =>
      page.waitForFunction(
        () => {
          const status = document.querySelector('[data-reader-status]');
          return (
            status.dataset.prepared === status.dataset.total && Number(status.dataset.total) > 0
          );
        },
        null,
        { timeout: 20000, polling: 50 },
      );
    const fetchStatus = (url) =>
      app.evaluate(async ({ net }, url) => (await net.fetch(url)).status, url);
    const gate = async (alt) =>
      page.evaluate((alt) => {
        window.chapterOriginalDecode = Image.prototype.decode;
        window.chapterGateHit = false;
        window.chapterGateRelease = null;
        window.chapterGateSource = '';
        Image.prototype.decode = function () {
          const result = window.chapterOriginalDecode.call(this);
          if (this.alt !== alt) return result;
          window.chapterGateSource = this.src;
          return result.then(
            () =>
              new Promise((resolve) => {
                window.chapterGateHit = true;
                window.chapterGateRelease = resolve;
              }),
          );
        };
      }, alt);
    const unlock = () =>
      page.evaluate(() => {
        Image.prototype.decode = window.chapterOriginalDecode;
        window.chapterGateRelease?.();
      });

    if (scale === 1) {
      // Exercise the actual typed bridge without UI state to check frozen authorization.
      await select(path.join(evidence, 'main', 'chapter1.cbz'));
      const opened = await page.evaluate(
        (options) => window.shellHost.reader.open(options),
        options,
      );
      assert.equal(opened.ok, true);
      assert.ok('catalog' in opened);
      assert.deepEqual(
        opened.catalog.chapters.map((entry) => entry.name),
        ['chapter1.cbz', 'chapter2.CBZ', 'chapter10.cbz'],
      );
      assert.equal(Object.keys(opened.catalog.chapters[0]).sort().join(','), 'id,name');
      const added = path.join(evidence, 'main', 'chapter3.cbz');
      await writeFile(added, await readFile(path.join(evidence, 'main', 'chapter10.cbz')));
      for (const [catalogId, entryId, settings] of [
        [opened.catalog.id, '../../outside.cbz', options],
        ['unknown', opened.catalog.chapters[1].id, options],
        [opened.catalog.id, 'chapter3.cbz', options],
        [
          opened.catalog.id,
          opened.catalog.chapters[1].id,
          { ...options, maxDecodedMB: options.maxDecodedMB + 1 },
        ],
      ]) {
        assert.equal(
          (
            await page.evaluate(
              (args) => window.shellHost.reader.chapter(...args),
              [catalogId, entryId, settings],
            )
          ).ok,
          false,
        );
      }
      await unlink(added);
      const frozen = await page.evaluate(
        ({ catalog, options }) =>
          window.shellHost.reader.chapter(catalog.id, catalog.chapters[1].id, options),
        { catalog: opened.catalog, options },
      );
      assert.equal(frozen.ok, true);
      assert.equal(frozen.chapter.name, 'chapter2.CBZ');
      const sourceFile = path.join(evidence, 'main', 'chapter10.cbz');
      const sourceBytes = await readFile(sourceFile);
      await writeFile(sourceFile, Buffer.concat([sourceBytes, Buffer.from([0])]));
      const changed = await page.evaluate(
        ({ catalog, options }) =>
          window.shellHost.reader.chapter(catalog.id, catalog.chapters[2].id, options),
        { catalog: opened.catalog, options },
      );
      assert.equal(changed.ok, false);
      assert.match(changed.error, /source changed/);
      await writeFile(sourceFile, sourceBytes);
      await page.evaluate((id) => window.shellHost.reader.release(id), opened.catalog.id);
      assert.equal(
        (
          await page.evaluate(
            ({ catalog, options }) =>
              window.shellHost.reader.chapter(catalog.id, catalog.chapters[1].id, options),
            { catalog: opened.catalog, options },
          )
        ).ok,
        false,
      );
      assert.equal((await readdir(cache)).filter((name) => name.startsWith('reader-')).length, 0);
      await select(path.join(evidence, 'main', 'chapter1.cbz'));
      const fresh = await page.evaluate(
        (options) => window.shellHost.reader.open(options),
        options,
      );
      const cancelled = await page.evaluate(
        async ({ catalog, options }) => {
          const pending = window.shellHost.reader.chapter(
            catalog.id,
            catalog.chapters[2].id,
            options,
          );
          await window.shellHost.reader.release(catalog.id);
          return await pending;
        },
        { catalog: fresh.catalog, options },
      );
      assert.equal(
        cancelled.ok,
        false,
        'retired catalog cannot complete an in-flight chapter open',
      );
      assert.equal((await readdir(cache)).filter((name) => name.startsWith('reader-')).length, 0);
      checks.push(
        'natural frozen same-folder catalog, opaque IDs, rejected paths/settings/source changes and retirement during an in-flight open',
      );
    }

    await resize(900);
    await gate('chapter1.cbz/06.png');
    await open('main', 'chapter1.cbz');
    await page.waitForFunction(() => window.chapterGateHit, null, { timeout: 20000, polling: 50 });
    const early = await snapshot();
    assert.equal(early.chapters.length, 1);
    assert.equal(early.chapters[0].pages.length, 6);
    assert.ok(early.chapters[0].pages.filter((page) => page.src).length >= settings.initialPages);
    assert.equal(
      (await readdir(cache)).filter((name) => name.startsWith('reader-')).length,
      1,
      'next must wait for current completion',
    );
    await page.evaluate(() => {
      window.chapterKeptImages = [...document.querySelectorAll('[data-reader-page] img')];
    });
    await resize(1200);
    await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]'),
        b = view.getBoundingClientRect();
      for (let i = 0; i < 2; i++)
        view.dispatchEvent(
          new WheelEvent('wheel', {
            ctrlKey: true,
            deltaY: -100,
            clientX: b.left + view.clientWidth / 2,
            clientY: 300,
            cancelable: true,
          }),
        );
    });
    await tick();
    await page.evaluate(() => {
      document.querySelector('[data-reader-viewport]').scrollTop = 400;
    });
    await tick();
    const beforeAppend = await snapshot();
    await unlock();
    await waitChapter('chapter2.CBZ');
    await statusReady();
    await tick();
    const appended = await snapshot();
    assert.equal(appended.chapters.length, 2);
    near(appended.zoom, 1.2, 'retained explicit zoom', 0.001);
    near(appended.ratio, scale, 'DPI', 0.001);
    near(appended.chapters[0].top, beforeAppend.chapters[0].top, 'append vertical anchor');
    near(appended.chapters[0].left, beforeAppend.chapters[0].left, 'append horizontal anchor');
    assert.deepEqual(
      appended.chapters[0].pages.slice(0, 5),
      beforeAppend.chapters[0].pages.slice(0, 5),
    );
    assert.equal(
      await page.evaluate(() =>
        window.chapterKeptImages.every(
          (image, index) => image === document.querySelectorAll('[data-reader-page] img')[index],
        ),
      ),
      true,
    );
    await page.screenshot({ path: path.join(evidence, `pair-${scale}.png`) });
    const old = appended.chapters[0],
      next = appended.chapters[1];
    // Capture right after explicit scroll and before asynchronous crossing callbacks.
    const crossing = await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]'),
        roots = document.querySelectorAll('[data-reader-chapter]');
      view.scrollTop +=
        roots[0].getBoundingClientRect().bottom - view.getBoundingClientRect().top + 20;
      const b = roots[1].getBoundingClientRect();
      return { top: b.top, left: b.left, scrollTop: view.scrollTop };
    });
    await page.waitForFunction(
      (entry) => document.querySelector('[data-reader-pages]').dataset.currentChapter === entry,
      next.entry,
      { timeout: 10000, polling: 50 },
    );
    await chapter('chapter1.cbz').waitFor({ state: 'detached', timeout: 10000 });
    await waitChapter('chapter10.cbz');
    await tick();
    const promoted = await snapshot();
    assert.deepEqual(
      promoted.chapters.map((chapter) => chapter.name),
      ['chapter2.CBZ', 'chapter10.cbz'],
    );
    near(promoted.chapters[0].top, crossing.top, 'eviction vertical anchor');
    near(promoted.chapters[0].left, crossing.left, 'eviction horizontal anchor');
    near(promoted.top, crossing.scrollTop, 'unchanged scroll offset across spacer eviction');
    assert.deepEqual(promoted.chapters[0].pages, next.pages);
    assert.equal(await fetchStatus(old.pages[0].src), 404);
    await page.evaluate((id) => window.shellHost.reader.release(id), old.id);
    assert.equal((await readdir(cache)).filter((name) => name.startsWith('reader-')).length, 2);
    // Revisit the lightweight history; keep the still-visible current seam anchored.
    const backward = await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]'),
        first = document.querySelector('[data-reader-chapter]');
      view.scrollTop += first.getBoundingClientRect().top - view.getBoundingClientRect().top - 150;
      const b = first.getBoundingClientRect();
      return { top: b.top, left: b.left, scrollTop: view.scrollTop };
    });
    await waitChapter('chapter1.cbz');
    await tick();
    const restored = await snapshot();
    assert.equal(restored.chapters[0].name, 'chapter1.cbz');
    assert.notEqual(restored.chapters[0].id, old.id);
    assert.deepEqual(
      restored.chapters[0].pages.map(({ width, height }) => ({ width, height })),
      appended.chapters[0].pages.map(({ width, height }) => ({ width, height })),
    );
    const retainedNext = restored.chapters.find((chapter) => chapter.name === 'chapter2.CBZ');
    near(retainedNext.top, backward.top, 'backward restore vertical anchor');
    near(retainedNext.left, backward.left, 'backward restore horizontal anchor');
    assert.deepEqual(retainedNext.pages, next.pages);
    assert.equal(
      restored.chapters.length,
      2,
      'previous is demand-loaded, not a permanent third slot',
    );
    // Return forward, then continue into chapter 10 with one collapsed history spacer.
    await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]'),
        roots = document.querySelectorAll('[data-reader-chapter]');
      view.scrollTop +=
        roots[0].getBoundingClientRect().bottom - view.getBoundingClientRect().top + 20;
    });
    await waitChapter('chapter10.cbz');
    await page.evaluate(() => {
      const view = document.querySelector('[data-reader-viewport]'),
        target = document.querySelector('[data-reader-chapter][aria-label="chapter10.cbz"]');
      view.scrollTop += target.getBoundingClientRect().top - view.getBoundingClientRect().top + 20;
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-reader-chapter]').length === 1 &&
        document.querySelector('[data-reader-chapter]').getAttribute('aria-label') ===
          'chapter10.cbz',
      null,
      { timeout: 10000, polling: 50 },
    );
    const last = await snapshot();
    assert.equal(last.spacers.filter((spacer) => spacer.kind === 'history').length, 1);
    assert.equal(last.spacers.filter((spacer) => spacer.kind === 'next').length, 0);
    assert.equal(last.spacers.find((spacer) => spacer.kind === 'history').end, 1);
    scenarios.push({ scale, early, appended, promoted, restored, last });
    checks.push(
      `${scale} DPI: early pages, serial next publication, zoom/resize anchors, automatic 2-before-10 handoff, eviction and backward re-decode`,
    );

    if (scale === 1) {
      await gate('chapter2.CBZ/04.png');
      await open('main', 'chapter1.cbz');
      await page.waitForFunction(() => window.chapterGateHit, null, {
        timeout: 20000,
        polling: 50,
      });
      const beforeCancel = await snapshot(),
        cancelledSource = await page.evaluate(() => window.chapterGateSource);
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      });
      await page.getByRole('button', { name: /Open.*CBZ/ }).click();
      await unlock();
      await waitChapter('chapter2.CBZ');
      assert.equal((await snapshot()).catalog, beforeCancel.catalog);
      assert.equal((await snapshot()).chapters[0].id, beforeCancel.chapters[0].id);
      assert.equal(await fetchStatus(cancelledSource), 404);
      checks.push(
        'cancelled Open preserves current and resumes next work after discarding the older pending generation',
      );
      // Stop an already decoded next page inside its renderer acceptance gate.
      await gate('chapter2.CBZ/04.png');
      await open('main', 'chapter1.cbz');
      await page.waitForFunction(() => window.chapterGateHit, null, {
        timeout: 20000,
        polling: 50,
      });
      const pending = await snapshot(),
        pendingSource = await page.evaluate(() => window.chapterGateSource);
      await open('single', 'only.cbz');
      await waitChapter('only.cbz');
      await statusReady();
      const replacement = await snapshot();
      await unlock();
      await tick();
      assert.equal((await snapshot()).catalog, replacement.catalog);
      assert.deepEqual(
        (await snapshot()).chapters.map((chapter) => chapter.name),
        ['only.cbz'],
      );
      assert.equal(await fetchStatus(pendingSource), 404);
      assert.equal(
        (
          await page.evaluate(
            ({ catalog, entry, options }) =>
              window.shellHost.reader.chapter(catalog, entry, options),
            { catalog: pending.catalog, entry: pending.next, options },
          )
        ).ok,
        false,
      );
      checks.push(
        'Open during neighbor acceptance retires old authorization/tokens; stale work cannot append or change the replacement',
      );
      await page.locator('[data-reader-viewport]').focus();
      await page.keyboard.press('Control+0');
      await tick();
      await resize(900, 700);
      await open('short', 'chapter1.cbz');
      await page.waitForFunction(
        () => document.querySelectorAll('[data-reader-chapter]').length === 3,
        null,
        { timeout: 20000, polling: 50 },
      );
      const short = await snapshot();
      assert.equal(
        short.chapters.length,
        3,
        'three visible short chapters cannot be forced into two',
      );
      assert.ok(short.chapters.every((chapter) => chapter.pages[0].src));
      assert.equal(await fetchStatus(short.chapters[0].pages[0].src), 200);
      await resize(900, 500);
      await page.evaluate(() => {
        document.querySelector('[data-reader-viewport]').scrollTop = 310;
      });
      await chapter('chapter1.cbz').waitFor({ state: 'detached', timeout: 10000 });
      assert.equal(await fetchStatus(short.chapters[0].pages[0].src), 404);
      checks.push(
        'short visible chapters remain readable during handoff; old pixels release only after leaving the viewport',
      );
      await resize(900, 700);
      await open('broken', 'chapter1.cbz');
      await waitChapter('chapter1.cbz');
      await statusReady();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-reader-overlay]').dataset.visible === 'true' &&
          document.querySelector('[data-reader-status]').textContent.includes('chapter2.cbz'),
        null,
        { timeout: 20000, polling: 50 },
      );
      const broken = await snapshot();
      assert.equal(broken.chapters.length, 1);
      assert.equal(await fetchStatus(broken.chapters[0].pages[0].src), 200);
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      });
      await page.getByRole('button', { name: /Open.*CBZ/ }).click();
      await tick();
      assert.equal((await snapshot()).catalog, broken.catalog);
      checks.push(
        'corrupt next produces non-layout-blocking status; readable current and picker cancellation survive',
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.shellDev.records()), []);
    await app.close();
    app = null;
  }
  for (const [file, hash] of baseline)
    assert.equal(digest(await readFile(file)), hash, 'source CBZ files remain untouched');
  const result = {
    verdict: 'PASS',
    checks,
    scenarios,
    evidence,
    limits: [
      'No aggregate resident memory/process-RSS proof (phase 5)',
      'No FPS/presented-frame benchmark or full suite',
    ],
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ verdict: result.verdict, checks, evidence }, null, 2));
} catch (error) {
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({ verdict: 'FAIL', error: error.stack, checks, scenarios, evidence }, null, 2),
  );
  throw error;
} finally {
  if (app) await app.close();
}
