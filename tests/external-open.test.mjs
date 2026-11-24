import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReaderExternalOpenQueue,
  externalCbzArguments,
} from '../electron-built/reader/ReaderExternalOpen.cjs';

// CONFIG AND CONTRACT — command-line parsing/queue only; no renderer path exposure.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const tempRoot = path.join(root, '.agents-temp');

test('external CBZ command lines accept canonical files and reject invalid/missing/non-CBZ values', () => {
  fs.mkdirSync(tempRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(tempRoot, 'external-open-'));
  try {
    const lower = path.join(directory, 'chapter 1.cbz');
    const upper = path.join(directory, 'chapter 2.CBZ');
    const text = path.join(directory, 'notes.txt');
    fs.writeFileSync(lower, 'first');
    fs.writeFileSync(upper, 'second');
    fs.writeFileSync(text, 'text');
    assert.deepEqual(
      externalCbzArguments([
        'electron.exe',
        '--original-process-start-time=1',
        lower,
        text,
        upper,
        lower,
        path.join(directory, 'missing.cbz'),
        'relative.cbz',
        `${lower}\0bad`,
      ]),
      [fs.realpathSync.native(lower), fs.realpathSync.native(upper)],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    if (fs.readdirSync(tempRoot).length === 0) fs.rmdirSync(tempRoot);
  }
});

test('external queue is FIFO, deduplicated, revisioned and bounded without exposing storage', () => {
  fs.mkdirSync(tempRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(tempRoot, 'external-queue-'));
  try {
    const files = Array.from({ length: 10 }, (_, index) => path.join(directory, `${index}.cbz`));
    files.forEach((file) => fs.writeFileSync(file, file));
    const queue = createReaderExternalOpenQueue([files[0], files[0], files[1]]);
    assert.equal(queue.revision(), 2);
    assert.equal(queue.size(), 2);
    queue.enqueue(files.slice(2));
    assert.equal(queue.revision(), 8);
    assert.equal(queue.size(), 8);
    assert.equal(queue.take(), fs.realpathSync.native(files[0]));
    assert.equal(queue.take(), fs.realpathSync.native(files[1]));
    assert.equal(queue.size(), 6);
    assert.deepEqual(Object.keys(queue).sort(), ['enqueue', 'revision', 'size', 'take']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    if (fs.readdirSync(tempRoot).length === 0) fs.rmdirSync(tempRoot);
  }
});
