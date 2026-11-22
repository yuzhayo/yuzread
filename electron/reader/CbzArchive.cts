import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import type { BrowserWindow } from 'electron';
import type { Entry, ZipFile } from 'yauzl';
import type {
  ChapterManifest,
  PageMetadata,
  ReaderOpenResult,
  ReaderOpenOptions,
  ReaderChapterResult,
  ReaderCatalog,
  Chapter,
  ReaderPrepareResult,
  Result,
} from '../../ShellHost.js';
import { errorText, isRecord } from '../WindowConfig.cjs';

// CONFIG AND CONTRACT — native archive work stays here, including its worker.
const SCHEME = 'yuzread-page';
const MAX_WIDTH = 8192,
  MAX_PENDING = 64,
  MB = 1048576;
export interface SourceFingerprint {
  size: string;
  mtimeNs: string;
  ctimeNs: string;
  dev: string;
  ino: string;
}
export async function captureSource(filePath: string): Promise<SourceFingerprint> {
  const stat = await fs.stat(filePath, { bigint: true });
  if (!stat.isFile()) throw new Error('CBZ is not a regular file');
  return {
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
}
export const revisionFor = (source: SourceFingerprint): string =>
  createHash('sha256').update(JSON.stringify(source)).digest('hex');
const sameSource = (a: SourceFingerprint, b: SourceFingerprint) =>
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs &&
  a.dev === b.dev &&
  a.ino === b.ino;
const fingerprint = (value: unknown): value is SourceFingerprint =>
  isRecord(value) &&
  ['size', 'mtimeNs', 'ctimeNs', 'dev', 'ino'].every(
    (key) => typeof value[key] === 'string' && /^-?\d+$/.test(value[key]),
  );
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
async function assertSource(filePath: string, source: SourceFingerprint): Promise<void> {
  if (!sameSource(await captureSource(filePath), source))
    throw new Error('CBZ source changed; reopen the archive');
}
const cacheFile = (
  directory: string,
  variant: Pick<PreparedPage, 'sourceRevision' | 'pageId' | 'width'>,
) => {
  const identity = createHash('sha256')
    .update(JSON.stringify([variant.sourceRevision, variant.pageId, variant.width]))
    .digest('hex');
  return path.join(directory, `${identity}-${variant.width}.png`);
};
async function fileDigest(file: FileHandle): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) {
    const bytes: unknown = chunk;
    if (!Buffer.isBuffer(bytes)) throw new Error('Invalid cached PNG stream');
    hash.update(bytes);
  }
  return hash.digest('hex');
}
async function verifyCache(directory: string, variant: PreparedPage): Promise<boolean> {
  let file: FileHandle | undefined;
  try {
    file = await fs.open(cacheFile(directory, variant), 'r');
    const stat = await file.stat();
    return (
      stat.isFile() && stat.size === variant.bytes && (await fileDigest(file)) === variant.sha256
    );
  } catch {
    return false;
  } finally {
    await file?.close();
  }
}
// Use the global web-stream type and the already verified descriptor. No Node/DOM
// stream assertion, pathname reopen, or whole-file buffer is needed for delivery.
function cachedBody(file: FileHandle, variant: PreparedPage): ReadableStream<Uint8Array> {
  let position = 0,
    closed = false;
  const hash = createHash('sha256');
  const close = async () => {
    if (!closed) {
      closed = true;
      await file.close();
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const buffer = new Uint8Array(Math.min(65536, variant.bytes - position));
        const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, position);
        if (bytesRead <= 0) throw new Error('Incomplete cached page stream');
        const chunk = buffer.subarray(0, bytesRead);
        position += bytesRead;
        hash.update(chunk);
        controller.enqueue(chunk);
        if (position === variant.bytes) {
          if (hash.digest('hex') !== variant.sha256)
            throw new Error('Cached page changed during delivery');
          await close();
          controller.close();
        }
      } catch (error) {
        await close();
        controller.error(error);
      }
    },
    cancel: close,
  });
}
interface IndexedEntry extends Entry {
  index: number;
}
interface WorkerSettings {
  maxArchiveEntries: number;
  maxEntryBytes: number;
  headerBytes: number;
  maxInputPixels: number;
  maxDecodedBytes: number;
}
interface ArchiveWorkerData {
  filePath: string;
  directory: string;
  renderWidth: number;
  maxDecodeWidth: number;
  source: SourceFingerprint;
  sourceRevision: string;
  settings: WorkerSettings;
}
type WorkerRequest =
  | { requestId: number; operation: 'open' }
  | { requestId: number; operation: 'prepare'; index: number; decodeWidth: number };
