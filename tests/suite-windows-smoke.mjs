import assert from 'node:assert/strict';
import { mkdir, readFile, rm, rmdir, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

// CONFIG AND CONTRACT — one focused three-window proof; no downloads, catalog scan or full suite.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const stamp = Date.now();
const profileName = `suite-windows-${stamp}`;
const evidence = path.join(root, '.runtime', profileName);
const tempRoot = path.join(root, '.agents-temp');
const scratch = path.join(tempRoot, profileName);
await mkdir(evidence, { recursive: true });
await mkdir(scratch, { recursive: true });
const env = { ...process.env, TEMP: scratch, TMP: scratch };
delete env.ELECTRON_RUN_AS_NODE;
const roles = ['reader', 'library', 'downloader'];
const suiteVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const running = new Map();
const records = [];
const errors = [];
const hoverCaption = async (application, page, role, inside) => {
  await application.evaluate(({ BrowserWindow, screen }, hovered) => {
    const window = BrowserWindow.getAllWindows()[0];
    screen.getCursorScreenPoint = () => {
      const bounds = window.getContentBounds();
      return {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height * (hovered ? 0.02 : 0.5),
      };
    };
  }, inside);
  await page.waitForFunction(
    ({ id, expected }) => window.shellDev.snapshot().hoveredSections.includes(id) === expected,
    { id: `${role}WindowsBar`, expected: inside },
  );
};

try {
  for (const role of roles) {
    const executablePath = path.join(root, `.runtime/suite-runtime/yuzread-${role}.exe`);
    const application = await _electron.launch({
      executablePath,
      args: [root, '--qa', '--qa-lock', `--qa-profile=${profileName}`],
      cwd: root,
      env,
      timeout: 15000,
    });
    running.set(role, application);
    const page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push(`${role}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${role}: ${message.text()}`);
    });
    await page.waitForFunction(() => Boolean(window.shellDev));
    const record = await application.evaluate(async ({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
      return {
        pid: process.pid,
        name: app.getName(),
        version: app.getVersion(),
        executable: process.execPath,
        userData: app.getPath('userData'),
        windowCount: BrowserWindow.getAllWindows().length,
        title: window.getTitle(),
        bounds: window.getBounds(),
        background: window.getBackgroundColor(),
        sandbox: window.webContents.getLastWebPreferences().sandbox,
        isolated: window.webContents.getLastWebPreferences().contextIsolation,
        node: window.webContents.getLastWebPreferences().nodeIntegration,
      };
    });
    const bootstrap = await page.evaluate(() => window.shellHost.bootstrap());
    const catalog = await page.evaluate(() => window.shellDev.catalog);
    assert.equal(record.name, `yuzread-${role}`);
    assert.equal(record.title, record.name);
    assert.equal(path.basename(record.executable), `${record.name}.exe`);
    assert.equal(record.windowCount, 1);
    assert.equal(record.version, suiteVersion);
    assert.equal(record.sandbox, true);
    assert.equal(record.isolated, true);
    assert.equal(record.node, false);
    assert.equal(bootstrap.application.suiteName, 'Yuzread');
    assert.equal(bootstrap.application.processName, record.name);
    assert.equal(bootstrap.config.window.icon, `electron/assets/${record.name}.ico`);
    assert.ok(catalog.every(({ folder }) => folder.startsWith(`${role}/`)));
    assert.deepEqual(await page.evaluate(() => window.shellDev.records()), []);
    if (role === 'reader') {
      assert.equal(await page.locator('[data-reader]').count(), 1);
      assert.equal(bootstrap.config.areas.find(({ id }) => id === 'body').children[0].maxFPS, 0);
    } else {
      const background = role === 'library' ? '#240f18' : '#0b1730';
      const cssBackground = role === 'library' ? 'rgb(36, 15, 24)' : 'rgb(11, 23, 48)';
      assert.equal(record.background.toLowerCase(), background);
      assert.equal(bootstrap.config.window.background, background);
      assert.equal(await page.locator('[data-reader]').count(), 0);
      const unavailable = await page.evaluate(() =>
        window.shellHost.reader.open({ renderWidth: 800, maxDecodeWidth: 1600, maxDecodedMB: 64 }),
      );
      assert.equal(unavailable.ok, false);
      assert.match(unavailable.error, /unavailable in this application/);
      const drag = await page
        .locator('.shell-drag')
        .evaluate((element) => getComputedStyle(element).getPropertyValue('app-region'));
      assert.equal(drag, 'drag');
      const workspace = page.locator(`#${role}Body`);
      assert.equal(
        await workspace.evaluate((element) => getComputedStyle(element).backgroundColor),
        cssBackground,
      );
      assert.equal(await page.locator(`[data-component="${role}.title"]`).count(), 0);
      await hoverCaption(application, page, role, false);
      const idleBounds = await workspace.boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.deepEqual(idleBounds, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      assert.equal(
        await page.getByRole('button', { name: 'Close window', exact: true }).count(),
        0,
      );
      assert.equal(
        await page
          .getByRole('button', { name: 'Close window', exact: true, includeHidden: true })
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator(`#${role}WindowsBar`)
          .evaluate((element) => getComputedStyle(element).backgroundColor),
        'rgba(0, 0, 0, 0)',
      );
      await page.screenshot({ path: path.join(evidence, `${role}.png`) });
      await hoverCaption(application, page, role, true);
      assert.equal(
        await page.getByRole('button', { name: 'Close window', exact: true }).count(),
        1,
      );
      assert.deepEqual(
        await workspace.boundingBox(),
        idleBounds,
        'hover must not reserve a title-bar gutter',
      );
      await page.screenshot({ path: path.join(evidence, `${role}-hover.png`) });
      await hoverCaption(application, page, role, false);
      assert.equal(
        await page.getByRole('button', { name: 'Close window', exact: true }).count(),
        0,
      );
      await hoverCaption(application, page, role, true);
      await page.getByRole('button', { name: 'Minimize window', exact: true }).click();
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isMinimized(),
        ),
        true,
      );
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 600),
      );
      await page.getByRole('button', { name: 'Restore default window size', exact: true }).click();
      const restored = await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBounds(),
      );
      assert.equal(restored.width, record.bounds.width);
      assert.equal(restored.height, record.bounds.height);
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(720, 500),
      );
      await page.waitForFunction(() => innerWidth <= 720);
      const closeBounds = await page
        .getByRole('button', { name: 'Close window', exact: true })
        .boundingBox();
      assert.ok(closeBounds && closeBounds.width > 20 && closeBounds.x + closeBounds.width <= 720);
      await page.screenshot({ path: path.join(evidence, `${role}-minimum.png`) });
      await page.getByRole('button', { name: 'Restore default window size', exact: true }).click();
    }
    records.push(record);
  }
  assert.equal(new Set(records.map(({ pid }) => pid)).size, 3);
  assert.equal(new Set(records.map(({ userData }) => userData)).size, 3);

  // Single-instance delivery must keep the existing role window, not swallow another app.
  for (const role of roles) {
    const primary = running.get(role);
    const secondary = spawn(
      path.join(root, `.runtime/suite-runtime/yuzread-${role}.exe`),
      [root, '--qa', '--qa-lock', `--qa-profile=${profileName}`],
      { cwd: root, env, stdio: 'ignore' },
    );
    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`${role} second instance did not exit`)),
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
    assert.equal(exit, 0);
    assert.equal(
      await primary.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );
  }
  const library = running.get('library');
  const closing = new Promise((resolve) => library.once('close', resolve));
  await (
    await library.firstWindow()
  )
    .getByRole('button', { name: 'Close window', exact: true })
    .click();
  await closing;
  running.delete('library');
  for (const role of ['reader', 'downloader'])
    assert.equal(
      await running.get(role).evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );
  assert.deepEqual(errors, []);
  const result = {
    verdict: 'PASS',
    checks: [
      'three independently named executable processes with one suite version',
      'separate userData and single-instance locks',
      'role-local screen discovery and no Reader service in sibling apps',
      'sandboxed isolated windows with distinct native icons',
      'full-window maroon Library/navy Downloader with matching native backgrounds',
      'hover-only caption controls, no visible titles and no workspace movement/gutter',
      'Library/Downloader native drag regions, minimize/default-size/Close and minimum-size layout',
      'closing Library leaves Reader and Downloader alive',
    ],
    applications: records,
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(
    path.join(evidence, 'failure.json'),
    `${JSON.stringify({ verdict: 'FAIL', error: String(error), stack: error.stack, applications: records }, null, 2)}\n`,
  );
  throw error;
} finally {
  for (const application of running.values()) await application.close();
  for (const role of roles)
    await rm(
      path.join(
        root,
        '.runtime',
        `qa-profile-${profileName}${role === 'reader' ? '' : `-${role}`}`,
      ),
      { recursive: true, force: true },
    );
  await rm(scratch, { recursive: true, force: true });
  if ((await readdir(tempRoot)).length === 0) await rmdir(tempRoot);
}
