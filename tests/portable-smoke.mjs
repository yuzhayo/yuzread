import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

// CONFIG AND CONTRACT — packaged-runtime proof; only portable .qa paths may be written.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const portable = path.join(root, 'portable', 'Yuzread');
const stamp = Date.now();
const profile = `portable-${stamp}`;
const evidence = path.join(root, '.runtime', `portable-${stamp}`);
const tempRoot = path.join(root, '.agents-temp');
const scratch = path.join(tempRoot, profile);
await mkdir(evidence, { recursive: true });
await mkdir(scratch, { recursive: true });
const env = { ...process.env, TEMP: scratch, TMP: scratch };
delete env.ELECTRON_RUN_AS_NODE;
const roles = ['reader', 'library', 'downloader'];
const applications = [];
let active;

const digestTree = (directory) => {
  if (!directory || !fs.existsSync(directory)) return [];
  return fs
    .globSync('**/*', { cwd: directory })
    .map((relative) => path.join(directory, relative))
    .filter((file) => fs.statSync(file).isFile())
    .map((file) => ({
      file: path.relative(directory, file),
      hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    }));
};
const externalRoots = [
  process.env.APPDATA && path.join(process.env.APPDATA, 'Yuzread'),
  process.env.APPDATA && path.join(process.env.APPDATA, 'YuzreadLibrary'),
  process.env.APPDATA && path.join(process.env.APPDATA, 'YuzreadDownloader'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Yuzread'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'YuzreadLibrary'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'YuzreadDownloader'),
].filter(Boolean);
const beforeExternal = externalRoots.map((directory) => ({
  directory,
  files: digestTree(directory),
}));
const shortcutDirectory = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs')
  : '';
const beforeShortcuts = digestTree(shortcutDirectory).filter(({ file }) =>
  /^yuzread-(reader|library|downloader)\.lnk$/i.test(file),
);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  const readerProfile = path.join(portable, '.qa', profile, 'reader');
  await mkdir(path.join(readerProfile, 'data'), { recursive: true });
  await writeFile(
    path.join(readerProfile, 'data', 'reader-preferences.json'),
    `${JSON.stringify({ version: 1, values: { smoothScrollDurationMs: 600 } }, null, 2)}\n`,
  );
  for (const role of roles) {
    const stale = path.join(portable, '.qa', profile, role, 'cache', 'stale.bin');
    await mkdir(path.dirname(stale), { recursive: true });
    await writeFile(stale, 'stale');
    active = await _electron.launch({
      executablePath: path.join(portable, `yuzread-${role}.exe`),
      args: ['--qa', `--qa-profile=${profile}`],
      cwd: portable,
      env,
      timeout: 15000,
    });
    const page = await active.firstWindow();
    await page.waitForFunction(() => Boolean(window.shellDev));
    const native = await active.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return {
        pid: process.pid,
        name: app.getName(),
        version: app.getVersion(),
        packaged: app.isPackaged,
        appPath: app.getAppPath(),
        resources: process.resourcesPath,
        executable: process.execPath,
        userData: app.getPath('userData'),
        sessionData: app.getPath('sessionData'),
        logs: app.getPath('logs'),
        crashDumps: app.getPath('crashDumps'),
        temp: app.getPath('temp'),
        environmentTemp: process.env.TEMP,
        windowCount: BrowserWindow.getAllWindows().length,
        title: window.getTitle(),
      };
    });
    const bootstrap = await page.evaluate(() => window.shellHost.bootstrap());
    const qaRoot = path.join(portable, '.qa', profile, role);
    assert.equal(native.name, `yuzread-${role}`);
    assert.equal(native.packaged, true);
    assert.equal(native.windowCount, 1);
    assert.equal(native.title, native.name);
    assert.equal(native.appPath, path.join(portable, 'resources', 'app'));
    assert.equal(native.resources, path.join(portable, 'resources'));
    assert.equal(native.executable, path.join(portable, `${native.name}.exe`));
    for (const value of [
      native.userData,
      native.sessionData,
      native.logs,
      native.crashDumps,
      native.temp,
      native.environmentTemp,
      bootstrap.logPath,
    ])
      assert.ok(value.startsWith(qaRoot), `${role} path escaped portable QA root: ${value}`);
    assert.equal(fs.existsSync(stale), false, 'stale role cache must be cleared before startup');
    assert.equal(bootstrap.application.processName, native.name);
    if (role === 'reader')
      assert.equal(bootstrap.readerPreferences.values.smoothScrollDurationMs, 600);
    if (role === 'library') await page.screenshot({ path: path.join(evidence, 'library.png') });
    applications.push(native);
    await active.close();
    active = undefined;
  }

  // The native suite launcher exits; its Library child remains independent and portable.
  const launcherProfile = `${profile}-launcher`;
  const launcher = spawn(
    path.join(portable, 'Yuzread.exe'),
    ['--qa', `--qa-profile=${launcherProfile}`],
    {
      cwd: portable,
      env,
      stdio: 'ignore',
    },
  );
  const launcherExit = await new Promise((resolve, reject) => {
    launcher.once('error', reject);
    launcher.once('exit', resolve);
  });
  assert.equal(launcherExit, 0);
  let launched;
  for (let attempt = 0; attempt < 100 && !launched; attempt++) {
    const result = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$item = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'yuzread-library.exe' -and $_.CommandLine -and $_.CommandLine.Contains($env:YUZREAD_PROFILE) -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1; if ($item) { $process = Get-Process -Id $item.ProcessId; [pscustomobject]@{ pid=$item.ProcessId; title=$process.MainWindowTitle; responding=$process.Responding } | ConvertTo-Json -Compress }",
      ],
      { cwd: portable, env: { ...env, YUZREAD_PROFILE: launcherProfile }, windowsHide: true },
    );
    const output = await new Promise((resolve, reject) => {
      let text = '';
      result.stdout.on('data', (chunk) => (text += chunk));
      result.once('error', reject);
      result.once('exit', () => resolve(text.trim()));
    });
    if (output) launched = JSON.parse(output);
    else await delay(100);
  }
  assert.ok(launched, 'portable suite launcher did not open Library');
  assert.equal(launched.responding, true);
  const launchedProcess = process.kill(launched.pid, 0);
  assert.equal(launchedProcess, true);
  const close = spawn(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$process = Get-Process -Id $env:YUZREAD_PID -ErrorAction Stop; if (-not $process.CloseMainWindow()) { throw "Could not request graceful close" }; if (-not $process.WaitForExit(10000)) { throw "Portable Library did not close" }',
    ],
    { cwd: portable, env: { ...env, YUZREAD_PID: String(launched.pid) }, windowsHide: true },
  );
  const closeCode = await new Promise((resolve, reject) => {
    close.once('error', reject);
    close.once('exit', resolve);
  });
  assert.equal(closeCode, 0);

  const afterExternal = externalRoots.map((directory) => ({
    directory,
    files: digestTree(directory),
  }));
  const afterShortcuts = digestTree(shortcutDirectory).filter(({ file }) =>
    /^yuzread-(reader|library|downloader)\.lnk$/i.test(file),
  );
  assert.deepEqual(
    afterExternal,
    beforeExternal,
    'portable launch changed an AppData/LocalAppData application tree',
  );
  assert.deepEqual(afterShortcuts, beforeShortcuts, 'portable launch rewrote Start Menu shortcuts');
  const result = {
    verdict: 'PASS',
    checks: [
      'packaged apps run without a development application argument',
      'all persistent/session/log/crash/temp paths remain under the portable root',
      'stale role cache clears while portable Reader preferences persist',
      'packaged sharp/yauzl dependency guard permits startup',
      'thin Yuzread.exe exits and opens Library by default',
      'normal AppData trees and Start Menu shortcuts remain unchanged',
    ],
    applications,
    launcher: launched,
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(
    path.join(evidence, 'failure.json'),
    `${JSON.stringify({ verdict: 'FAIL', error: String(error), stack: error.stack, applications }, null, 2)}\n`,
  );
  throw error;
} finally {
  if (active) await active.close();
  await rm(path.join(portable, '.qa', profile), { recursive: true, force: true });
  await rm(path.join(portable, '.qa', `${profile}-launcher`), { recursive: true, force: true });
  const qa = path.join(portable, '.qa');
  if (fs.existsSync(qa) && (await readdir(qa)).length === 0) await rmdir(qa);
  await rm(scratch, { recursive: true, force: true });
  if ((await readdir(tempRoot)).length === 0) await rmdir(tempRoot);
}
