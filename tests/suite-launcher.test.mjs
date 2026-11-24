import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSuiteLaunch, launchSuiteApplication } from '../electron-built/SuiteLauncher.cjs';
import { discoverSuiteApplications } from '../electron-built/SuiteApplications.cjs';

// CONFIG AND CONTRACT — launcher routing only; no running app or normal saved-state mutation.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

test('suite entry defaults to Library, not Reader or all three applications', () => {
  const plan = planSuiteLaunch(root, []);
  assert.equal(plan.applicationId, 'library');
  assert.equal(plan.processName, 'yuzread-library');
  assert.equal(path.basename(plan.executable), 'yuzread-library.exe');
  assert.deepEqual(plan.args, [root]);
});

test('explicit suite selections route one app and preserve arguments without a shell', () => {
  for (const { id, processName } of discoverSuiteApplications(root)) {
    const args = ['--qa', '--qa-profile=launcher', 'C:\\Manga\\Book 1.cbz'];
    for (const selection of [[`--app=${id}`], [id]]) {
      const plan = planSuiteLaunch(root, [...selection, ...args]);
      assert.equal(plan.applicationId, id);
      assert.equal(path.basename(plan.executable), `${processName}.exe`);
      assert.deepEqual(plan.args, [root, ...args]);
    }
  }
});

test('suite rejects unknown, empty, malformed and ambiguous selections', () => {
  for (const args of [
    ['unknown'],
    ['--app=unknown'],
    ['--app='],
    ['--app'],
    ['--app=reader', '--app=downloader'],
    ['reader', '--app=reader'],
  ])
    assert.throws(() => planSuiteLaunch(root, args));
});

test('configured suite default is authoritative and must refer to a declared application', () => {
  const tempRoot = path.join(root, '.agents-temp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(tempRoot, 'suite-launcher-config-'));
  try {
    for (const application of discoverSuiteApplications(root)) {
      const folder = path.join(fixture, 'electron', application.id);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'application.json'), JSON.stringify(application));
    }
    const config = path.join(fixture, 'electron/suite.json');
    fs.writeFileSync(config, JSON.stringify({ schemaVersion: 1, defaultApplicationId: 'reader' }));
    assert.equal(planSuiteLaunch(fixture, []).applicationId, 'reader');
    for (const value of [
      { schemaVersion: 1, defaultApplicationId: 'unknown' },
      { schemaVersion: 2, defaultApplicationId: 'library' },
      { schemaVersion: 1, defaultApplicationId: 'library', undeclared: true },
    ]) {
      fs.writeFileSync(config, JSON.stringify(value));
      assert.throws(() => planSuiteLaunch(fixture, []));
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    if (fs.readdirSync(tempRoot).length === 0) fs.rmdirSync(tempRoot);
  }
});

test('missing suite executable reports a startup failure instead of silently succeeding', async () => {
  const plan = planSuiteLaunch(root, []);
  await assert.rejects(
    launchSuiteApplication({
      ...plan,
      executable: path.join(root, '.agents-temp/no-such-launcher.exe'),
    }),
    /Suite runtime is missing/,
  );
});
