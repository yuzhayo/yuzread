import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// CONFIG AND CONTRACT — Explorer-equivalent argv proof for cold/running portable Reader.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const portable = path.join(root, 'portable', 'Yuzread');
const stamp = Date.now();
const profile = `cbz-native-${stamp}`;
const evidence = path.join(root, '.runtime', profile);
const tempRoot = path.join(root, '.agents-temp');
const fixture = path.join(tempRoot, profile);
await mkdir(evidence, { recursive: true });
await mkdir(fixture, { recursive: true });
const env = { ...process.env, TEMP: fixture, TMP: fixture };
delete env.ELECTRON_RUN_AS_NODE;
let application;
const errors = [];

const makeArchive = async (name, color) => {
  const folder = path.join(fixture, name);
  await mkdir(folder, { recursive: true });
  for (let index = 1; index <= 2; index++)
    await sharp({ create: { width: 320, height: 480, channels: 4, background: color } })
      .png()
      .toFile(path.join(folder, `${index}.png`));
  const archive = path.join(fixture, `${name}.cbz`);
  const zipped = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop'; Compress-Archive -Path (Join-Path $env:YUZREAD_SOURCE '*') -DestinationPath $env:YUZREAD_ZIP -CompressionLevel Optimal",
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...env, YUZREAD_SOURCE: folder, YUZREAD_ZIP: archive },
    },
  );
  if (zipped.error) throw zipped.error;
  if (zipped.status !== 0) throw new Error(`Fixture archive failed: ${zipped.stderr}`);
  return archive;
};
const waitForChapter = async (page, name) => {
  try {
    await page.waitForFunction(
      (expected) => {
        const status = document.querySelector('[data-reader-status]');
        return status?.getAttribute('data-total') === '2' && status.textContent?.includes(expected);
      },
      name,
      { timeout: 20000 },
    );
  } catch (error) {
    const state = await page.evaluate(async () => ({
      status: document.querySelector('[data-reader-status]')?.textContent,
      total: document.querySelector('[data-reader-status]')?.getAttribute('data-total'),
      pixi: { ...document.querySelector('[data-reader-pixi]')?.dataset },
      viewport: { ...document.querySelector('[data-reader-viewport]')?.dataset },
      bootstrap: await window.shellHost.bootstrap(),
      records: window.shellDev?.records(),
    }));
    throw new Error(`${error.message}; Reader state: ${JSON.stringify(state)}`);
  }
  const status = page.locator('[data-reader-status]');
  assert.equal(await status.getAttribute('data-total'), '2');
  assert.ok(Number(await status.getAttribute('data-prepared')) >= 1);
};

try {
  const first = await makeArchive('cold start', '#c02f43');
  const second = await makeArchive('already running', '#2456a6');
  application = await _electron.launch({
    executablePath: path.join(portable, 'yuzread-reader.exe'),
    args: [first, '--qa', '--qa-lock', `--qa-profile=${profile}-cold`],
    cwd: portable,
    env,
    timeout: 15000,
  });
  let page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await waitForChapter(page, path.basename(first));
  assert.equal(await page.locator('[data-reader-pixi]').count(), 1);
  await page.screenshot({ path: path.join(evidence, 'cold-start.png') });
  await application.close();
  application = undefined;

  application = await _electron.launch({
    executablePath: path.join(portable, 'yuzread-reader.exe'),
    args: ['--qa', '--qa-lock', `--qa-profile=${profile}-running`],
    cwd: portable,
    env,
    timeout: 15000,
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() =>
    document.querySelector('[data-reader-status]')?.textContent?.includes('Choose a CBZ'),
  );
  const secondary = spawn(
    path.join(portable, 'yuzread-reader.exe'),
    [second, '--qa', '--qa-lock', `--qa-profile=${profile}-running`],
    { cwd: portable, env, stdio: 'ignore' },
  );
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Second Reader instance did not exit')),
      10000,
    );
    secondary.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    secondary.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0);
  await waitForChapter(page, path.basename(second));
  const mainCount = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$items=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'yuzread-reader.exe' -and $_.CommandLine -and $_.CommandLine.Contains($env:YUZREAD_PROFILE) -and $_.CommandLine -notmatch '--type=' }); $items.Count",
    ],
    { encoding: 'utf8', windowsHide: true, env: { ...env, YUZREAD_PROFILE: `${profile}-running` } },
  );
  assert.equal(Number(mainCount.stdout.trim()), 1);
  await page.screenshot({ path: path.join(evidence, 'already-running.png') });
  assert.deepEqual(errors, []);
  const result = {
    verdict: 'PASS',
    checks: [
      'cold Explorer-style CBZ argv opens through existing Reader workflow',
      'second-instance CBZ reaches the existing Reader window',
      'one Reader main process remains for the shared portable profile',
      'two real PNG pages render through the packaged Pixi Reader',
    ],
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(
    path.join(evidence, 'failure.json'),
    `${JSON.stringify({ verdict: 'FAIL', error: String(error), stack: error.stack }, null, 2)}\n`,
  );
  throw error;
} finally {
  if (application) await application.close();
  for (const suffix of ['cold', 'running'])
    await rm(path.join(portable, '.qa', `${profile}-${suffix}`), { recursive: true, force: true });
  const qa = path.join(portable, '.qa');
  if (fs.existsSync(qa) && (await readdir(qa)).length === 0) await rmdir(qa);
  await rm(fixture, { recursive: true, force: true });
  if ((await readdir(tempRoot)).length === 0) await rmdir(tempRoot);
}