interface PreparedPage {
  index: number;
  width: number;
  height: number;
  pageId: string;
  sourceRevision: string;
  bytes: number;
  sha256: string;
}
type WorkerReply =
  | { requestId: number; ok: true; value: ChapterManifest | PreparedPage }
  | { requestId: number; ok: false; error: string };
type PendingRequest =
  | { operation: 'open'; resolve: (value: ChapterManifest) => void; reject: (error: Error) => void }
  | {
      operation: 'prepare';
      resolve: (value: PreparedPage) => void;
      reject: (error: Error) => void;
    };
interface ArchiveSession {
  catalogId: string;
  entryId: string;
  chapter?: Chapter;
  worker: Worker;
  directory: string;
  ready: Map<string, PreparedPage>;
  pendingVariants: Map<string, Promise<PreparedPage>>;
  filePath: string;
  source: SourceFingerprint;
  sourceRevision: string;
  maxDecodeWidth: number;
  pages: PageMetadata[];
  renderWidth: number;
  pageCount: number;
  rejectAll: (error: Error) => void;
  request(operation: 'open'): Promise<ChapterManifest>;
  request(operation: 'prepare', index: number, decodeWidth: number): Promise<PreparedPage>;
}
interface CatalogEntry {
  id: string;
  name: string;
  filePath: string;
  source: SourceFingerprint | null;
}
interface ArchiveCatalog {
  id: string;
  entries: CatalogEntry[];
  options: ReaderOpenOptions;
  requests: Map<string, { width: number; task: Promise<ReaderChapterResult> }>;
}
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;
const pageMetadata = (value: unknown): value is PageMetadata =>
  isRecord(value) &&
  digest(value.id) &&
  typeof value.name === 'string' &&
  typeof value.index === 'number' &&
  Number.isInteger(value.index) &&
  value.index >= 0 &&
  positive(value.width) &&
  positive(value.height) &&
  positive(value.targetWidth) &&
  positive(value.targetHeight);
const isManifest = (value: unknown): value is ChapterManifest =>
  isRecord(value) &&
  digest(value.sourceRevision) &&
  typeof value.name === 'string' &&
  typeof value.estimatedBytes === 'number' &&
  Array.isArray(value.pages) &&
  value.pages.every(pageMetadata);
const isPrepared = (value: unknown): value is PreparedPage =>
  isRecord(value) &&
  typeof value.index === 'number' &&
  Number.isInteger(value.index) &&
  value.index >= 0 &&
  positive(value.width) &&
  value.width <= MAX_WIDTH &&
  positive(value.height) &&
  digest(value.pageId) &&
  digest(value.sourceRevision) &&
  positive(value.bytes) &&
  digest(value.sha256);
const isWorkerData = (value: unknown): value is ArchiveWorkerData =>
  isRecord(value) &&
  typeof value.filePath === 'string' &&
  typeof value.directory === 'string' &&
  positive(value.renderWidth) &&
  positive(value.maxDecodeWidth) &&
  value.renderWidth <= value.maxDecodeWidth &&
  value.maxDecodeWidth <= MAX_WIDTH &&
  fingerprint(value.source) &&
  digest(value.sourceRevision) &&
  revisionFor(value.source) === value.sourceRevision &&
  isRecord(value.settings) &&
  positive(value.settings.maxArchiveEntries) &&
  positive(value.settings.maxEntryBytes) &&
  positive(value.settings.headerBytes) &&
  positive(value.settings.maxInputPixels) &&
  positive(value.settings.maxDecodedBytes) &&
  value.settings.maxDecodedBytes >= 64 * MB &&
  value.settings.maxDecodedBytes <= 4096 * MB &&
  value.settings.maxArchiveEntries <= 10000 &&
  value.settings.maxEntryBytes <= 128 * MB &&
  value.settings.headerBytes <= 262144 &&
  value.settings.maxInputPixels <= 100000000;
const isWorkerRequest = (value: unknown): value is WorkerRequest =>
  isRecord(value) &&
  positive(value.requestId) &&
  (value.operation === 'open' ||
    (value.operation === 'prepare' &&
      typeof value.index === 'number' &&
      Number.isInteger(value.index) &&
      positive(value.decodeWidth) &&
      value.decodeWidth <= MAX_WIDTH));
