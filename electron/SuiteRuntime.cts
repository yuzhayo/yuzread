import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { discoverSuiteApplications, suiteName } from './SuiteApplications.cjs';
import { createSuiteIcons } from './SuiteRuntimeIcons.cjs';
import { isRecord, errorText } from './WindowConfig.cjs';

// CONFIG AND CONTRACT — development launch runtime only, not an installer/portable release.
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules/electron/dist');
export const suiteRuntimeDirectory = path.join(root, '.runtime/suite-runtime');
const digest = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

// LOGIC AND CALCULATIONS — standard Windows VERSIONINFO, one package.json suite version.
function aligned(bytes: Buffer): Buffer {
  return Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
}
function versionNode(
  key: string,
  value: Buffer,
  text: boolean,
  children: readonly Buffer[] = [],
): Buffer {
  const header = Buffer.alloc(6);
  const result = Buffer.concat([
    aligned(Buffer.concat([header, Buffer.from(`${key}\0`, 'utf16le')])),
    aligned(value),
    ...children,
  ]);
  if (result.length > 65535) throw new Error('Windows version resource is too large');
  result.writeUInt16LE(result.length, 0);
  result.writeUInt16LE(text ? value.length / 2 : value.length, 2);
  result.writeUInt16LE(text ? 1 : 0, 4);
  return result;
}
export function suiteVersionResource(version: string, processName: string): Buffer {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error('Invalid suite version');
  if (!/^yuzread-[a-z][a-z0-9-]{0,31}$/.test(processName)) throw new Error('Invalid process name');
  const parts = version.split('-')[0]?.split('.').map(Number);
  const major = parts?.[0],
    minor = parts?.[1],
    patch = parts?.[2];
  if (
    major === undefined ||
    minor === undefined ||
    patch === undefined ||
    [major, minor, patch].some((value) => value > 65535)
  )
    throw new Error('Suite version exceeds Windows bounds');
  const fixed = Buffer.alloc(52);
  [
    0xfeef04bd,
    0x10000,
    major * 65536 + minor,
    patch * 65536,
    major * 65536 + minor,
    patch * 65536,
    0x3f,
    0,
    0x40004,
    1,
    0,
    0,
    0,
  ].forEach((value, index) => fixed.writeUInt32LE(value, index * 4));
  const strings = {
    CompanyName: suiteName,
    ProductName: suiteName,
    FileDescription: processName,
    FileVersion: version,
    ProductVersion: version,
    InternalName: processName,
    OriginalFilename: `${processName}.exe`,
  };
  const table = versionNode(
    '040904b0',
    Buffer.alloc(0),
    true,
    Object.entries(strings).map(([key, value]) =>
      versionNode(key, Buffer.from(`${value}\0`, 'utf16le'), true),
    ),
  );
  const translation = Buffer.alloc(4);
  translation.writeUInt16LE(1033, 0);
  translation.writeUInt16LE(1200, 2);
  return versionNode('VS_VERSION_INFO', fixed, false, [
    versionNode('StringFileInfo', Buffer.alloc(0), true, [table]),
    versionNode('VarFileInfo', Buffer.alloc(0), true, [
      versionNode('Translation', translation, false),
    ]),
  ]);
}

