import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isRecord } from './WindowConfig.cjs';

// CONFIG AND CONTRACT — one validated marker distinguishes production from development.
export interface PortableRuntime {
  kind: 'yuzread.portable.v1';
  root: string;
  version: string;
  defaultApplicationId: string;
}
export interface PortablePaths {
  root: string;
  userData: string;
  sessionData: string;
  readerCache: string;
  logs: string;
  crashDumps: string;
  temp: string;
}
const safeId = (value: string) => /^[a-z][a-z0-9-]{0,31}$/.test(value);
const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// DISCOVERY — the marker must sit beside the executable and match the packaged version.
export function detectPortableRuntime(
  executable: string,
  expectedVersion: string,
): PortableRuntime | null {
  const root = path.dirname(path.resolve(executable));
  const marker = path.join(root, 'portable.json');
  if (!fs.existsSync(marker)) return null;
  const value: unknown = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 5 ||
    value.kind !== 'yuzread.portable.v1' ||
    value.suiteName !== 'Yuzread' ||
    value.version !== expectedVersion ||
    value.dataVersion !== 1 ||
    typeof value.defaultApplicationId !== 'string' ||
    !safeId(value.defaultApplicationId)
  )
    throw new Error('Invalid or incompatible portable runtime marker');
  return {
    kind: value.kind,
    root,
    version: value.version,
    defaultApplicationId: value.defaultApplicationId,
  };
}

// PLACEMENT — persistent data and disposable mechanics have visibly separate owners.
export function portablePaths(
  runtime: PortableRuntime,
  applicationId: string,
  qaProfile?: string,
): PortablePaths {
  if (!safeId(applicationId)) throw new Error('Invalid portable application identity');
  if (qaProfile !== undefined && !/^[A-Za-z0-9-]{1,64}$/.test(qaProfile))
    throw new Error('Invalid portable QA profile');
  const root = qaProfile ? path.join(runtime.root, '.qa', qaProfile, applicationId) : runtime.root;
  const paths: PortablePaths = {
    root,
    userData: qaProfile ? path.join(root, 'data') : path.join(root, 'data', applicationId),
    sessionData: qaProfile
      ? path.join(root, 'cache', 'chromium')
      : path.join(root, 'cache', applicationId, 'chromium'),
    readerCache: qaProfile
      ? path.join(root, 'cache', 'archive')
      : path.join(root, 'cache', applicationId, 'archive'),
    logs: qaProfile ? path.join(root, 'logs') : path.join(root, 'logs', applicationId),
    crashDumps: qaProfile
      ? path.join(root, 'crash-dumps')
      : path.join(root, 'crash-dumps', applicationId),
    temp: qaProfile
      ? path.join(root, 'cache', 'temp')
      : path.join(root, 'cache', applicationId, 'temp'),
  };
  for (const value of Object.values(paths))
    if (value !== root && !inside(runtime.root, value))
      throw new Error('Portable path escaped its root');
  return paths;
}

// DEPENDENCY BOUNDARY — refuse accidental fallback into development node_modules.
export function assertPortableDependencies(applicationRoot: string): void {
  const localModules = path.join(applicationRoot, 'node_modules');
  const resolve = createRequire(path.join(applicationRoot, 'package.json')).resolve;
  for (const name of ['sharp', 'yauzl']) {
    const file = resolve(name);
    if (!inside(localModules, file))
      throw new Error(`Portable dependency escaped package: ${name}`);
  }
}

// CLEANUP — cache is session-scoped; diagnostics and crashes stay small and inspectable.
function files(directory: string): { path: string; bytes: number; modified: number }[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .globSync('**/*', { cwd: directory })
    .map((relative) => path.join(directory, relative))
    .filter((file) => fs.statSync(file).isFile())
    .map((file) => {
      const stat = fs.statSync(file);
      return { path: file, bytes: stat.size, modified: stat.mtimeMs };
    });
}
function prune(
  directory: string,
  maximumFiles: number,
  maximumBytes: number,
  maximumAgeMs: number,
) {
  fs.mkdirSync(directory, { recursive: true });
  const deadline = Date.now() - maximumAgeMs;
  const entries = files(directory).sort((a, b) => b.modified - a.modified);
  let retained = 0;
  let bytes = 0;
  for (const entry of entries) {
    const keep =
      entry.modified >= deadline && retained < maximumFiles && bytes + entry.bytes <= maximumBytes;
    if (keep) {
      retained += 1;
      bytes += entry.bytes;
    } else fs.rmSync(entry.path, { force: true });
  }
}
export function preparePortablePrimaryRuntime(paths: PortablePaths): void {
  fs.mkdirSync(paths.userData, { recursive: true });
  fs.rmSync(path.dirname(paths.sessionData), { recursive: true, force: true });
  fs.mkdirSync(paths.sessionData, { recursive: true });
  fs.mkdirSync(paths.readerCache, { recursive: true });
  fs.mkdirSync(paths.temp, { recursive: true });
  prune(paths.logs, 8, 8 * 1024 * 1024, 30 * 24 * 60 * 60 * 1000);
  prune(paths.crashDumps, 5, 64 * 1024 * 1024, 30 * 24 * 60 * 60 * 1000);
}
