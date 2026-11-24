import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { discoverSuiteApplications } from './SuiteApplications.cjs';
import { errorText, isRecord } from './WindowConfig.cjs';

// CONFIG AND CONTRACT — one self-contained Windows x64 product inside this repository.
const root = path.resolve(__dirname, '..');
export const portableDirectory = path.join(root, 'portable', 'Yuzread');
const releaseDirectory = path.join(root, 'releases');
const runtimeDirectory = path.join(root, 'node_modules', 'electron', 'dist');
const developmentRuntime = path.join(root, '.runtime', 'suite-runtime');
const runtimeModules = [
  'sharp',
  'yauzl',
  'pend',
  'detect-libc',
  'semver',
  '@img/colour',
  '@img/sharp-win32-x64',
] as const;
const hash = (file: string) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copy = (source: string, destination: string) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, dereference: true, force: true });
};

// VALIDATION — publishing never overwrites an unknown folder or a running production app.
function readPackage(): { version: string } {
  const value: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!isRecord(value) || value.name !== 'yuzread' || typeof value.version !== 'string')
    throw new Error('Invalid suite package identity');
  return { version: value.version };
}
function configuredDefault(): string {
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(root, 'electron', 'suite.json'), 'utf8'),
  );
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.defaultApplicationId !== 'string'
  )
    throw new Error('Invalid suite default configuration');
  return value.defaultApplicationId;
}
function assertOwnedPortable(target: string, version?: string) {
  if (!fs.existsSync(target)) return;
  const marker = path.join(target, 'portable.json');
  if (!fs.existsSync(marker))
    throw new Error('Portable destination contains unknown work; left unchanged');
  const value: unknown = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (
    !isRecord(value) ||
    value.kind !== 'yuzread.portable.v1' ||
    value.suiteName !== 'Yuzread' ||
    (version !== undefined && value.version !== version)
  )
    throw new Error('Portable destination has an incompatible owner/version marker');
}
function assertNotRunning(target: string) {
  if (!fs.existsSync(target)) return;
  const result = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:YUZREAD_PORTABLE_ROOT + "\\", [StringComparison]::OrdinalIgnoreCase) }); if ($running.Count) { $running | Select-Object ProcessId,Name | Out-String | Write-Error; exit 1 }',
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, YUZREAD_PORTABLE_ROOT: target },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Close the running portable Yuzread applications before rebuilding. ${result.stderr}`,
    );
}

// ASSEMBLY — compiled application/config plus only native runtime dependencies.
function copyApplication(product: string, version: string) {
  const applicationRoot = path.join(product, 'resources', 'app');
  fs.mkdirSync(applicationRoot, { recursive: true });
  fs.writeFileSync(
    path.join(applicationRoot, 'package.json'),
    `${JSON.stringify({ name: 'yuzread', productName: 'Yuzread', version, private: true, main: 'electron-built/main.cjs' }, null, 2)}\n`,
  );
  copy(path.join(root, 'electron-built'), path.join(applicationRoot, 'electron-built'));
  copy(path.join(root, 'screen-built'), path.join(applicationRoot, 'screen-built'));
  for (const relative of [
    'electron/config.json',
    'electron/suite.json',
    'electron/reader/application.json',
    'electron/library/application.json',
    'electron/library/config.json',
    'electron/downloader/application.json',
    'electron/downloader/config.json',
    'screen/config.json',
    'screen/library/config.json',
    'screen/downloader/config.json',
  ])
    copy(path.join(root, relative), path.join(applicationRoot, relative));
  copy(path.join(root, 'electron', 'assets'), path.join(applicationRoot, 'electron', 'assets'));
  for (const name of runtimeModules)
    copy(
      path.join(root, 'node_modules', ...name.split('/')),
      path.join(applicationRoot, 'node_modules', ...name.split('/')),
    );
}
function copyElectronRuntime(
  product: string,
  applications: ReturnType<typeof discoverSuiteApplications>,
) {
  for (const relative of fs.globSync('**/*', { cwd: runtimeDirectory })) {
    const source = path.join(runtimeDirectory, relative);
    if (
      !fs.statSync(source).isFile() ||
      relative === 'electron.exe' ||
      relative === 'electron_wer.dll'
    )
      continue;
    copy(source, path.join(product, relative));
  }
  for (const application of applications) {
    copy(
      path.join(developmentRuntime, `${application.processName}.exe`),
      path.join(product, `${application.processName}.exe`),
    );
    const crashReporter = path.join(runtimeDirectory, 'electron_wer.dll');
    if (fs.existsSync(crashReporter))
      copy(crashReporter, path.join(product, `${application.processName}_wer.dll`));
  }
}
function buildLauncher(
  product: string,
  version: string,
  defaultApplication: string,
  scratch: string,
) {
  const numbers = version.split('-')[0]?.split('.');
  if (!numbers || numbers.length !== 3 || numbers.some((value) => !/^\d+$/.test(value)))
    throw new Error('Portable launcher requires a semantic numeric suite version');
  const assemblyVersion = `${numbers.join('.')}.0`;
  const source = fs
    .readFileSync(path.join(root, 'electron', 'SuitePortableLauncher.cs'), 'utf8')
    .replaceAll('__ASSEMBLY_VERSION__', assemblyVersion)
    .replaceAll('__SUITE_VERSION__', version)
    .replaceAll('__DEFAULT_APPLICATION__', defaultApplication);
  const sourceFile = path.join(scratch, 'SuitePortableLauncher.cs');
  fs.writeFileSync(sourceFile, source);
  const compiler = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  if (!fs.existsSync(compiler))
    throw new Error('Windows .NET Framework C# compiler is unavailable');
  const result = spawnSync(
    compiler,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/platform:x64',
      `/out:${path.join(product, 'Yuzread.exe')}`,
      `/win32icon:${path.join(root, 'electron', 'assets', 'app-icon.ico')}`,
      '/reference:System.dll',
      '/reference:System.Core.dll',
      '/reference:System.Windows.Forms.dll',
      sourceFile,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, TEMP: scratch, TMP: scratch },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Portable launcher compilation failed: ${result.stderr || result.stdout}`);
}

