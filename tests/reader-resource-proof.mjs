import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// A fixed 8-second app-scoped workload, not a full suite or presented-FPS certification.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const labelIndex = process.argv.indexOf('--label');
const label = labelIndex >= 0 ? process.argv[labelIndex + 1] : 'sample';
const speedIndex = process.argv.indexOf('--speed');
const testSpeed = speedIndex >= 0 ? Number(process.argv[speedIndex + 1]) : 1;
const reverse = process.argv.includes('--reverse');
const checkFailure = process.argv.includes('--failure');
const archiveIndex = process.argv.indexOf('--archive');
const archive = archiveIndex >= 0 ? path.resolve(process.argv[archiveIndex + 1]) : null;
const warmReplay = process.argv.includes('--warm-replay');
const verifyReuse = process.argv.includes('--verify-reuse');
const screenConfig = JSON.parse(await readFile(path.join(root, 'screen', 'config.json'), 'utf8'));
const ceiling =
  screenConfig.areas
    .find((area) => area.id === 'body')
    .children.find((child) => child.id === 'reader').maxFPS ?? 0;
const evidence = path.join(root, '.runtime', `reader-resource-${label}-${Date.now()}`);
await mkdir(evidence, { recursive: true });
if (archive) assert.ok((await stat(archive)).isFile(), 'the caller-selected archive must exist');
else {
  await mkdir(path.join(evidence, 'pages'), { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="4800"><defs><pattern id="p" width="64" height="64" patternUnits="userSpaceOnUse"><rect width="64" height="64" fill="#314b68"/><path d="M0 0H32V32H0Z M32 32H64V64H32Z" fill="#d28a58"/></pattern></defs><rect width="1600" height="4800" fill="url(#p)"/></svg>';
  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(evidence, 'pages', 'page.png'));
  await promisify(execFile)('python', [
    '-c',
    'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); [(lambda z: ([z.write(p/"pages"/"page.png","%03d.png"%n) for n in range(12)],z.close()))(zipfile.ZipFile(p/("chapter%d.cbz"%i),"w",zipfile.ZIP_DEFLATED)) for i in (1,2)]',
    evidence,
  ]);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root, '--qa', '--force-device-scale-factor=1'],
    cwd: root,
    env,
    timeout: 15000,
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-reader]');
  await app.evaluate(
    async ({ BrowserWindow, dialog, screen }, archive) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.webContents.isLoading())
        await new Promise((r) => win.webContents.once('did-finish-load', r));
      if (!win.isVisible()) await new Promise((r) => win.once('show', r));
      win.setSize(1320, 1320);
      win.focus();
      screen.getCursorScreenPoint = () => {
        const b = win.getContentBounds();
        return { x: b.x + b.width * 0.875, y: b.y + 15 };
      };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] });
    },
    archive ?? path.join(evidence, 'chapter1.cbz'),
  );
  await page.waitForFunction(() => innerWidth === 1320 && innerHeight === 1320);
  await page.getByRole('button', { name: /Open.*CBZ/ }).click();
  await page.waitForFunction(
    (real) => {
      if (!real)
        return Number(document.querySelector('[data-reader-pixi]').dataset.pixiPages) >= 24;
      const chapter = document.querySelector('[data-reader-chapter]');
      return (
        document.querySelector('[data-reader-pixi]').dataset.readerPixi === 'ready' &&
        chapter &&
        chapter.querySelectorAll('[data-reader-page]').length > 0 &&
        chapter.querySelectorAll('img').length ===
          chapter.querySelectorAll('[data-reader-page]').length
      );
    },
    !!archive,
    { timeout: 60000 },
  );
  const worker = page.workers()[0];
  assert.ok(worker, 'render worker must be present');
  if (testSpeed !== 1) {
    await page.getByRole('button', { name: 'Scroll speed', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Speed value' }).fill(String(testSpeed * 10));
    await page.keyboard.press('Enter');
    await page.mouse.click(30, 300);
    await page.waitForFunction(
      (speed) =>
        Number(document.querySelector('[data-reader-viewport]').dataset.workerSpeed) === speed,
      testSpeed,
    );
  }
  await worker.evaluate(() => {
    globalThis.resourceCounters = {
      draws: 0,
      indices: 0,
      clears: 0,
      drawTimes: [],
      renderSlots: 0,
      lastSlot: -1,
      slot: null,
      textureCreates: 0,
      textureDeletes: 0,
      allocationUploads: 0,
      subUploads: 0,
      uploadedBytes: 0,
      uploadCpuMs: 0,
      clearedPixels: 0,
    };
    for (const name of ['createTexture', 'deleteTexture', 'texImage2D', 'texSubImage2D']) {
      const original = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        const c = globalThis.resourceCounters;
        if (name === 'createTexture') c.textureCreates++;
        else if (name === 'deleteTexture') c.textureDeletes++;
        else {
          if (name === 'texImage2D') c.allocationUploads++;
          else c.subUploads++;
          const image = args.at(-1);
          if (image instanceof ImageBitmap) c.uploadedBytes += image.width * image.height * 4;
        }
        const start = performance.now();
        const value = original.apply(this, args);
        if (name.startsWith('tex')) c.uploadCpuMs += performance.now() - start;
        return value;
      };
    }
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback) =>
      raf((time) => {
        globalThis.resourceCounters.slot = time;
        callback(time);
        globalThis.resourceCounters.slot = null;
      });
    for (const name of ['drawElements', 'drawElementsInstanced']) {
      const original = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        const c = globalThis.resourceCounters;
        c.draws++;
        c.indices += args[1] * (name === 'drawElementsInstanced' ? args[4] : 1);
        return original.apply(this, args);
      };
    }
    const clear = WebGL2RenderingContext.prototype.clear;
    WebGL2RenderingContext.prototype.clear = function (...args) {
      const c = globalThis.resourceCounters;
      c.clears++;
      c.clearedPixels += this.drawingBufferWidth * this.drawingBufferHeight;
      c.drawTimes.push(performance.now());
      if (c.slot !== null && c.slot !== c.lastSlot) {
        c.renderSlots++;
        c.lastSlot = c.slot;
      }
      return clear.apply(this, args);
    };
  });
  const snapshot = () =>
    app.evaluate(({ app }) =>
      app.getAppMetrics().map((p) => ({
        pid: p.pid,
        type: p.type,
        workingSetMB: p.memory.workingSetSize / 1024,
        privateMB: (p.memory.privateBytes ?? 0) / 1024,
        cpuPercent: p.cpu.percentCPUUsage,
        cpuSeconds: p.cpu.cumulativeCPUUsage,
      })),
    );
  const beforeMemory = await snapshot();
  const gpuPids = beforeMemory.filter((p) => p.type === 'GPU').map((p) => p.pid);
  assert.ok(gpuPids.length);
  await page
    .locator('[data-reader-viewport]')
    .screenshot({ path: path.join(evidence, 'before.png') });
  const resetCounters = () =>
    worker.evaluate(() => {
      const c = globalThis.resourceCounters;
      c.draws = c.indices = c.clears = c.renderSlots = 0;
      c.lastSlot = -1;
      c.drawTimes = [];
      c.clearedPixels = 0;
      c.textureCreates =
        c.textureDeletes =
        c.allocationUploads =
        c.subUploads =
        c.uploadedBytes =
        c.uploadCpuMs =
          0;
    });
  await resetCounters();
  const script = `$pattern='pid_(?:${gpuPids.join('|')})_';$memoryPattern='pid_(?:${beforeMemory.map((p) => p.pid).join('|')})_';$result=@(Get-Counter -Counter '\\GPU Engine(*)\\Utilization Percentage','\\GPU Process Memory(*)\\Dedicated Usage','\\GPU Process Memory(*)\\Shared Usage' -SampleInterval 1 -MaxSamples 8 | ForEach-Object {$values=@($_.CounterSamples | Where-Object {$_.InstanceName -match $pattern -and $_.Path -like '*utilization percentage'} | ForEach-Object {[pscustomobject]@{engine=$_.InstanceName;percent=$_.CookedValue}});$memory=@($_.CounterSamples | Where-Object {$_.InstanceName -match $memoryPattern -and $_.Path -notlike '*utilization percentage'} | ForEach-Object {[pscustomobject]@{counter=$_.Path;bytes=$_.CookedValue}});$nv=(& 'C:\\Windows\\System32\\nvidia-smi.exe' '--query-gpu=clocks.current.graphics,clocks.current.memory,power.draw,pstate' '--format=csv,noheader,nounits' 2>$null);[pscustomobject]@{time=$_.Timestamp.ToString('o');engines=$values;memory=$memory;nvidia=$nv}});$result|ConvertTo-Json -Depth 5 -Compress`;
  const collectGpu = () =>
    promisify(execFile)('pwsh.exe', ['-NoProfile', '-Command', script], {
      timeout: 15000,
      maxBuffer: 4 * 1048576,
    });
  const drive = () =>
    page.evaluate(async (reverse) => {
      const view = document.querySelector('[data-reader-viewport]'),
        start = performance.now();
      while (performance.now() - start < 8000) {
        view.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: reverse && performance.now() - start > 4000 ? -120 : 120,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
            clientX: 660,
            clientY: 660,
          }),
        );
        await new Promise((r) => setTimeout(r, 100));
      }
      return performance.now() - start;
    }, reverse);
  const counters = collectGpu();
  const duration = await drive();
  const render = await worker.evaluate(() => globalThis.resourceCounters);
  const workloadMemory = await snapshot();
  const gpu = JSON.parse((await counters).stdout);
  const afterMemory = await snapshot();
  const tiles = await page.evaluate(() => ({
    residentTiles: Number(
      document.querySelector('[data-reader-pixi]').dataset.pixiResidentTiles ?? 0,
    ),
    residentBytes: Number(
      document.querySelector('[data-reader-pixi]').dataset.pixiResidentBytes ?? 0,
    ),
    blockedFrames: Number(
      document.querySelector('[data-reader-pixi]').dataset.pixiBlockedFrames ?? 0,
    ),
    skippedTiles: Number(
      document.querySelector('[data-reader-pixi]').dataset.pixiSkippedTiles ?? 0,
    ),
    skippedDecodeBytes: Number(
      document.querySelector('[data-reader-pixi]').dataset.pixiSkippedDecodeBytes ?? 0,
    ),
    skippedUploadBytes: Number(
      document.querySelector('[data-reader-pixi]').dataset.pixiSkippedUploadBytes ?? 0,
    ),
  }));
  const settled = await page
    .waitForFunction(
      () => document.querySelector('[data-reader-viewport]').dataset.readerMoving === 'false',
      null,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  const idleBefore = await worker.evaluate(() => globalThis.resourceCounters.clears);
  await page.waitForTimeout(250);
  const idleAfter = await worker.evaluate(() => globalThis.resourceCounters.clears);
  const top = await page.evaluate(() => document.querySelector('[data-reader-viewport]').scrollTop);
  const perSample = gpu.map((sample) => Math.max(0, ...sample.engines.map((e) => e.percent)));
  const drawHz = (render.renderSlots * 1000) / duration;
  if (verifyReuse)
    assert.ok(
      render.subUploads >= 10,
      'pool-pressure replacements must reuse GPU storage, not allocate every tile again',
    );
  if (ceiling > 0)
    assert.ok(drawHz <= ceiling + 1, 'drawing must obey the configured update ceiling');
  assert.ok(
    tiles.residentTiles > 0 && tiles.residentBytes > 0 && tiles.residentBytes <= 128 * 1048576,
    'this fixture must fit the bounded tile pool',
  );
  assert.equal(settled, true);
  assert.equal(idleAfter - idleBefore, 0);
  if (!archive)
    assert.equal(
      tiles.blockedFrames,
      0,
      'the fixed scrolling fixture must not wait for visible tiles',
    );
  let failureRecovery = 'not requested';
  if (checkFailure) {
    await worker.evaluate(() => {
      globalThis.savedResourceFetch = globalThis.fetch;
      globalThis.fetch = (...args) =>
        String(args[0]).includes('://tile/')
          ? Promise.resolve(new Response('Fixture tile failure', { status: 404 }))
          : globalThis.savedResourceFetch(...args);
    });
    await page.evaluate(() => {
      const v = document.querySelector('[data-reader-viewport]');
      v.scrollTop = v.scrollHeight - v.clientHeight;
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-reader-status]')
          .textContent.includes('Cached tile is unavailable'),
      null,
      { timeout: 5000 },
    );
    assert.equal(await canvasState(page), 'ready', 'a tile failure must not close the GPU surface');
    const paused = await worker.evaluate(() => globalThis.resourceCounters.clears);
    await page.waitForTimeout(150);
    assert.equal(
      await worker.evaluate(() => globalThis.resourceCounters.clears),
      paused,
      'failed visible loading must retain the last complete framebuffer, without an idle draw loop',
    );
    await worker.evaluate(() => {
      globalThis.fetch = globalThis.savedResourceFetch;
      delete globalThis.savedResourceFetch;
    });
    const oldRevision = await page.locator('[data-reader-pixi]').getAttribute('data-pixi-revision');
    await page.mouse.move(660, 660);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(
      (revision) =>
        Number(document.querySelector('[data-reader-pixi]').dataset.pixiRevision) >
          Number(revision) &&
        !document
          .querySelector('[data-reader-status]')
          .textContent.includes('Cached tile is unavailable'),
      oldRevision,
      { timeout: 5000 },
    );
    failureRecovery = 'PASS: complete framebuffer retained; explicit input retries and recovers';
  }
  const dedicated = gpu.map(
    (sample) =>
      (sample.memory ?? [])
        .filter((m) => m.counter.endsWith('dedicated usage'))
        .reduce((sum, m) => sum + m.bytes, 0) / 1048576,
  );
  const result = {
    verdict: 'PASS',
    label,
    evidence,
    durationMs: duration,
    testSpeed,
    reverse,
    draws: render.draws,
    uploads: {
      textureCreates: render.textureCreates,
      textureDeletes: render.textureDeletes,
      allocations: render.allocationUploads,
      subUploads: render.subUploads,
      uploadedMB: render.uploadedBytes / 1048576,
      cpuSubmissionMs: render.uploadCpuMs,
    },
    submittedIndices: render.indices,
    clearCalls: render.clears,
    drawFrames: render.renderSlots,
    drawHz: (render.renderSlots * 1000) / duration,
    clearedPixelsPerSecond: (render.clearedPixels * 1000) / duration,
    canvas: await page.evaluate(() => {
      const c = document.querySelector('[data-reader-pixi]'),
        v = document.querySelector('[data-reader-viewport]');
      return {
        width: c.width,
        height: c.height,
        viewportWidth: v.clientWidth,
        viewportHeight: v.clientHeight,
      };
    }),
    gpuBusiestEngineAverage: perSample.reduce((a, b) => a + b, 0) / perSample.length,
    gpuBusiestEnginePeak: Math.max(...perSample),
    gpuSamples: gpu,
    beforeMemory,
    afterMemory,
    workloadMemory,
    gpuDedicatedMB: {
      average: dedicated.reduce((sum, n) => sum + n, 0) / dedicated.length,
      peak: Math.max(...dedicated),
    },
    failureRecovery,
    tiles,
    settled,
    idleDraws: idleAfter - idleBefore,
    scrollTop: top,
    coverage: {
      frameCeiling: ceiling === 0 ? 'disabled' : ceiling,
      archive: archive ? path.basename(archive) : 'generated long-page fixture',
      display: '165 Hz system, forced DPR 1',
      window: '1320x1320',
      presentedFPS: 'not measured',
      memory: 'process metrics; shared working sets can overlap',
    },
  };
  if (warmReplay) {
    const revision = await page.locator('[data-reader-pixi]').getAttribute('data-pixi-revision');
    await page.evaluate(() => {
      document.querySelector('[data-reader-viewport]').scrollTop = 0;
    });
    await page.waitForFunction(
      (revision) =>
        Number(document.querySelector('[data-reader-pixi]').dataset.pixiRevision) >
        Number(revision),
      revision,
      { timeout: 5000 },
    );
    await page.waitForTimeout(250);
    const warmBefore = await snapshot();
    await resetCounters();
    const gpuTask = collectGpu();
    const elapsed = await drive();
    const draws = await worker.evaluate(() => globalThis.resourceCounters);
    const warmMemory = await snapshot();
    const samples = JSON.parse((await gpuTask).stdout);
    const loads = samples.map((sample) =>
      Math.max(0, ...sample.engines.map((engine) => engine.percent)),
    );
    result.warmReplay = {
      durationMs: elapsed,
      drawHz: (draws.renderSlots * 1000) / elapsed,
      uploads: {
        textureCreates: draws.textureCreates,
        textureDeletes: draws.textureDeletes,
        allocations: draws.allocationUploads,
        subUploads: draws.subUploads,
        uploadedMB: draws.uploadedBytes / 1048576,
        cpuSubmissionMs: draws.uploadCpuMs,
      },
      gpuAverage: loads.reduce((sum, n) => sum + n, 0) / loads.length,
      gpuPeak: Math.max(...loads),
      memory: warmMemory,
      beforeMemory: warmBefore,
      gpuSamples: samples,
      scrollTop: await page.evaluate(
        () => document.querySelector('[data-reader-viewport]').scrollTop,
      ),
      blockedFrames: Number(
        await page.locator('[data-reader-pixi]').getAttribute('data-pixi-blocked-frames'),
      ),
    };
    if (ceiling > 0) assert.ok(result.warmReplay.drawHz <= ceiling + 1);
  }
  if (verifyReuse) {
    const revision = await page.locator('[data-reader-pixi]').getAttribute('data-pixi-revision');
    const moved = await page.evaluate(() => {
      const v = document.querySelector('[data-reader-viewport]');
      v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      const moved = v.scrollTop > 0.5;
      v.scrollTop = 0;
      return moved;
    });
    if (moved)
      await page.waitForFunction(
        (revision) =>
          Number(document.querySelector('[data-reader-pixi]').dataset.pixiRevision) >
          Number(revision),
        revision,
        { timeout: 5000 },
      );
    const bitmap = await page
      .locator('[data-reader-viewport]')
      .screenshot({ path: path.join(evidence, 'reused-first-page.png') });
    // Exclude UI overlays, but cross both the 1024-pixel horizontal and vertical seams.
    const crop = { left: 40, top: 90, width: 1240, height: 1120 };
    const expected = await sharp(path.join(evidence, 'before.png'))
      .extract(crop)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const actual = await sharp(bitmap).extract(crop).ensureAlpha().raw().toBuffer();
    assert.ok(
      actual.equals(expected),
      'returning through reused slots must show the original page pixels, not a former tile occupant',
    );
    result.reusedPixelParity = true;
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        label,
        evidence,
        drawHz: result.drawHz,
        clearedPixelsPerSecond: result.clearedPixelsPerSecond,
        canvas: result.canvas,
        uploads: result.uploads,
        submittedIndices: result.submittedIndices,
        gpuAverage: result.gpuBusiestEngineAverage,
        gpuPeak: result.gpuBusiestEnginePeak,
        idleDraws: result.idleDraws,
        memory: afterMemory,
        tiles,
        gpuDedicatedMB: result.gpuDedicatedMB,
        failureRecovery,
        reusedPixelParity: result.reusedPixelParity,
        nvidia: gpu.map((sample) => sample.nvidia),
        warmReplay: result.warmReplay
          ? {
              drawHz: result.warmReplay.drawHz,
              uploads: result.warmReplay.uploads,
              gpuAverage: result.warmReplay.gpuAverage,
              gpuPeak: result.warmReplay.gpuPeak,
              blockedFrames: result.warmReplay.blockedFrames,
            }
          : undefined,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await writeFile(
      path.join(evidence, 'state.json'),
      JSON.stringify(
        await page.evaluate(() => ({
          status: document.querySelector('[data-reader-status]')?.textContent,
          error: document.querySelector('[data-reader-viewport]')?.dataset.pixiError,
          pages: document.querySelector('[data-reader-pixi]')?.dataset,
          records: window.shellDev?.records?.(),
        })),
        null,
        2,
      ),
    );
  }
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({ verdict: 'FAIL', error: error.stack, evidence }, null, 2),
  );
  throw error;
} finally {
  if (app) await app.close();
}

async function canvasState(page) {
  return page.locator('[data-reader-pixi]').getAttribute('data-reader-pixi');
}
