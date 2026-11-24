import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// CONFIG AND CONTRACT — post-build artifact checks; no app launch or mutation.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const portable = path.join(root, 'portable', 'Yuzread');
const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const marker = JSON.parse(fs.readFileSync(path.join(portable, 'portable.json'), 'utf8'));
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('portable package contains one suite launcher, three apps and one packaged application', () => {
  assert.deepEqual(marker, {
    kind: 'yuzread.portable.v1',
    suiteName: 'Yuzread',
    version: packageData.version,
    dataVersion: 1,
    defaultApplicationId: 'library',
  });
  for (const name of [
    'Yuzread.exe',
    'yuzread-reader.exe',
    'yuzread-library.exe',
    'yuzread-downloader.exe',
    'Register CBZ opener.cmd',
    'Remove CBZ opener registration.cmd',
  ])
    assert.equal(fs.statSync(path.join(portable, name)).isFile(), true);
  const appPackage = JSON.parse(
    fs.readFileSync(path.join(portable, 'resources/app/package.json'), 'utf8'),
  );
  assert.equal(appPackage.version, packageData.version);
  assert.equal(appPackage.main, 'electron-built/main.cjs');
  assert.equal(fs.existsSync(path.join(portable, 'resources/app/screen-built/index.html')), true);
  assert.equal(fs.existsSync(path.join(portable, 'resources/app/electron-built/main.cjs')), true);
  assert.equal(
    fs.globSync('**/*.{ts,tsx,cts,cs}', {
      cwd: path.join(portable, 'resources/app'),
      exclude: ['node_modules/**'],
    }).length,
    0,
  );
});

test('portable native dependencies are explicit and cannot rely on development node_modules', () => {
  const modules = path.join(portable, 'resources/app/node_modules');
  for (const relative of [
    'sharp/dist/index.cjs',
    'yauzl/index.js',
    'pend/index.js',
    'detect-libc/lib/detect-libc.js',
    'semver/index.js',
    '@img/colour/index.cjs',
  ])
    assert.equal(fs.existsSync(path.join(modules, relative)), true, relative);
  assert.equal(
    fs.globSync('sharp-win32-x64-*.node', {
      cwd: path.join(modules, '@img/sharp-win32-x64/lib'),
    }).length,
    1,
  );
  const development = fs.statSync(path.join(root, 'node_modules/electron/dist/icudtl.dat'));
  const production = fs.statSync(path.join(portable, 'icudtl.dat'));
  assert.ok(
    development.dev !== production.dev || development.ino !== production.ino,
    'production runtime must be a copy, not a development hardlink',
  );
});

test('portable writable folders and clean release archive are present with a verified checksum', () => {
  for (const name of ['data', 'cache', 'logs', 'crash-dumps'])
    assert.equal(fs.statSync(path.join(portable, name)).isDirectory(), true);
  const zipName = `Yuzread-${packageData.version}-win-x64.zip`;
  const zip = path.join(root, 'releases', zipName);
  const checksum = fs.readFileSync(`${zip}.sha256`, 'utf8').trim();
  assert.equal(checksum, `${digest(zip)}  ${zipName}`);
  assert.ok(fs.statSync(zip).size > 50 * 1024 * 1024, 'release ZIP unexpectedly omits the runtime');
  const inspection = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$archive=[System.IO.Compression.ZipFile]::OpenRead($env:YUZREAD_ZIP); try { $names=@($archive.Entries | ForEach-Object { $_.FullName.Replace('\\','/') }); $unexpected=@($names | Where-Object { $_ -match '(?i)(reader-preferences|load-folder|\\.qa/|\\.agents-temp|SuitePortableLauncher\\.cs|^release/)' }); [pscustomobject]@{ entries=$names.Count; roots=@($names | ForEach-Object { ($_ -split '/')[0] } | Sort-Object -Unique); unexpected=$unexpected } | ConvertTo-Json -Compress } finally { $archive.Dispose() }",
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, YUZREAD_ZIP: zip },
    },
  );
  assert.equal(inspection.status, 0, inspection.stderr);
  const archive = JSON.parse(inspection.stdout.trim());
  assert.deepEqual(archive.roots, ['Yuzread']);
  assert.deepEqual(archive.unexpected, []);
  assert.ok(archive.entries > 250);
});

test('build manifest verifies every executable and Reader settings migrate without moving originals', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(portable, 'release-manifest.json'), 'utf8'),
  );
  assert.equal(manifest.version, packageData.version);
  for (const entry of manifest.files)
    assert.equal(digest(path.join(portable, entry.name)), entry.sha256);
  const oldPreference = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Yuzread', 'reader-preferences.json')
    : '';
  if (oldPreference && fs.existsSync(oldPreference)) {
    const migrated = path.join(portable, 'data', 'reader', 'reader-preferences.json');
    assert.equal(fs.existsSync(migrated), true);
    assert.deepEqual(fs.readFileSync(migrated), fs.readFileSync(oldPreference));
    assert.equal(fs.existsSync(oldPreference), true, 'original preference must remain untouched');
  }
});
