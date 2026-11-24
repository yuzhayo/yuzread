import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPortableDependencies,
  detectPortableRuntime,
  portablePaths,
  preparePortablePrimaryRuntime,
} from '../electron-built/PortableRuntime.cjs';

// CONFIG AND CONTRACT — isolated filesystem proof for production path ownership/cleanup.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const tempRoot = path.join(root, '.agents-temp');

function fixture() {
  fs.mkdirSync(tempRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(tempRoot, 'portable-runtime-'));
  fs.writeFileSync(
    path.join(directory, 'portable.json'),
    JSON.stringify({
      kind: 'yuzread.portable.v1',
      suiteName: 'Yuzread',
      version: '0.1.0',
      dataVersion: 1,
      defaultApplicationId: 'library',
    }),
  );
  return directory;
}
function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  if (fs.existsSync(tempRoot) && fs.readdirSync(tempRoot).length === 0) fs.rmdirSync(tempRoot);
}

test('portable marker and role paths keep persistent/data and disposable/cache owners separate', () => {
  const directory = fixture();
  try {
    const runtime = detectPortableRuntime(path.join(directory, 'yuzread-reader.exe'), '0.1.0');
    assert.equal(runtime.root, directory);
    const paths = portablePaths(runtime, 'reader');
    assert.equal(paths.userData, path.join(directory, 'data', 'reader'));
    assert.equal(paths.sessionData, path.join(directory, 'cache', 'reader', 'chromium'));
    assert.equal(paths.readerCache, path.join(directory, 'cache', 'reader', 'archive'));
    assert.equal(paths.logs, path.join(directory, 'logs', 'reader'));
    assert.equal(paths.crashDumps, path.join(directory, 'crash-dumps', 'reader'));
    assert.equal(paths.temp, path.join(directory, 'cache', 'reader', 'temp'));
    const qa = portablePaths(runtime, 'reader', 'proof');
    assert.ok(qa.userData.startsWith(path.join(directory, '.qa', 'proof', 'reader')));
    assert.throws(() => portablePaths(runtime, '../reader'));
    assert.throws(() => portablePaths(runtime, 'reader', '../proof'));
    assert.equal(detectPortableRuntime(path.join(root, 'missing.exe'), '0.1.0'), null);
    assert.throws(() => detectPortableRuntime(path.join(directory, 'yuzread-reader.exe'), '0.2.0'));
  } finally {
    cleanup(directory);
  }
});

test('portable startup preserves data, clears role cache and bounds local logs/crashes', () => {
  const directory = fixture();
  try {
    const runtime = detectPortableRuntime(path.join(directory, 'yuzread-reader.exe'), '0.1.0');
    const paths = portablePaths(runtime, 'reader');
    fs.mkdirSync(paths.userData, { recursive: true });
    fs.writeFileSync(path.join(paths.userData, 'keep.json'), '{"keep":true}');
    fs.mkdirSync(path.dirname(paths.sessionData), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(paths.sessionData), 'stale.cache'), 'stale');
    for (const [owner, count] of [
      [paths.logs, 12],
      [paths.crashDumps, 8],
    ]) {
      fs.mkdirSync(owner, { recursive: true });
      for (let index = 0; index < count; index++) {
        const file = path.join(owner, `${index}.bin`);
        fs.writeFileSync(file, Buffer.alloc(1024));
        fs.utimesSync(
          file,
          new Date(Date.now() - index * 1000),
          new Date(Date.now() - index * 1000),
        );
      }
    }
    preparePortablePrimaryRuntime(paths);
    assert.equal(fs.readFileSync(path.join(paths.userData, 'keep.json'), 'utf8'), '{"keep":true}');
    assert.equal(fs.existsSync(path.join(path.dirname(paths.sessionData), 'stale.cache')), false);
    for (const directoryPath of [paths.sessionData, paths.readerCache, paths.temp])
      assert.equal(fs.statSync(directoryPath).isDirectory(), true);
    assert.ok(
      fs
        .globSync('**/*', { cwd: paths.logs })
        .filter((file) => fs.statSync(path.join(paths.logs, file)).isFile()).length <= 8,
    );
    assert.ok(
      fs
        .globSync('**/*', { cwd: paths.crashDumps })
        .filter((file) => fs.statSync(path.join(paths.crashDumps, file)).isFile()).length <= 5,
    );
  } finally {
    cleanup(directory);
  }
});

test('portable dependency guard accepts local packages and rejects parent fallback', () => {
  assert.doesNotThrow(() => assertPortableDependencies(root));
  const directory = fixture();
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), '{"name":"fixture"}');
    assert.throws(() => assertPortableDependencies(directory), /escaped package/);
  } finally {
    cleanup(directory);
  }
});