const supportedPage = /\.(png|jpe?g|webp|gif|avif|tiff?)$/i;
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export const compareChapterNames = (a: string, b: string): number =>
  natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const openOptions = (value: unknown): value is ReaderOpenOptions =>
  isRecord(value) &&
  positive(value.renderWidth) &&
  positive(value.maxDecodeWidth) &&
  value.renderWidth <= value.maxDecodeWidth &&
  value.maxDecodeWidth <= MAX_WIDTH &&
  positive(value.maxDecodedMB) &&
  value.maxDecodedMB >= 64 &&
  value.maxDecodedMB <= 4096 &&
  Object.keys(value).every((key) =>
    ['renderWidth', 'maxDecodeWidth', 'maxDecodedMB'].includes(key),
  );
const ordered = (a: IndexedEntry, b: IndexedEntry) =>
  natural.compare(a.fileName, b.fileName) ||
  (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : a.index - b.index);

// LOGIC — WORKER: header pass, natural order and one sequential decode queue.
async function runArchiveWorker() {
  const rawData: unknown = workerData;
  const port = parentPort;
  if (!port || !isWorkerData(rawData)) throw new Error('Invalid archive worker bootstrap');
  const data = rawData;
  const yauzl = await import('yauzl');
  const { default: sharp } = await import('sharp');
  sharp.concurrency(1);
  sharp.cache(false);
  let zip: ZipFile | undefined,
    entries: IndexedEntry[] = [],
    manifest: PageMetadata[] = [],
    outputWidth = data.renderWidth;
  const settings = data.settings;
  const variants = new Map<string, PreparedPage>(),
    variantCosts = new Map<string, number>(),
    inputCosts = new Map<number, number>();
  let initialReserved = 0,
    extraReserved = 0,
    indexed = false;
  const imageOptions = { limitInputPixels: settings.maxInputPixels, failOn: 'error' } as const;
  const bytes = async (entry: IndexedEntry, maximum = settings.maxEntryBytes): Promise<Buffer> => {
    const archive = zip;
    if (!archive) throw new Error('Archive is not open');
    const headerOnly = maximum < entry.uncompressedSize;
    if (!headerOnly && entry.uncompressedSize * 2 + MB > settings.maxDecodedBytes)
      throw new Error('Page input buffer exceeds the configured decoded budget');
    const stream = await new Promise<import('node:stream').Readable>((resolve, reject) =>
      archive.openReadStream(entry, (error, value) => {
        if (error || !value) reject(error ?? new Error('Archive stream unavailable'));
        else resolve(value);
      }),
    );
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for await (const chunk of stream) {
        const raw: unknown = chunk;
        if (!Buffer.isBuffer(raw)) throw new Error('Invalid page stream chunk');
        const part = headerOnly ? raw.subarray(0, maximum - length) : raw;
        if (!headerOnly && length + part.length > entry.uncompressedSize)
          throw new Error('CBZ page exceeds its declared entry size');
        chunks.push(part);
        length += part.length;
        if (headerOnly && length >= maximum) break;
      }
      if (!headerOnly && length !== entry.uncompressedSize)
        throw new Error('Incomplete CBZ page stream');
      return Buffer.concat(chunks, length);
    } finally {
      stream.destroy();
    }
  };
  async function open(): Promise<ChapterManifest> {
    if (zip || indexed) throw new Error('Archive was already indexed');
    await assertSource(data.filePath, data.source);
    const archive = await new Promise<ZipFile>((resolve, reject) =>
      yauzl.open(
        data.filePath,
        { lazyEntries: true, autoClose: false, validateEntrySizes: true },
        (error, value) => {
          if (error || !value) reject(error ?? new Error('Archive unavailable'));
          else resolve(value);
        },
      ),
    );
    zip = archive;
    archive.on('error', () => {});
    entries = await new Promise<IndexedEntry[]>((resolve, reject) => {
      const found: IndexedEntry[] = [];
      let count = 0;
      archive.once('error', reject);
      archive.on('entry', (entry: Entry) => {
        count++;
        if (count > settings.maxArchiveEntries) {
          reject(new Error('CBZ contains too many archive entries'));
          archive.close();
          return;
        }
        if (
          supportedPage.test(entry.fileName) &&
          !entry.fileName.split('/').some((part) => part === '__MACOSX' || part.startsWith('.'))
        ) {
          if (entry.generalPurposeBitFlag & 1 || entry.uncompressedSize > settings.maxEntryBytes) {
            reject(
              new Error(
                `Page is encrypted or exceeds the configured entry limit: ${entry.fileName}`,
              ),
            );
            archive.close();
            return;
          }
          found.push(Object.assign(entry, { index: count }));
        }
        archive.readEntry();
      });
      archive.once('end', () => {
        archive.removeListener('error', reject);
        resolve(found.sort(ordered));
      });
      archive.readEntry();
    });
    if (!entries.length) throw new Error('This CBZ contains no supported page images');
    manifest = [];
    let estimatedBytes = 0;
    outputWidth = data.renderWidth;
    for (const [index, entry] of entries.entries()) {
      let metadata;
      try {
        metadata = await sharp(
          await bytes(entry, Math.min(entry.uncompressedSize, settings.headerBytes)),
          imageOptions,
        ).metadata();
      } catch {
        metadata = await sharp(await bytes(entry), imageOptions).metadata();
      }
      const oriented = metadata.autoOrient ?? metadata,
        width = oriented.width,
        height = oriented.height;
      if (!positive(width) || !positive(height) || width * height > settings.maxInputPixels)
        throw new Error(`Invalid page dimensions: ${entry.fileName}`);
      const targetWidth = Math.min(width, outputWidth),
        targetHeight = Math.max(1, Math.round((height * targetWidth) / width));
      estimatedBytes += targetWidth * targetHeight * 4;
      initialReserved += targetWidth * (targetHeight + 1) * 4;
      const depthBytes: Record<string, number> = {
        uchar: 1,
        char: 1,
        ushort: 2,
        short: 2,
        uint: 4,
        int: 4,
        float: 4,
        double: 8,
        complex: 8,
        dpcomplex: 16,
      };
      inputCosts.set(
        index,
        width *
          height *
          Math.max(4, metadata.channels ?? 4) *
          (depthBytes[metadata.depth ?? ''] ?? 8) +
          entry.uncompressedSize * 2 +
          MB,
      );
      const id = createHash('sha256')
        .update(
          JSON.stringify([
            entry.fileName,
            entry.crc32,
            entry.relativeOffsetOfLocalHeader,
            entry.compressedSize,
            entry.uncompressedSize,
            index,
          ]),
        )
        .digest('hex');
      manifest.push({ id, index, name: entry.fileName, width, height, targetWidth, targetHeight });
    }
    if (initialReserved > settings.maxDecodedBytes)
      throw new Error(
        `Chapter needs about ${Math.ceil(estimatedBytes / 1048576)} MB of decoded pages; configured limit is ${Math.round(settings.maxDecodedBytes / 1048576)} MB. Reduce window width or increase maxDecodedMB.`,
      );
    await assertSource(data.filePath, data.source);
    indexed = true;
    return {
      sourceRevision: data.sourceRevision,
      name: path.basename(data.filePath),
      pages: manifest,
      estimatedBytes,
    };
  }
  // CACHE — only completed, verified variants are reusable; display geometry is separate.
  async function prepare(index: number, decodeWidth: number): Promise<PreparedPage> {
    const page = manifest[index],
      entry = entries[index];
    if (!indexed || !Number.isInteger(index) || !page || !entry)
      throw new Error('Unknown CBZ page');
    if (!positive(decodeWidth) || decodeWidth > data.maxDecodeWidth)
      throw new Error('Decode width exceeds the authorized session limit');
    await assertSource(data.filePath, data.source);
    const target = Math.min(page.width, decodeWidth),
      height = Math.max(1, Math.round((page.height * target) / page.width)),
      key = `${page.id}-${target}`;
    const cached = variants.get(key);
    if (cached) {
      if (await verifyCache(data.directory, cached)) {
        await assertSource(data.filePath, data.source);
        return cached;
      }
      variants.delete(key);
      extraReserved -= variantCosts.get(key) ?? 0;
      variantCosts.delete(key);
    }
    const extraCost = target === page.targetWidth ? 0 : target * (height + 1) * 4,
      workspace = inputCosts.get(index);
    if (
      workspace === undefined ||
      !Number.isSafeInteger(extraCost) ||
      initialReserved + extraReserved + extraCost + workspace > settings.maxDecodedBytes
    )
      throw new Error(
        'Prepared variants and decode workspace exceed the configured chapter budget',
      );
    const identity = { sourceRevision: data.sourceRevision, pageId: page.id, width: target };
    const file = cacheFile(data.directory, identity),
      temporary = path.join(data.directory, `.prepare-${randomUUID()}.tmp`);
    try {
      const info = await sharp(await bytes(entry), imageOptions)
        .rotate()
        .resize({ width: target, withoutEnlargement: true })
        .png({ compressionLevel: 1 })
        .toFile(temporary);
      if (
        info.format !== 'png' ||
        info.width !== target ||
        !positive(info.height) ||
        Math.abs(info.height - height) > 1 ||
        !positive(info.size)
      )
        throw new Error('Prepared PNG dimensions are invalid');
      const handle = await fs.open(temporary, 'r');
      let sha256: string;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== info.size) throw new Error('Incomplete prepared PNG');
        sha256 = await fileDigest(handle);
      } finally {
        await handle.close();
      }
      await assertSource(data.filePath, data.source);
      const variant: PreparedPage = {
        index,
        ...identity,
        height: info.height,
        bytes: info.size,
        sha256,
      };
      // Same-directory rename is the publication boundary: never expose a partial output.
      await fs.rename(temporary, file);
      variants.set(key, variant);
      variantCosts.set(key, extraCost);
      extraReserved += extraCost;
      return variant;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  const send = (reply: WorkerReply) => port.postMessage(reply);
  let queue = Promise.resolve();
  let queued = 0;
  port.on('message', (message: unknown) => {
    if (queued >= MAX_PENDING) {
      send({
        requestId:
          isRecord(message) && typeof message.requestId === 'number' ? message.requestId : -1,
        ok: false,
        error: 'Archive worker queue is full',
      });
      return;
    }
    queued++;
    queue = queue.then(async () => {
      const requestId =
        isRecord(message) && typeof message.requestId === 'number' ? message.requestId : -1;
      try {
        if (!isWorkerRequest(message)) throw new Error('Unknown archive worker operation');
        const value =
          message.operation === 'open'
            ? await open()
            : await prepare(message.index, message.decodeWidth);
        send({ requestId, ok: true, value });
      } catch (error) {
        send({ requestId, ok: false, error: errorText(error) });
      } finally {
        queued--;
      }
    });
  });
}

