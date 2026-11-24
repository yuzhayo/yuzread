import assert from 'node:assert/strict';
import { mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CONFIG AND CONTRACT — real launcher exit/child-survival proof; existing apps are untouched.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const execute = promisify(execFile);
const profilePrefix = `suite-launcher-${Date.now()}`;
const evidence = path.join(root, '.runtime', profilePrefix);
const tempRoot = path.join(root, '.agents-temp');
const scratch = path.join(tempRoot, profilePrefix);
await mkdir(evidence, { recursive: true });
await mkdir(scratch, { recursive: true });
const env = {
  ...process.env,
  TEMP: scratch,
  TMP: scratch,
  YUZREAD_LAUNCHER_QA: profilePrefix,
  ELECTRON_RUN_AS_NODE: '1',
};
const applications = [];

try {
  for (const [index, role] of ['library', 'reader', 'downloader'].entries()) {
    const selection = role === 'library' ? [] : [`--app=${role}`];
    const { stdout } = await execute(
      process.execPath,
      [
        path.join(root, 'electron-built/SuiteLauncher.cjs'),
        ...selection,
        '--qa',
        `--qa-profile=${profilePrefix}-${role}`,
      ],
      { cwd: root, env, windowsHide: true, timeout: 10000 },
    );
    const launched = JSON.parse(stdout.trim());
    applications.push(launched);
    assert.equal(launched.suiteName, 'Yuzread');
    assert.equal(launched.applicationId, role);
    assert.equal(launched.processName, `yuzread-${role}`);
    const inspected = await execute(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
      $child = Get-Process -Id $env:YUZREAD_CHILD_PID -ErrorAction Stop
      if (-not $child.WaitForInputIdle(10000)) { throw 'Application input queue did not become ready' }
      $deadline = (Get-Date).AddSeconds(10)
      do { $child.Refresh(); if ($child.MainWindowHandle -ne 0) { break }; Start-Sleep -Milliseconds 100 } while ((Get-Date) -lt $deadline)
      if ($child.MainWindowHandle -eq 0) { throw 'Selected application did not open its window' }
      if (Get-Process -Id $env:YUZREAD_LAUNCHER_PID -ErrorAction SilentlyContinue) { throw 'Thin launcher remained running' }
      $owned = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'yuzread-*.exe' -and $_.CommandLine -and $_.CommandLine.Contains($env:YUZREAD_LAUNCHER_QA) -and $_.CommandLine -notmatch '--type=' })
      [pscustomobject]@{ processName = $child.ProcessName; title = $child.MainWindowTitle; responding = $child.Responding; launcherExited = $true; ownedApplicationCount = $owned.Count } | ConvertTo-Json -Compress
    `,
      ],
      {
        cwd: root,
        env: {
          ...env,
          YUZREAD_CHILD_PID: String(launched.pid),
          YUZREAD_LAUNCHER_PID: String(launched.launcherPid),
        },
        windowsHide: true,
        timeout: 25000,
      },
    );
    const state = JSON.parse(inspected.stdout.trim());
    assert.equal(state.processName, `yuzread-${role}`);
    assert.equal(state.title, `yuzread-${role}`);
    assert.equal(state.responding, true);
    assert.equal(state.launcherExited, true);
    assert.equal(
      state.ownedApplicationCount,
      index + 1,
      'each dispatch starts exactly one requested app',
    );
    Object.assign(launched, state);
  }
  const result = {
    verdict: 'PASS',
    checks: [
      'suite entry opens only Library by default',
      'explicit Reader/Downloader dispatch opens the correct independent app',
      'launcher exits while its selected GUI application remains responsive',
      'inherited Electron Node-mode environment is not forwarded to GUI apps',
    ],
    applications,
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(
    path.join(evidence, 'failure.json'),
    `${JSON.stringify({ verdict: 'FAIL', error: String(error), applications }, null, 2)}\n`,
  );
  throw error;
} finally {
  // Close only positively identified test windows gracefully, never the operator's normal apps.
  await execute(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `
    $owned = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'yuzread-*.exe' -and $_.CommandLine -and $_.CommandLine.Contains($env:YUZREAD_LAUNCHER_QA) -and $_.CommandLine -notmatch '--type=' })
    foreach ($item in $owned) {
      $process = Get-Process -Id $item.ProcessId -ErrorAction Stop
      if (-not $process.CloseMainWindow()) { throw "Could not request graceful test-window close: $($item.ProcessId)" }
      if (-not $process.WaitForExit(10000)) { throw "Test window did not close gracefully: $($item.ProcessId)" }
    }
  `,
    ],
    { cwd: root, env, windowsHide: true, timeout: 40000 },
  );
  for (const role of ['library', 'reader', 'downloader'])
    await rm(
      path.join(
        root,
        '.runtime',
        `qa-profile-${profilePrefix}-${role}${role === 'reader' ? '' : `-${role}`}`,
      ),
      { recursive: true, force: true },
    );
  await rm(scratch, { recursive: true, force: true });
  if ((await readdir(tempRoot)).length === 0) await rmdir(tempRoot);
}