// RELEASE — ZIP is clean; local production preserves only intentional persistent folders.
function writePortableDocuments(product: string, version: string, defaultApplication: string) {
  fs.writeFileSync(
    path.join(product, 'portable.json'),
    `${JSON.stringify({ kind: 'yuzread.portable.v1', suiteName: 'Yuzread', version, dataVersion: 1, defaultApplicationId: defaultApplication }, null, 2)}\n`,
  );
  fs.mkdirSync(path.join(product, 'data'), { recursive: true });
  fs.mkdirSync(path.join(product, 'cache'), { recursive: true });
  fs.mkdirSync(path.join(product, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(product, 'crash-dumps'), { recursive: true });
  fs.writeFileSync(
    path.join(product, 'README.txt'),
    [
      `Yuzread ${version} portable`,
      '',
      'Yuzread.exe opens Library by default.',
      'yuzread-reader.exe, yuzread-library.exe and yuzread-downloader.exe open directly.',
      'Run "Register CBZ opener.cmd" once, then confirm Yuzread Reader for .cbz in Windows Default Apps.',
      '"Remove CBZ opener registration.cmd" removes only Yuzread-owned current-user registration.',
      'data is persistent and must be backed up. cache is disposable and cleared per app startup.',
      'logs and crash-dumps are locally retained with bounded startup cleanup.',
      'Do not store manga inside this application folder; rebuilds own every path except data/logs/crash-dumps.',
      '',
    ].join('\r\n'),
  );
  fs.writeFileSync(
    path.join(product, 'data', 'README.txt'),
    'Persistent application settings. Rebuilds preserve this folder.\r\n',
  );
  fs.writeFileSync(
    path.join(product, 'cache', 'README.txt'),
    'Disposable application caches. Safe to delete while every Yuzread app is closed.\r\n',
  );
  fs.writeFileSync(path.join(product, 'logs', 'README.txt'), 'Bounded local diagnostics.\r\n');
  fs.writeFileSync(
    path.join(product, 'crash-dumps', 'README.txt'),
    'Bounded local crash reports.\r\n',
  );
  fs.writeFileSync(
    path.join(product, 'Register CBZ opener.cmd'),
    '@echo off\r\nstart "" "%~dp0Yuzread.exe" --register-cbz\r\n',
  );
  fs.writeFileSync(
    path.join(product, 'Remove CBZ opener registration.cmd'),
    '@echo off\r\nstart "" "%~dp0Yuzread.exe" --remove-cbz-registration\r\n',
  );
}
function createReleaseZip(staging: string, version: string, scratch: string) {
  fs.mkdirSync(releaseDirectory, { recursive: true });
  const name = `Yuzread-${version}-win-x64.zip`;
  const temporary = path.join(scratch, name);
  fs.rmSync(temporary, { force: true });
  const result = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:YUZREAD_ZIP_SOURCE, $env:YUZREAD_ZIP_TARGET, [System.IO.Compression.CompressionLevel]::Optimal, $true)",
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        TEMP: scratch,
        TMP: scratch,
        YUZREAD_ZIP_SOURCE: staging,
        YUZREAD_ZIP_TARGET: temporary,
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Portable ZIP creation failed: ${result.stderr || result.stdout}`);
  const destination = path.join(releaseDirectory, name);
  fs.copyFileSync(temporary, destination);
  fs.writeFileSync(`${destination}.sha256`, `${hash(destination)}  ${name}\n`);
  fs.rmSync(temporary, { force: true });
}
function migrateExistingReaderData(target: string) {
  const source = process.env.APPDATA ? path.join(process.env.APPDATA, 'Yuzread') : '';
  if (!source || !fs.existsSync(source)) return;
  const destination = path.join(target, 'data', 'reader');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['reader-preferences.json', 'load-folder.json']) {
    const input = path.join(source, name),
      output = path.join(destination, name);
    if (fs.existsSync(input) && !fs.existsSync(output)) fs.copyFileSync(input, output);
  }
}
function publish(stagedProduct: string, target: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    fs.renameSync(stagedProduct, target);
    migrateExistingReaderData(target);
    return;
  }
  const backup = path.join(
    path.dirname(path.dirname(stagedProduct)),
    `portable-previous-${process.pid}`,
  );
  fs.renameSync(target, backup);
  try {
    fs.renameSync(stagedProduct, target);
    for (const name of ['data', 'logs', 'crash-dumps']) {
      const previous = path.join(backup, name);
      if (!fs.existsSync(previous)) continue;
      fs.rmSync(path.join(target, name), { recursive: true, force: true });
      fs.renameSync(previous, path.join(target, name));
    }
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

// LIFECYCLE AND CLEANUP — stage completely, publish once, remove every owned intermediate.
export async function buildPortableSuite(): Promise<void> {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Portable Yuzread currently targets Windows x64');
  const { version } = readPackage();
  const applications = discoverSuiteApplications(root);
  const defaultApplication = configuredDefault();
  if (!applications.some(({ id }) => id === defaultApplication))
    throw new Error('Portable default does not identify a declared application');
  assertOwnedPortable(portableDirectory);
  assertNotRunning(portableDirectory);
  for (const required of [
    developmentRuntime,
    path.join(root, 'electron-built', 'main.cjs'),
    path.join(root, 'screen-built', 'index.html'),
  ])
    if (!fs.existsSync(required)) throw new Error(`Required build output is missing: ${required}`);
  const tempRoot = path.join(root, '.agents-temp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(tempRoot, 'portable-build-'));
  const scratch = path.join(staging, 'scratch');
  const releaseRoot = path.join(staging, 'release');
  const product = path.join(releaseRoot, 'Yuzread');
  fs.mkdirSync(scratch, { recursive: true });
  fs.mkdirSync(product, { recursive: true });
  try {
    copyElectronRuntime(product, applications);
    copyApplication(product, version);
    buildLauncher(product, version, defaultApplication, scratch);
    writePortableDocuments(product, version, defaultApplication);
    const manifest = {
      kind: 'yuzread.portable-build.v1',
      version,
      files: ['Yuzread.exe', ...applications.map(({ processName }) => `${processName}.exe`)].map(
        (name) => ({ name, sha256: hash(path.join(product, name)) }),
      ),
    };
    fs.writeFileSync(
      path.join(product, 'release-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    createReleaseZip(product, version, scratch);
    publish(product, portableDirectory);
    console.log(`Built portable Yuzread ${version}: ${portableDirectory}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (fs.existsSync(tempRoot) && fs.readdirSync(tempRoot).length === 0) fs.rmdirSync(tempRoot);
  }
}

if (require.main === module)
  void buildPortableSuite().catch((error: unknown) => {
    console.error(errorText(error));
    process.exitCode = 1;
  });
