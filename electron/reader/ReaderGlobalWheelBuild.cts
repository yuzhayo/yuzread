import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { errorText } from '../WindowConfig.cjs';

// CONFIG AND CONTRACT — the Scroll Anywhere helper is a build output, never a daily-use compile.
// `electron-built/reader/ReaderGlobalWheelHost.exe` sits beside the compiled native owner, so
// development launches and the packaged product resolve it with the same relative path.
const root = path.resolve(__dirname, '..', '..');
const compiler = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const sourceFile = path.join(root, 'electron', 'reader', 'ReaderGlobalWheelHost.cs');
// The helper sits beside its compiled adapter, so both development and packaged builds resolve it
// with the same relative path from the native owner.
export const readerGlobalWheelHelperDirectory = __dirname;
export const readerGlobalWheelHelper = path.join(
  readerGlobalWheelHelperDirectory,
  'ReaderGlobalWheelHost.exe',
);
const stampFile = path.join(readerGlobalWheelHelperDirectory, 'ReaderGlobalWheelHost.sha256');

// LOGIC AND CALCULATIONS — one source digest decides whether the existing helper is current.
function sourceDigest(): string {
  return crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex');
}

// LIFECYCLE AND CLEANUP — compile to task scratch, then publish one finished executable.
export function buildReaderGlobalWheelHelper(): string {
  if (process.platform !== 'win32')
    throw new Error('Reader Scroll Anywhere helper currently targets Windows only');
  if (!fs.existsSync(sourceFile))
    throw new Error(`Reader Scroll Anywhere helper source is missing: ${sourceFile}`);
  const digest = sourceDigest();
  if (
    fs.existsSync(readerGlobalWheelHelper) &&
    fs.existsSync(stampFile) &&
    fs.readFileSync(stampFile, 'utf8').trim() === digest
  )
    return readerGlobalWheelHelper;
  if (!fs.existsSync(compiler))
    throw new Error('Windows .NET Framework C# compiler is unavailable');
  const tempRoot = path.join(root, '.agents-temp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(tempRoot, 'wheel-helper-'));
  const output = path.join(scratch, 'ReaderGlobalWheelHost.exe');
  try {
    const result = spawnSync(
      compiler,
      [
        '/nologo',
        '/target:winexe',
        '/optimize+',
        '/platform:x64',
        `/out:${output}`,
        '/reference:System.dll',
        '/reference:System.Core.dll',
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
      throw new Error(
        `Reader Scroll Anywhere helper compilation failed: ${result.stderr || result.stdout}`,
      );
    fs.mkdirSync(readerGlobalWheelHelperDirectory, { recursive: true });
    fs.rmSync(readerGlobalWheelHelper, { force: true });
    fs.copyFileSync(output, readerGlobalWheelHelper);
    fs.writeFileSync(stampFile, `${digest}\n`);
    return readerGlobalWheelHelper;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    if (fs.existsSync(tempRoot) && fs.readdirSync(tempRoot).length === 0) fs.rmdirSync(tempRoot);
  }
}

// Explicit build entry; never imported for runtime side effects.
if (require.main === module) {
  try {
    console.log(`Reader Scroll Anywhere helper: ${buildReaderGlobalWheelHelper()}`);
  } catch (error: unknown) {
    console.error(errorText(error));
    process.exitCode = 1;
  }
}