// LOGIC — MAIN: typed lazy Electron adapters keep main APIs out of the worker.
export function registerReaderScheme() {
  const { protocol }: typeof import('electron') = require('electron');
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}
export function createCbzReader(window: BrowserWindow, runtimeDirectory: string) {
  const { dialog, protocol }: typeof import('electron') = require('electron');
  const sessions = new Map<string, ArchiveSession>(),
    catalogs = new Map<string, ArchiveCatalog>(),
    closing = new Map<string, Promise<void>>();
  let disposed = false,
    choosing = false;
  const active = (id: string, session: ArchiveSession) =>
    !disposed &&
    !window.isDestroyed() &&
    sessions.get(id) === session &&
    catalogs.has(session.catalogId);
  const assertActive = (id: string, session: ArchiveSession) => {
    if (!active(id, session)) throw new Error('Chapter was released or replaced');
  };
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url),
      match = /^\/([0-9a-f-]{36})\/(\d+)-(\d+)\.png$/.exec(url.pathname);
    const session = match?.[1] ? sessions.get(match[1]) : undefined;
    const index = match ? Number(match[2]) : -1,
      width = match ? Number(match[3]) : -1;
    const variant = session?.ready.get(`${index}-${width}`);
    if (
      request.method !== 'GET' ||
      url.hostname !== 'page' ||
      !session ||
      !variant ||
      !match?.[1] ||
      !active(match[1], session)
    )
      return new Response('Page unavailable', { status: 404 });
    let file: FileHandle | undefined;
    try {
      file = await fs.open(cacheFile(session.directory, variant), 'r');
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size !== variant.bytes ||
        (await fileDigest(file)) !== variant.sha256
      )
        throw new Error('Cached page integrity failed');
      if (!active(match[1], session) || session.ready.get(`${index}-${width}`) !== variant)
        throw new Error('Page token was released');
      // Stream the same verified descriptor, not a second pathname lookup.
      const response = new Response(cachedBody(file, variant), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(variant.bytes),
          'Cache-Control': 'no-store',
        },
      });
      file = undefined;
      return response;
    } catch {
      return new Response('Page unavailable', { status: 404 });
    } finally {
      await file?.close();
    }
  });
  const closeSession = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    session.ready.clear();
    session.pendingVariants.clear();
    session.rejectAll(new Error('Chapter closed'));
    await session.worker.terminate();
    await fs.rm(session.directory, { recursive: true, force: true });
  };
  const release = (id: string) => {
    const previous = closing.get(id);
    if (previous) return previous;
    const task = closeSession(id);
    closing.set(id, task);
    void task
      .finally(() => {
        if (closing.get(id) === task) closing.delete(id);
      })
      .catch(() => {});
    return task;
  };
  const releaseCatalog = async (id: string) => {
    const catalog = catalogs.get(id);
    if (!catalog) return;
    catalogs.delete(id); // Retire authorization before awaiting workers or queued opens.
    await Promise.allSettled(
      [...sessions].filter(([, session]) => session.catalogId === id).map(([key]) => release(key)),
    );
    await Promise.allSettled([...catalog.requests.values()].map((request) => request.task));
  };
  const assertCatalog = (catalog: ArchiveCatalog) => {
    if (disposed || window.isDestroyed() || catalogs.get(catalog.id) !== catalog)
      throw new Error('Reading catalog was released or replaced');
  };
  // CATALOG — canonical same-folder regular files only; opaque IDs and frozen order/stat identity.
  const authorize = async (
    selected: string,
    options: ReaderOpenOptions,
  ): Promise<{ catalog: ArchiveCatalog; entry: CatalogEntry }> => {
    const filePath = await fs.realpath(selected);
    if (path.extname(filePath).toLowerCase() !== '.cbz') throw new Error('Choose a .cbz file');
    const directory = path.dirname(filePath);
    const files = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.cbz')
      .sort((a, b) => compareChapterNames(a.name, b.name));
    if (files.length > 10000) throw new Error('Chapter folder exceeds the catalog limit');
    const entries: CatalogEntry[] = [];
    for (const file of files) {
      const target = path.join(directory, file.name);
      const source = await captureSource(target).catch(() => null);
      entries.push({ id: randomUUID(), name: file.name, filePath: target, source });
    }
    const entry = entries.find((entry) =>
      process.platform === 'win32'
        ? entry.filePath.toLowerCase() === filePath.toLowerCase()
        : entry.filePath === filePath,
    );
    if (!entry?.source) throw new Error('Selected CBZ is unavailable');
    const catalog: ArchiveCatalog = {
      id: randomUUID(),
      entries,
      options: { ...options },
      requests: new Map(),
    };
    if (disposed || window.isDestroyed()) throw new Error('Reader closed');
    catalogs.set(catalog.id, catalog);
    return { catalog, entry };
  };
  const openEntry = async (
    catalog: ArchiveCatalog,
    entry: CatalogEntry,
    options: ReaderOpenOptions,
  ): Promise<ReaderChapterResult> => {
    let id: string | undefined, directory: string | undefined;
    try {
      assertCatalog(catalog);
      if (!entry.source) throw new Error('Chapter file is unavailable');
      const filePath = entry.filePath,
        source = entry.source,
        sourceRevision = revisionFor(source);
      await assertSource(filePath, source);
      assertCatalog(catalog);
      id = randomUUID();
      directory = path.join(runtimeDirectory, `reader-${id}`);
      await fs.mkdir(directory, { recursive: true });
      if (disposed || catalogs.get(catalog.id) !== catalog) {
        await fs.rm(directory, { recursive: true, force: true });
        throw new Error('Reader closed');
      }
      const data: ArchiveWorkerData = {
        filePath,
        directory,
        renderWidth: options.renderWidth,
        maxDecodeWidth: options.maxDecodeWidth,
        source,
        sourceRevision,
        settings: {
          maxArchiveEntries: 10000,
          maxEntryBytes: 128 * 1048576,
          headerBytes: 262144,
          maxInputPixels: 100000000,
          maxDecodedBytes: options.maxDecodedMB * 1048576,
        },
      };
      const worker = new Worker(__filename, { workerData: data });
      const pending = new Map<number, PendingRequest>();
      let serial = 0,
        failure: Error | undefined;
      const rejectAll = (error: Error) => {
        failure = error;
        for (const entry of pending.values()) entry.reject(error);
        pending.clear();
      };
      worker.on('message', (message: unknown) => {
        if (!isRecord(message) || typeof message.requestId !== 'number') {
          rejectAll(new Error('Invalid worker reply'));
          return;
        }
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        if (message.ok === false && typeof message.error === 'string')
          request.reject(new Error(message.error));
        else if (message.ok === true && request.operation === 'open' && isManifest(message.value))
          request.resolve(message.value);
        else if (
          message.ok === true &&
          request.operation === 'prepare' &&
          isPrepared(message.value)
        )
          request.resolve(message.value);
        else request.reject(new Error('Invalid worker result for requested operation'));
      });
      worker.on('error', rejectAll);
      worker.on('exit', () => rejectAll(new Error('Archive worker stopped')));
      function request(operation: 'open'): Promise<ChapterManifest>;
      function request(
        operation: 'prepare',
        index: number,
        decodeWidth: number,
      ): Promise<PreparedPage>;
      function request(
        operation: 'open' | 'prepare',
        index?: number,
        decodeWidth?: number,
      ): Promise<ChapterManifest | PreparedPage> {
        if (failure) return Promise.reject(failure);
        if (pending.size >= MAX_PENDING)
          return Promise.reject(new Error('Archive request queue is full'));
        if (operation === 'open')
          return new Promise<ChapterManifest>((resolve, reject) => {
            const requestId = ++serial;
            pending.set(requestId, { operation, resolve, reject });
            worker.postMessage({ requestId, operation } satisfies WorkerRequest);
          });
        if (index === undefined || decodeWidth === undefined)
          return Promise.reject(new Error('Missing preparation settings'));
        return new Promise<PreparedPage>((resolve, reject) => {
          const requestId = ++serial;
          pending.set(requestId, { operation, resolve, reject });
          worker.postMessage({
            requestId,
            operation,
            index,
            decodeWidth,
          } satisfies WorkerRequest);
        });
      }
      const session: ArchiveSession = {
        catalogId: catalog.id,
        entryId: entry.id,
        worker,
        directory,
        ready: new Map(),
        pendingVariants: new Map(),
        filePath,
        source,
        sourceRevision,
        maxDecodeWidth: options.maxDecodeWidth,
        pages: [],
        renderWidth: options.renderWidth,
        pageCount: 0,
        rejectAll,
        request,
      };
      sessions.set(id, session);
      const chapter = await session.request('open');
      assertActive(id, session);
      if (chapter.sourceRevision !== sourceRevision) throw new Error('Archive revision mismatch');
      await assertSource(filePath, source);
      assertActive(id, session);
      session.pageCount = chapter.pages.length;
      session.pages = chapter.pages;
      const result: Chapter = { ...chapter, id, catalogId: catalog.id, entryId: entry.id };
      session.chapter = result;
      return { ok: true, chapter: result };
    } catch (error) {
      if (id) await release(id).catch(() => {});
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: errorText(error) };
    }
  };
  const readChapter = (
    catalog: ArchiveCatalog,
    entry: CatalogEntry,
    options: ReaderOpenOptions,
  ): Promise<ReaderChapterResult> => {
    const pending = catalog.requests.get(entry.id);
    if (pending)
      return pending.width === options.renderWidth
        ? pending.task
        : Promise.resolve({ ok: false, error: 'Chapter is already opening at another width' });
    const existing = [...sessions.values()].find(
      (session) => session.catalogId === catalog.id && session.entryId === entry.id,
    );
    if (existing?.chapter)
      return Promise.resolve(
        existing.renderWidth === options.renderWidth
          ? { ok: true, chapter: existing.chapter }
          : { ok: false, error: 'Chapter is already resident at another width' },
      );
    if (catalog.requests.size >= MAX_PENDING || sessions.size >= MAX_PENDING)
      return Promise.resolve({ ok: false, error: 'Chapter request limit reached' });
    const task = openEntry(catalog, entry, options);
    catalog.requests.set(entry.id, { width: options.renderWidth, task });
    void task
      .finally(() => {
        if (catalog.requests.get(entry.id)?.task === task) catalog.requests.delete(entry.id);
      })
      .catch(() => {});
    return task;
  };
  return {
    async open(options: unknown): Promise<ReaderOpenResult> {
      if (disposed || choosing) return { ok: false, error: 'Another Open operation is active' };
      if (!openOptions(options)) return { ok: false, error: 'Invalid reader preparation settings' };
      choosing = true;
      let authorized: ArchiveCatalog | undefined;
      try {
        const selection = await dialog.showOpenDialog(window, {
          title: 'Open CBZ',
          properties: ['openFile'],
          filters: [{ name: 'Comic book archive', extensions: ['cbz'] }],
        });
        const selected = selection.filePaths[0];
        if (selection.canceled || !selected) return { ok: true, canceled: true };
        if (disposed || window.isDestroyed()) throw new Error('Reader closed');
        const { catalog, entry } = await authorize(selected, options);
        authorized = catalog;
        const result = await readChapter(catalog, entry, options);
        if (!result.ok) throw new Error(result.error);
        assertCatalog(catalog);
        const publicCatalog: ReaderCatalog = {
          id: catalog.id,
          chapters: catalog.entries.map(({ id, name }) => ({ id, name })),
        };
        return { ...result, catalog: publicCatalog };
      } catch (error) {
        if (authorized) await releaseCatalog(authorized.id);
        return { ok: false, error: errorText(error) };
      } finally {
        choosing = false;
      }
    },
    async chapter(
      catalogId: unknown,
      entryId: unknown,
      options: unknown,
    ): Promise<ReaderChapterResult> {
      const catalog = typeof catalogId === 'string' ? catalogs.get(catalogId) : undefined;
      const entry =
        catalog && typeof entryId === 'string'
          ? catalog.entries.find((entry) => entry.id === entryId)
          : undefined;
      if (disposed || !catalog || !entry)
        return { ok: false, error: 'Unauthorized chapter identity' };
      if (
        !openOptions(options) ||
        options.maxDecodeWidth !== catalog.options.maxDecodeWidth ||
        options.maxDecodedMB !== catalog.options.maxDecodedMB
      )
        return { ok: false, error: 'Invalid or unauthorized chapter settings' };
      return readChapter(catalog, entry, options);
    },
    async prepare(id: unknown, index: unknown, decodeWidth: unknown): Promise<ReaderPrepareResult> {
      const session = typeof id === 'string' ? sessions.get(id) : undefined;
      if (
        !session ||
        typeof id !== 'string' ||
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= session.pageCount
      )
        return { ok: false, error: 'Chapter/page unavailable' };
      if (!positive(decodeWidth) || decodeWidth > MAX_WIDTH || decodeWidth > session.maxDecodeWidth)
        return { ok: false, error: 'Invalid or unauthorized decode width' };
      const page = session.pages[index];
      if (!page) return { ok: false, error: 'Page metadata unavailable' };
      const width = Math.min(page.width, decodeWidth),
        height = Math.max(1, Math.round((page.height * width) / page.width)),
        key = `${index}-${width}`;
      try {
        assertActive(id, session);
        await assertSource(session.filePath, session.source);
        assertActive(id, session);
        let task = session.pendingVariants.get(key);
        if (!task) {
          task = session.request('prepare', index, width).then(async (variant) => {
            if (
              variant.index !== index ||
              variant.pageId !== page.id ||
              variant.sourceRevision !== session.sourceRevision ||
              variant.width !== width ||
              Math.abs(variant.height - height) > 1
            )
              throw new Error('Prepared page identity/dimensions mismatch');
            await assertSource(session.filePath, session.source);
            assertActive(id, session);
            const accepted = session.ready.get(key);
            if (
              accepted &&
              accepted.sha256 === variant.sha256 &&
              accepted.bytes === variant.bytes &&
              accepted.height === variant.height
            )
              return accepted;
            session.ready.set(key, variant);
            return variant;
          });
          session.pendingVariants.set(key, task);
          const currentTask = task;
          void task
            .finally(() => {
              if (session.pendingVariants.get(key) === currentTask)
                session.pendingVariants.delete(key);
            })
            .catch(() => {});
        }
        const variant = await task;
        assertActive(id, session);
        return {
          ok: true,
          id,
          index,
          pageId: page.id,
          sourceRevision: session.sourceRevision,
          requestedWidth: decodeWidth,
          width: variant.width,
          height: variant.height,
          url: `${SCHEME}://page/${id}/${index}-${variant.width}.png`,
        };
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
    },
    async release(id: unknown): Promise<Result> {
      if (typeof id !== 'string') return { ok: false, error: 'Invalid chapter identity' };
      if (catalogs.has(id)) await releaseCatalog(id);
      else await release(id);
      return { ok: true };
    },
    async dispose() {
      disposed = true;
      await Promise.allSettled([...catalogs.keys()].map(releaseCatalog));
      await Promise.allSettled([...sessions.keys()].map(release));
      await Promise.allSettled([...closing.values()]);
      protocol.unhandle(SCHEME);
    },
  };
}
if (!isMainThread)
  void runArchiveWorker().catch((error: unknown) => {
    throw error;
  });
