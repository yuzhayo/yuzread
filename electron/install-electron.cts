import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { errorText, isRecord } from './WindowConfig.cjs';
const root = path.resolve(__dirname, '..');
const manifest: unknown = JSON.parse(
  fs.readFileSync(path.join(root, 'electron', 'electron-runtime.json'), 'utf8'),
);
if (
  !isRecord(manifest) ||
  typeof manifest.version !== 'string' ||
  typeof manifest.archive !== 'string' ||
  typeof manifest.sha256 !== 'string' ||
  !/^[a-f\d]{64}$/i.test(manifest.sha256)
)
  throw new Error('Invalid selected Electron runtime manifest');
const runtime = { version: manifest.version, archive: manifest.archive, sha256: manifest.sha256 };

// LOGIC — install the operator-selected local runtime, never download a substitute.
async function install() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('This selected runtime is Windows x64 only');
  const modulePath = path.join(root, 'node_modules', 'electron');
  const modulePackage: unknown = JSON.parse(
    fs.readFileSync(path.join(modulePath, 'package.json'), 'utf8'),
  );
  const moduleVersion = isRecord(modulePackage) ? modulePackage.version : undefined;
  if (moduleVersion !== runtime.version)
    throw new Error(`Electron npm package must be ${runtime.version}; run npm ci`);
  const dist = path.join(modulePath, 'dist');
  const stampPath = path.join(modulePath, 'runtime-source.json');
  try {
    const stamp: unknown = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    const installed = fs.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, '');
    if (
      isRecord(stamp) &&
      installed === runtime.version &&
      stamp.sha256 === runtime.sha256 &&
      stamp.archive === runtime.archive &&
      fs.existsSync(path.join(dist, 'electron.exe'))
    ) {
      fs.writeFileSync(path.join(modulePath, 'path.txt'), 'electron.exe');
      console.log(`Using local-archive Electron ${installed}`);
      return;
    }
  } catch {
    /* Missing/mismatched runtime is installed from the supplied archive below. */
  }
  if (!fs.existsSync(runtime.archive))
    throw new Error(`Selected Electron archive is missing: ${runtime.archive}`);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(runtime.archive)) {
    const bytes: unknown = chunk;
    if (!Buffer.isBuffer(bytes)) throw new Error('Invalid archive stream chunk');
    hash.update(bytes);
  }
  if (hash.digest('hex') !== runtime.sha256)
    throw new Error('Selected Electron archive checksum changed; no runtime replaced');
  const staging = path.join(root, '.runtime', `electron-extract-${process.pid}-${Date.now()}`);
  fs.mkdirSync(staging, { recursive: true });
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:YUZREAD_ARCHIVE, $env:YUZREAD_STAGE)",
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, YUZREAD_ARCHIVE: runtime.archive, YUZREAD_STAGE: staging },
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Cannot extract selected archive: ${result.error?.message ?? result.status}`);
  const version = fs.readFileSync(path.join(staging, 'version'), 'utf8').trim().replace(/^v/, '');
  if (version !== runtime.version || !fs.existsSync(path.join(staging, 'electron.exe')))
    throw new Error(`Archive contains the wrong runtime: ${version}`);
  if (fs.existsSync(dist))
    fs.renameSync(
      dist,
      path.join(root, '.runtime', `electron-previous-${process.pid}-${Date.now()}`),
    );
  fs.renameSync(staging, dist);
  fs.writeFileSync(path.join(modulePath, 'path.txt'), 'electron.exe');
  fs.writeFileSync(
    stampPath,
    JSON.stringify({ ...runtime, installedAt: new Date().toISOString() }, null, 2),
  );
  console.log(`Installed Electron ${version} from ${runtime.archive}`);
}

void install().catch((error: unknown) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