// STATE AND COORDINATION — branded EXEs are copies; unchanged supporting files are hardlinked once.
export async function prepareSuiteRuntime(): Promise<void> {
  if (process.platform !== 'win32')
    throw new Error('Branded suite launchers currently target Windows');
  const applications = discoverSuiteApplications(root);
  const packageData: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (
    !isRecord(packageData) ||
    packageData.name !== 'yuzread' ||
    typeof packageData.version !== 'string'
  )
    throw new Error('Invalid suite package identity');
  await createSuiteIcons(root, applications);
  const branding = path.join(root, 'electron/SuiteRuntimeBrandExecutable.ps1');
  const fingerprint = digest(
    Buffer.from(
      JSON.stringify({
        version: packageData.version,
        source: digest(fs.readFileSync(path.join(source, 'electron.exe'))),
        brander: digest(fs.readFileSync(branding)),
        implementation: digest(fs.readFileSync(__filename)),
        applications: applications.map((application) => ({
          ...application,
          icon: digest(
            fs.readFileSync(path.join(root, `electron/assets/${application.processName}.ico`)),
          ),
        })),
      }),
    ),
  );
  const manifestPath = path.join(suiteRuntimeDirectory, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const existing: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!isRecord(existing) || existing.kind !== 'yuzread.development-runtime.v1')
      throw new Error('Suite runtime directory belongs to unknown work');
    if (
      existing.fingerprint === fingerprint &&
      applications.every((application) =>
        fs.existsSync(path.join(suiteRuntimeDirectory, `${application.processName}.exe`)),
      )
    )
      return;
  } else if (fs.existsSync(suiteRuntimeDirectory))
    throw new Error('Unowned suite runtime directory; left unchanged');
  const active = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$running = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:YUZREAD_SUITE_RUNTIME + "\\", [StringComparison]::OrdinalIgnoreCase) }; if ($running) { $running | Select-Object ProcessId,Name | Out-String | Write-Error; exit 1 }',
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, YUZREAD_SUITE_RUNTIME: suiteRuntimeDirectory },
    },
  );
  if (active.error) throw active.error;
  if (active.status !== 0)
    throw new Error(
      `Close the running Yuzread suite windows before rebuilding executable branding. ${active.stderr}`,
    );
  const tempRoot = path.join(root, '.agents-temp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(tempRoot, 'suite-runtime-'));
  try {
    for (const application of applications) {
      const executable = path.join(staging, `${application.processName}.exe`);
      const resource = path.join(staging, `${application.processName}.version`);
      fs.copyFileSync(path.join(source, 'electron.exe'), executable);
      fs.writeFileSync(
        resource,
        suiteVersionResource(packageData.version, application.processName),
      );
      const result = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          branding,
          '-Executable',
          executable,
          '-Icon',
          path.join(root, `electron/assets/${application.processName}.ico`),
          '-VersionResource',
          resource,
        ],
        {
          encoding: 'utf8',
          windowsHide: true,
          env: { ...process.env, TEMP: staging, TMP: staging },
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(`Executable branding failed: ${result.stderr || result.stdout}`);
    }
    fs.mkdirSync(suiteRuntimeDirectory, { recursive: true });
    if (!fs.existsSync(manifestPath))
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ kind: 'yuzread.development-runtime.v1', fingerprint: null }),
      );
    for (const relative of fs.globSync('**/*', { cwd: source })) {
      const input = path.join(source, relative),
        output = path.join(suiteRuntimeDirectory, relative);
      if (
        !fs.statSync(input).isFile() ||
        relative === 'electron.exe' ||
        relative === 'electron_wer.dll'
      )
        continue;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const current = fs.existsSync(output) ? fs.statSync(output) : undefined;
      const original = fs.statSync(input);
      if (current?.dev === original.dev && current.ino === original.ino) continue;
      if (current) fs.unlinkSync(output);
      fs.linkSync(input, output);
    }
    for (const application of applications) {
      const name = `${application.processName}.exe`;
      fs.renameSync(path.join(staging, name), path.join(suiteRuntimeDirectory, name));
      const werSource = path.join(source, 'electron_wer.dll');
      if (fs.existsSync(werSource)) {
        const wer = path.join(suiteRuntimeDirectory, `${application.processName}_wer.dll`);
        if (fs.existsSync(wer)) fs.unlinkSync(wer);
        fs.linkSync(werSource, wer);
      }
    }
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify({ kind: 'yuzread.development-runtime.v1', fingerprint, suiteName, version: packageData.version, applications: applications.map(({ id, processName }) => ({ id, processName })) }, null, 2)}\n`,
    );
    console.log(
      `Prepared ${suiteName} ${packageData.version}: ${applications.map((application) => application.processName).join(', ')}`,
    );
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (fs.readdirSync(tempRoot).length === 0) fs.rmdirSync(tempRoot);
  }
}

// LIFECYCLE AND CLEANUP — explicit build entry, never imported for runtime side effects.
if (require.main === module)
  void prepareSuiteRuntime().catch((error: unknown) => {
    console.error(errorText(error));
    process.exitCode = 1;
  });
