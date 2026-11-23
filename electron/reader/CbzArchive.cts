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
  ReaderWorkPriority,
  ReaderBudget,
  Failure,
  Result,
  ReaderMetricEvent,
  ReaderMetricValue,
  ReaderPickerSettings,
} from '../../ShellHost.js';
import { errorText, isRecord } from '../WindowConfig.cjs';

// CONFIG AND CONTRACT — native archive work stays here, including its worker.
const SCHEME = 'yuzread-page';
const MAX_WIDTH = 8192,
  MAX_PENDING = 64,
  MB = 1048576;
const WORKER_BYTES = 8 * MB,
  SURFACE_BYTES = 8;
class DeferredDecodeError extends Error {}
class CancelledDecodeError extends Error {}
export const readerWorkRank = (priority: ReaderWorkPriority): number =>
  priority === 'demand' ? 0 : priority === 'visible' ? 1 : 2;
const workPriority = (value: unknown): value is ReaderWorkPriority =>
  value === 'demand' || value === 'visible' || value === 'background';

// DIAGNOSTICS — an opt-in bounded log, separate from shell/config issue records.
const metricValue = (value: unknown): value is ReaderMetricValue =>
  typeof value === 'boolean' ||
  (typeof value === 'string' && value.length <= 128) ||
  (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12);
export const isReaderMetricEvent = (value: unknown): value is ReaderMetricEvent =>
  isRecord(value) &&
  typeof value.kind === 'string' &&
  ['image', 'attach', 'frame-gap', 'frame-summary', 'long-task', 'scroll-jump', 'motion'].includes(
    value.kind,
  ) &&
  typeof value.clockMs === 'number' &&
  Number.isFinite(value.clockMs) &&
  value.clockMs >= 0 &&
  value.clockMs <= 1e12 &&
  Object.keys(value).every((key) => ['kind', 'clockMs', 'values'].includes(key)) &&
  isRecord(value.values) &&
  Object.keys(value.values).length <= 16 &&
  Object.entries(value.values).every(
    ([key, item]) => /^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(key) && metricValue(item),
  );
export function readerDiagnosticsEnabled(config: unknown): boolean {
  if (!isRecord(config) || !Array.isArray(config.areas)) return false;
  return config.areas.some(
    (area: unknown) =>
      isRecord(area) &&
      area.enabled === true &&
      Array.isArray(area.children) &&
      area.children.some(
        (child: unknown) =>
          isRecord(child) &&
          child.enabled === true &&
          child.componentId === 'reader.cbz' &&
          child.diagnostics === true,
      ),
  );
}
interface ReaderLogEvent {
  kind: string;
  clockMs: number;
  values: Record<string, ReaderMetricValue>;
}
export function createReaderDiagnosticLog(filePath: string, maximumBytes = 4 * MB) {
  const pending: string[] = [];
  let timer: NodeJS.Timeout | null = null,
    writing: Promise<Result> | null = null;
  let size: number | undefined,
    dropped = 0,
    capped = false,
    closed = false,
    failed = false;
  const line = (source: 'native' | 'renderer', event: ReaderLogEvent) =>
    JSON.stringify({ source, at: new Date().toISOString(), ...event }) + '\n';
  const schedule = () => {
    if (timer || writing || !pending.length || closed || failed || capped) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 500);
    timer.unref();
  };
  const record = (source: 'native' | 'renderer', event: ReaderLogEvent) => {
    if (closed || failed || capped) return;
    if (pending.length >= 256) {
      dropped++;
      return;
    }
    pending.push(line(source, event));
    schedule();
  };
  const flush = (): Promise<Result> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (writing) return writing.then(() => flush());
    if (failed) return Promise.resolve({ ok: false, error: 'Reader diagnostics log unavailable' });
    if (!pending.length || capped) return Promise.resolve({ ok: true });
    const batch = pending.splice(0);
    if (dropped) {
      batch.push(
        line('native', { kind: 'dropped', clockMs: performance.now(), values: { count: dropped } }),
      );
      dropped = 0;
    }
    batch.push(
      line('native', {
        kind: 'memory',
        clockMs: performance.now(),
        values: { mainProcessRssBytes: process.memoryUsage.rss(), scope: 'main-process-only' },
      }),
    );
    const task = (async (): Promise<Result> => {
      if (size === undefined) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        size = await fs
          .stat(filePath)
          .then((stat) => stat.size)
          .catch(() => 0);
      }
      let output = '';
      for (const item of batch) {
        const bytes = Buffer.byteLength(item);
        if (size + Buffer.byteLength(output) + bytes > maximumBytes - 256) {
          capped = true;
          break;
        }
        output += item;
      }
      if (capped) {
        const notice = line('native', {
          kind: 'log-cap',
          clockMs: performance.now(),
          values: { limitBytes: maximumBytes },
        });
        if (size + Buffer.byteLength(output) + Buffer.byteLength(notice) <= maximumBytes)
          output += notice;
        pending.length = 0;
      }
      if (output) {
        await fs.appendFile(filePath, output, 'utf8');
        size += Buffer.byteLength(output);
      }
      return { ok: true };
    })().catch((): Result => {
      failed = true;
      pending.length = 0;
      return { ok: false, error: 'Reader diagnostics log unavailable' };
    });
    writing = task;
    void task.finally(() => {
      writing = null;
      schedule();
    });
    return task;
  };
  return {
    record,
    flush,
    async close() {
      closed = true;
      return flush();
    },
  };
}
interface ReaderWorkObservation {
  key: string;
  owner: string;
  priority: ReaderWorkPriority;
  queuedMs: number;
  workMs: number;
  outcome: string;
}

// SCHEDULER — one native queue for every catalog/worker, with one active operation.
// An active page finishes normally; queued demand wins at the next job boundary.
export function createReaderScheduler(
  maximum = MAX_PENDING,
  observe?: (sample: ReaderWorkObservation) => void,
) {
  interface Job {
    key: string;
    owner: string;
    priority: ReaderWorkPriority;
    serial: number;
    queuedAt: number;
    execute(): Promise<void>;
    cancel(error: Error): void;
  }
  const jobs = new Map<string, Job>();
  let serial = 0,
    active: Job | null = null,
    scheduled = false,
    disposed = false;
  const drain = () => {
    if (active || scheduled || disposed || !jobs.size) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      if (disposed || active) return;
      const job = [...jobs.values()].sort(
        (a, b) => readerWorkRank(a.priority) - readerWorkRank(b.priority) || a.serial - b.serial,
      )[0];
      if (!job) return;
      jobs.delete(job.key);
      active = job;
      void job.execute().finally(() => {
        active = null;
        drain();
      });
    });
  };
  return {
    run<T>(
      key: string,
      owner: string,
      priority: ReaderWorkPriority,
      operation: () => Promise<T>,
    ): Promise<T> {
      if (disposed) return Promise.reject(new Error('Reader scheduler closed'));
      if (jobs.size >= maximum)
        return Promise.reject(new DeferredDecodeError('Reader work queue is full'));
      if (jobs.has(key) || active?.key === key)
        return Promise.reject(new Error('Duplicate reader work key'));
      return new Promise<T>((resolve, reject) => {
        jobs.set(key, {
          key,
          owner,
          priority,
          serial: ++serial,
          queuedAt: observe ? performance.now() : 0,
          cancel: reject,
          async execute() {
            const start = observe ? performance.now() : 0;
            let outcome = 'ok';
            try {
              resolve(await operation());
            } catch (error) {
              outcome =
                error instanceof DeferredDecodeError
                  ? 'deferred'
                  : error instanceof CancelledDecodeError
                    ? 'cancelled'
                    : 'error';
              reject(error);
            } finally {
              if (observe)
                try {
                  observe({
                    key,
                    owner,
                    priority: this.priority,
                    queuedMs: start - this.queuedAt,
                    workMs: performance.now() - start,
                    outcome,
                  });
                } catch {}
            }
          },
        });
        drain();
      });
    },
    promote(key: string, priority: ReaderWorkPriority) {
      const job = jobs.get(key);
      if (job && readerWorkRank(priority) < readerWorkRank(job.priority)) job.priority = priority;
    },
    cancel(owner: string) {
      for (const [key, job] of jobs)
        if (job.owner === owner) {
          jobs.delete(key);
          job.cancel(new CancelledDecodeError('Reader work owner released'));
          if (observe)
            try {
              observe({
                key,
                owner,
                priority: job.priority,
                queuedMs: performance.now() - job.queuedAt,
                workMs: 0,
                outcome: 'cancelled',
              });
            } catch {}
        }
    },
    snapshot() {
      return { activeJobs: active ? 1 : 0, queuedJobs: jobs.size };
    },
    dispose() {
      disposed = true;
      for (const job of jobs.values())
        job.cancel(new CancelledDecodeError('Reader scheduler closed'));
      jobs.clear();
    },
  };
}
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
const tileDirectory = (
  directory: string,
  variant: Pick<PreparedPage, 'sourceRevision' | 'pageId' | 'width'>,
) => `${cacheFile(directory, variant)}.tiles`;
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
    file = await fs.open(
      variant.tiles
        ? path.join(tileDirectory(directory, variant), 'manifest.json')
        : cacheFile(directory, variant),
      'r',
    );
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.size !== variant.bytes ||
      (await fileDigest(file)) !== variant.sha256
    )
      return false;
    if (variant.tiles)
      for (const tile of variant.tiles) {
        const handle = await fs.open(path.join(tileDirectory(directory, variant), tile.file), 'r');
        try {
          const info = await handle.stat();
          if (
            !info.isFile() ||
            info.size !== tile.bytes ||
            (await fileDigest(handle)) !== tile.sha256
          )
            return false;
        } finally {
          await handle.close();
        }
      }
    return true;
  } catch {
    return false;
  } finally {
    await file?.close();
  }
}
// Use the global web-stream type and the already verified descriptor. No Node/DOM
// stream assertion, pathname reopen, or whole-file buffer is needed for delivery.
function cachedBody(
  file: FileHandle,
  variant: Pick<PreparedPage, 'bytes' | 'sha256'>,
): ReadableStream<Uint8Array> {
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
  tileCache: boolean;
  cachedVariants: PreparedPage[];
  filePath: string;
  directory: string;
  renderWidth: number;
  maxDecodeWidth: number;
  source: SourceFingerprint;
  sourceRevision: string;
  settings: WorkerSettings;
  diagnostics: boolean;
}
type WorkerRequest =
  | { requestId: number; operation: 'open'; availableBytes: number }
  | {
      requestId: number;
      operation: 'prepare';
      index: number;
      decodeWidth: number;
      availableBytes: number;
    };
interface PreparedPage {
  index: number;
  width: number;
  height: number;
  pageId: string;
  sourceRevision: string;
  bytes: number;
  sha256: string;
  tiles?: PreparedTile[];
  timing?: { inputMs: number; imageMs: number; cacheHit: boolean };
}
interface PreparedTile {
  index: number;
  file: string;
  left: number;
  top: number;
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
  offsetX: number;
  offsetY: number;
  bytes: number;
  sha256: string;
}
type WorkerReply =
  | { requestId: number; ok: true; value: ChapterManifest | PreparedPage; residentBytes: number }
  | { requestId: number; ok: false; error: string; deferred?: true; residentBytes: number };
type PendingRequest = { availableBytes: number } & (
  | { operation: 'open'; resolve: (value: ChapterManifest) => void; reject: (error: Error) => void }
  | {
      operation: 'prepare';
      resolve: (value: PreparedPage) => void;
      reject: (error: Error) => void;
    }
);
interface ArchiveSession {
  tileCache: boolean;
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
  request(operation: 'open', availableBytes: number): Promise<ChapterManifest>;
  request(
    operation: 'prepare',
    availableBytes: number,
    index: number,
    decodeWidth: number,
  ): Promise<PreparedPage>;
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
  cachedVariants: Map<string, PreparedPage>;
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
const isPrepared = (value: unknown): value is PreparedPage => {
  if (!isRecord(value)) return false;
  const { width, height } = value;
  return (
    isRecord(value) &&
    typeof value.index === 'number' &&
    Number.isInteger(value.index) &&
    value.index >= 0 &&
    positive(width) &&
    width <= MAX_WIDTH &&
    positive(height) &&
    digest(value.pageId) &&
    digest(value.sourceRevision) &&
    positive(value.bytes) &&
    digest(value.sha256) &&
    (value.tiles === undefined ||
      (Array.isArray(value.tiles) &&
        value.tiles.length > 0 &&
        value.tiles.length <= 10000 &&
        value.tiles.length === Math.ceil(width / 1024) * Math.ceil(height / 1024) &&
        value.tiles.every(
          (tile: unknown, index: number) =>
            isRecord(tile) &&
            typeof tile.file === 'string' &&
            /^\d+_\d+\.png$/.test(tile.file) &&
            typeof tile.index === 'number' &&
            Number.isInteger(tile.index) &&
            tile.index === index &&
            typeof tile.left === 'number' &&
            typeof tile.top === 'number' &&
            tile.left === (index % Math.ceil(width / 1024)) * 1024 &&
            tile.top === Math.floor(index / Math.ceil(width / 1024)) * 1024 &&
            positive(tile.width) &&
            positive(tile.height) &&
            tile.width === Math.min(1024, width - tile.left) &&
            tile.height === Math.min(1024, height - tile.top) &&
            positive(tile.encodedWidth) &&
            positive(tile.encodedHeight) &&
            typeof tile.offsetX === 'number' &&
            typeof tile.offsetY === 'number' &&
            tile.offsetX === (tile.left ? 1 : 0) &&
            tile.offsetY === (tile.top ? 1 : 0) &&
            tile.encodedWidth ===
              tile.width + tile.offsetX + (tile.left + tile.width < width ? 1 : 0) &&
            tile.encodedHeight ===
              tile.height + tile.offsetY + (tile.top + tile.height < height ? 1 : 0) &&
            positive(tile.bytes) &&
            digest(tile.sha256),
        )))
  );
};
const isWorkerData = (value: unknown): value is ArchiveWorkerData =>
  isRecord(value) &&
  typeof value.diagnostics === 'boolean' &&
  typeof value.tileCache === 'boolean' &&
  Array.isArray(value.cachedVariants) &&
  value.cachedVariants.length <= 10000 &&
  value.cachedVariants.every(isPrepared) &&
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
  typeof value.availableBytes === 'number' &&
  Number.isSafeInteger(value.availableBytes) &&
  value.availableBytes >= 0 &&
  value.availableBytes <= 4096 * MB &&
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
const pickerOptions = (value: unknown): value is ReaderPickerSettings =>
  isRecord(value) &&
  (value.folderPath === undefined ||
    (typeof value.folderPath === 'string' &&
      value.folderPath.length <= 4096 &&
      !value.folderPath.includes('\0'))) &&
  (value.rememberFolder === undefined || typeof value.rememberFolder === 'boolean') &&
  Object.keys(value).every((key) => ['folderPath', 'rememberFolder'].includes(key));
const openOptions = (value: unknown): value is ReaderOpenOptions =>
  isRecord(value) &&
  positive(value.renderWidth) &&
  positive(value.maxDecodeWidth) &&
  value.renderWidth <= value.maxDecodeWidth &&
  value.maxDecodeWidth <= MAX_WIDTH &&
  positive(value.maxDecodedMB) &&
  value.maxDecodedMB >= 64 &&
  value.maxDecodedMB <= 4096 &&
  (value.picker === undefined || pickerOptions(value.picker)) &&
  (value.tileCache === undefined || typeof value.tileCache === 'boolean') &&
  Object.keys(value).every((key) =>
    ['renderWidth', 'maxDecodeWidth', 'maxDecodedMB', 'picker', 'tileCache'].includes(key),
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
    indexed = false,
    baseReserved = false,
    availableBytes = settings.maxDecodedBytes;
  const residentBytes = () => (baseReserved ? initialReserved : 0) + extraReserved;
  for (const variant of data.cachedVariants) {
    const key = `${variant.pageId}-${variant.width}`;
    variants.set(key, variant);
    variantCosts.set(key, variant.bytes);
    extraReserved += variant.bytes;
  }
  const imageOptions = { limitInputPixels: settings.maxInputPixels, failOn: 'error' } as const;
  const bytes = async (entry: IndexedEntry, maximum = settings.maxEntryBytes): Promise<Buffer> => {
    const archive = zip;
    if (!archive) throw new Error('Archive is not open');
    const headerOnly = maximum < entry.uncompressedSize;
    if (Math.min(entry.uncompressedSize, maximum) * 2 + MB > availableBytes)
      throw new DeferredDecodeError('Page input workspace exceeds the available reader budget');
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
      if (!data.tileCache) initialReserved += targetWidth * (targetHeight + 1) * SURFACE_BYTES;
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
        return data.diagnostics
          ? { ...cached, timing: { inputMs: 0, imageMs: 0, cacheHit: true } }
          : cached;
      }
      variants.delete(key);
      extraReserved -= variantCosts.get(key) ?? 0;
      variantCosts.delete(key);
    }
    if (data.tileCache) {
      if (Math.ceil(target / 1024) * Math.ceil(height / 1024) > 10000)
        throw new Error('Page exceeds the tile manifest limit');
      const workspace = inputCosts.get(index);
      if (workspace === undefined || extraReserved + workspace > availableBytes)
        throw new DeferredDecodeError('Tile generation workspace exceeds available reader budget');
      const identity = { sourceRevision: data.sourceRevision, pageId: page.id, width: target };
      const temporary = path.join(data.directory, `t-${randomUUID().replaceAll('-', '')}`);
      await fs.mkdir(temporary, { recursive: true });
      try {
        const start = performance.now();
        const input = await bytes(entry);
        const inputMs = performance.now() - start,
          imageStart = performance.now();
        const base = path.join(temporary, 'p');
        const info = await sharp(input, imageOptions)
          .rotate()
          .resize({ width: target, withoutEnlargement: true })
          .png({ compressionLevel: 1 })
          .tile({
            size: 1024,
            overlap: 1,
            depth: 'one',
            skipBlanks: -1,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .toFile(base);
        if (info.width !== target || !positive(info.height) || Math.abs(info.height - height) > 1)
          throw new Error('Prepared tile dimensions are invalid');
        const levels = (await fs.readdir(`${base}_files`, { withFileTypes: true })).filter(
          (e) => e.isDirectory() && /^\d+$/.test(e.name),
        );
        if (levels.length !== 1 || !levels[0])
          throw new Error('Expected one full-resolution tile level');
        const level = path.join(`${base}_files`, levels[0].name),
          tiles: PreparedTile[] = [];
        for (let top = 0; top < info.height; top += 1024)
          for (let left = 0; left < target; left += 1024) {
            const width = Math.min(1024, target - left),
              tileHeight = Math.min(1024, info.height - top),
              offsetX = left ? 1 : 0,
              offsetY = top ? 1 : 0;
            const file = `${left / 1024}_${top / 1024}.png`,
              tilePath = path.join(level, file),
              handle = await fs.open(tilePath, 'r');
            try {
              const stat = await handle.stat(),
                header = Buffer.alloc(24);
              await handle.read(header, 0, 24, 0);
              const encodedWidth = width + offsetX + (left + width < target ? 1 : 0),
                encodedHeight = tileHeight + offsetY + (top + tileHeight < info.height ? 1 : 0);
              if (
                !stat.isFile() ||
                !positive(stat.size) ||
                header.readUInt32BE(16) !== encodedWidth ||
                header.readUInt32BE(20) !== encodedHeight
              )
                throw new Error('Tile output is incomplete');
              tiles.push({
                index: tiles.length,
                file,
                left,
                top,
                width,
                height: tileHeight,
                encodedWidth,
                encodedHeight,
                offsetX,
                offsetY,
                bytes: stat.size,
                sha256: await fileDigest(handle),
              });
            } finally {
              await handle.close();
            }
          }
        const manifest = JSON.stringify(tiles),
          metadataBytes = Buffer.byteLength(manifest);
        if (extraReserved + metadataBytes * 2 > availableBytes)
          throw new DeferredDecodeError('Tile metadata exceeds reader budget');
        await fs.writeFile(path.join(level, 'manifest.json'), manifest, 'utf8');
        await assertSource(data.filePath, data.source);
        const destination = tileDirectory(data.directory, identity);
        await fs.rm(destination, { recursive: true, force: true });
        await fs.rename(level, destination);
        const variant: PreparedPage = {
          index,
          ...identity,
          height: info.height,
          bytes: metadataBytes,
          sha256: createHash('sha256').update(manifest).digest('hex'),
          tiles,
        };
        variants.set(key, variant);
        variantCosts.set(key, metadataBytes);
        extraReserved += metadataBytes;
        return data.diagnostics
          ? {
              ...variant,
              timing: { inputMs, imageMs: performance.now() - imageStart, cacheHit: false },
            }
          : variant;
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
    const extraCost = target === page.targetWidth ? 0 : target * (height + 1) * SURFACE_BYTES,
      workspace = inputCosts.get(index);
    if (
      workspace === undefined ||
      !Number.isSafeInteger(extraCost) ||
      initialReserved + extraReserved + extraCost + workspace > availableBytes
    )
      throw new DeferredDecodeError(
        'Prepared surfaces, variants and decode workspace exceed the available reader budget',
      );
    const identity = { sourceRevision: data.sourceRevision, pageId: page.id, width: target };
    const file = cacheFile(data.directory, identity),
      temporary = path.join(data.directory, `.prepare-${randomUUID()}.tmp`);
    baseReserved = true;
    try {
      const inputStart = data.diagnostics ? performance.now() : 0;
      const input = await bytes(entry);
      const inputMs = data.diagnostics ? performance.now() - inputStart : 0;
      const imageStart = data.diagnostics ? performance.now() : 0;
      const info = await sharp(input, imageOptions)
        .rotate()
        .resize({ width: target, withoutEnlargement: true })
        .png({ compressionLevel: 1 })
        .toFile(temporary);
      const imageMs = data.diagnostics ? performance.now() - imageStart : 0;
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
      return data.diagnostics
        ? { ...variant, timing: { inputMs, imageMs, cacheHit: false } }
        : variant;
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
        residentBytes: residentBytes(),
      });
      return;
    }
    queued++;
    queue = queue.then(async () => {
      const requestId =
        isRecord(message) && typeof message.requestId === 'number' ? message.requestId : -1;
      try {
        if (!isWorkerRequest(message)) throw new Error('Unknown archive worker operation');
        availableBytes = Math.min(settings.maxDecodedBytes, message.availableBytes);
        const value =
          message.operation === 'open'
            ? await open()
            : await prepare(message.index, message.decodeWidth);
        send({ requestId, ok: true, value, residentBytes: residentBytes() });
      } catch (error) {
        send({
          requestId,
          ok: false,
          error: errorText(error),
          residentBytes: residentBytes(),
          ...(error instanceof DeferredDecodeError ? { deferred: true } : {}),
        });
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
export function createCbzReader(
  window: BrowserWindow,
  runtimeDirectory: string,
  screenConfig?: unknown,
) {
  const { app, dialog, protocol, screen }: typeof import('electron') = require('electron');
  const diagnostics = readerDiagnosticsEnabled(screenConfig);
  const diagnosticLog = diagnostics
    ? createReaderDiagnosticLog(path.join(path.dirname(runtimeDirectory), 'reader-diagnostics.log'))
    : null;
  // LOAD PICKER — native persistence only; the Load child supplies the selection policy.
  const folderFile = path.join(path.dirname(runtimeDirectory), 'load-folder.json');
  const directory = async (value: unknown): Promise<string | undefined> => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 4096 ||
      !path.isAbsolute(value)
    )
      return undefined;
    return await fs
      .stat(value)
      .then((stat) => (stat.isDirectory() ? value : undefined))
      .catch(() => undefined);
  };
  const loadFolder = async (picker?: ReaderPickerSettings): Promise<string | undefined> => {
    const configured = await directory(picker?.folderPath);
    if (configured) return configured;
    if (picker?.rememberFolder === false) return undefined;
    try {
      const saved: unknown = JSON.parse(await fs.readFile(folderFile, 'utf8'));
      return isRecord(saved) ? directory(saved.folder) : undefined;
    } catch {
      return undefined;
    }
  };
  const sessions = new Map<string, ArchiveSession>(),
    catalogs = new Map<string, ArchiveCatalog>(),
    closing = new Map<string, Promise<void>>(),
    closingCatalogs = new Map<string, string>(),
    stopping = new Map<string, Promise<number>>(),
    reservations = new Map<string, number>(),
    renderReservations = new Map<string, number>();
  const scheduler = createReaderScheduler(
    MAX_PENDING,
    diagnosticLog
      ? (sample) => {
          diagnosticLog.record('native', {
            kind: 'work',
            clockMs: performance.now(),
            values: { ...sample, ...budget(), memoryMetric: 'estimated-admission' },
          });
        }
      : undefined,
  );
  let budgetLimit = 64 * MB;
  let gpuObserved = false;
  let grant: { owner: string; limitBytes: number } | null = null;
  const totalResident = () =>
    [...reservations.values(), ...renderReservations.values()].reduce(
      (sum, bytes) => sum + bytes,
      0,
    );
  const budget = (): ReaderBudget => ({
    limitBytes: budgetLimit,
    residentBytes: totalResident(),
    inFlightBytes: grant ? Math.max(0, grant.limitBytes - (reservations.get(grant.owner) ?? 0)) : 0,
    ...scheduler.snapshot(),
  });
  const failure = (error: unknown): Failure => {
    if (diagnosticLog)
      diagnosticLog.record('native', {
        kind: 'failure',
        clockMs: performance.now(),
        values: {
          outcome:
            error instanceof DeferredDecodeError
              ? 'deferred'
              : error instanceof CancelledDecodeError
                ? 'cancelled'
                : 'error',
          ...budget(),
          memoryMetric: 'estimated-admission',
        },
      });
    return {
      ok: false,
      error: errorText(error),
      budget: budget(),
      ...(error instanceof DeferredDecodeError
        ? { code: 'deferred' }
        : error instanceof CancelledDecodeError
          ? { code: 'cancelled' }
          : {}),
    };
  };
  const environment = () => {
    if (!diagnosticLog || window.isDestroyed()) return;
    const display = screen.getDisplayMatching(window.getBounds());
    diagnosticLog.record('native', {
      kind: 'environment',
      clockMs: performance.now(),
      values: {
        displayHz: display.displayFrequency,
        scaleFactor: display.scaleFactor,
        electron: process.versions.electron ?? 'unknown',
        chrome: process.versions.chrome ?? 'unknown',
        backend: 'sharp-cpu',
        frameMetric: 'raf-callback-cadence',
        presentedFrames: 'not-collected',
        gpuStatus: gpuObserved ? 'available-after-info-update' : 'not-observed',
      },
    });
  };
  const gpuInfo = () => {
    if (!diagnosticLog) return;
    gpuObserved = true;
    const status = app.getGPUFeatureStatus();
    diagnosticLog.record('native', {
      kind: 'gpu-features',
      clockMs: performance.now(),
      values: {
        compositing: status.gpu_compositing,
        rasterization: status.rasterization,
        videoDecode: status.video_decode,
        imageBackend: 'sharp-cpu',
      },
    });
  };
  if (diagnosticLog) {
    environment();
    app.on('gpu-info-update', gpuInfo);
  }
  const available = (catalog: ArchiveCatalog, id: string) =>
    Math.max(
      0,
      Math.min(
        catalog.options.maxDecodedMB * MB,
        budgetLimit - (totalResident() - (reservations.get(id) ?? 0)),
      ) - WORKER_BYTES,
    );
  const withGrant = async <T,>(
    catalog: ArchiveCatalog,
    id: string,
    operation: (bytes: number) => Promise<T>,
  ): Promise<T> => {
    const bytes = available(catalog, id);
    grant = { owner: id, limitBytes: bytes + WORKER_BYTES };
    try {
      return await operation(bytes);
    } finally {
      try {
        // A rejected request alone does not mean its worker has stopped. Keep
        // this scheduler slot/lease until retirement actually settles.
        const retired = closing.get(id) ?? stopping.get(id);
        if (retired) {
          try {
            await retired;
          } catch (error) {
            scheduler.dispose();
            throw error;
          }
        }
      } finally {
        grant = null;
      }
    }
  };
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
    const url = new URL(request.url);
    // Tile authority follows the catalog, not an evicted archive worker. No path is supplied by the screen.
    if (url.hostname === 'tile') {
      const match = /^\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f]{64})-(\d+)\/(\d+)\.png$/.exec(
        url.pathname,
      );
      const catalog = match?.[1] ? catalogs.get(match[1]) : undefined;
      const entry = catalog?.entries.find((entry) => entry.id === match?.[2]);
      const variant =
        match && catalog
          ? catalog.cachedVariants.get(`${match[2]}:${match[3]}:${match[4]}`)
          : undefined;
      const tile = match ? variant?.tiles?.[Number(match[5])] : undefined;
      if (request.method !== 'GET' || !catalog || !entry?.source || !variant || !tile)
        return new Response('Tile unavailable', { status: 404 });
      let file: FileHandle | undefined;
      try {
        assertCatalog(catalog);
        await assertSource(entry.filePath, entry.source);
        file = await fs.open(
          path.join(
            tileDirectory(
              path.join(
                runtimeDirectory,
                `catalog-${catalog.id}`,
                `e-${entry.id.replaceAll('-', '')}`,
              ),
              variant,
            ),
            tile.file,
          ),
          'r',
        );
        const info = await file.stat();
        if (!info.isFile() || info.size !== tile.bytes || (await fileDigest(file)) !== tile.sha256)
          throw new Error('Cached tile integrity failed');
        assertCatalog(catalog);
        if (
          catalog.cachedVariants.get(`${entry.id}:${variant.pageId}:${variant.width}`) !== variant
        )
          throw new Error('Cached tile was replaced');
        const response = new Response(cachedBody(file, tile), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(tile.bytes),
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': 'null',
          },
        });
        file = undefined;
        return response;
      } catch {
        return new Response('Tile unavailable', { status: 404 });
      } finally {
        await file?.close();
      }
    }
    const match = /^\/([0-9a-f-]{36})\/(\d+)-(\d+)(?:\.png|\/(\d+)\.png)$/.exec(url.pathname);
    const session = match?.[1] ? sessions.get(match[1]) : undefined;
    const index = match ? Number(match[2]) : -1,
      width = match ? Number(match[3]) : -1;
    const variant = session?.ready.get(`${index}-${width}`);
    const tile = match?.[4] !== undefined ? variant?.tiles?.[Number(match[4])] : undefined;
    if (
      request.method !== 'GET' ||
      url.hostname !== 'page' ||
      !session ||
      !variant ||
      !match?.[1] ||
      !active(match[1], session) ||
      (match[4] !== undefined ? !tile : !!variant.tiles)
    )
      return new Response('Page unavailable', { status: 404 });
    let file: FileHandle | undefined;
    try {
      const payload = tile ?? variant;
      file = await fs.open(
        tile
          ? path.join(tileDirectory(session.directory, variant), tile.file)
          : cacheFile(session.directory, variant),
        'r',
      );
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size !== payload.bytes ||
        (await fileDigest(file)) !== payload.sha256
      )
        throw new Error('Cached page integrity failed');
      if (!active(match[1], session) || session.ready.get(`${index}-${width}`) !== variant)
        throw new Error('Page token was released');
      // Stream the same verified descriptor, not a second pathname lookup.
      const response = new Response(cachedBody(file, payload), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(payload.bytes),
          'Cache-Control': 'no-store',
          // loadFile workers have an opaque origin; page tokens remain the authority.
          'Access-Control-Allow-Origin': 'null',
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
    scheduler.cancel(id);
    session.ready.clear();
    session.pendingVariants.clear();
    session.rejectAll(new Error('Chapter closed'));
    await (stopping.get(id) ?? session.worker.terminate());
    stopping.delete(id);
    reservations.delete(id); // Keep the estimate held until the worker genuinely stops.
    if (!session.tileCache || !catalogs.has(session.catalogId))
      await fs.rm(session.directory, { recursive: true, force: true });
  };
  const release = (id: string) => {
    const previous = closing.get(id);
    if (previous) return previous;
    const catalogId = sessions.get(id)?.catalogId;
    if (catalogId) closingCatalogs.set(id, catalogId);
    const task = closeSession(id);
    closing.set(id, task);
    void task
      .finally(() => {
        if (closing.get(id) === task) closing.delete(id);
        closingCatalogs.delete(id);
      })
      .catch(() => {});
    return task;
  };
  const releaseCatalog = async (id: string) => {
    const catalog = catalogs.get(id);
    if (!catalog) return;
    catalogs.delete(id); // Retire authorization before awaiting workers or queued opens.
    scheduler.cancel(id);
    await Promise.allSettled(
      [...sessions]
        .filter(([, session]) => session.catalogId === id)
        .map(([key]) => release(key))
        .concat(
          [...closing].filter(([key]) => closingCatalogs.get(key) === id).map(([, task]) => task),
        ),
    );
    await Promise.allSettled([...catalog.requests.values()].map((request) => request.task));
    reservations.delete(id);
    if (catalog.options.tileCache)
      await fs.rm(path.join(runtimeDirectory, `catalog-${catalog.id}`), {
        recursive: true,
        force: true,
      });
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
      cachedVariants: new Map(),
    };
    if (disposed || window.isDestroyed()) throw new Error('Reader closed');
    // A new authorized Open may raise the limit, but never shrink it under live
    // reservations. Equal configured budgets are shared, not multiplied by catalogs.
    budgetLimit =
      reservations.size || grant
        ? Math.max(budgetLimit, options.maxDecodedMB * MB)
        : options.maxDecodedMB * MB;
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
      directory = options.tileCache
        ? path.join(runtimeDirectory, `catalog-${catalog.id}`, `e-${entry.id.replaceAll('-', '')}`)
        : path.join(runtimeDirectory, `reader-${id}`);
      await fs.mkdir(directory, { recursive: true });
      if (disposed || catalogs.get(catalog.id) !== catalog) {
        await fs.rm(directory, { recursive: true, force: true });
        throw new Error('Reader closed');
      }
      if (available(catalog, id) < MB)
        throw new DeferredDecodeError('Reader budget cannot admit another archive worker');
      reservations.set(id, WORKER_BYTES);
      const data: ArchiveWorkerData = {
        filePath,
        directory,
        renderWidth: options.renderWidth,
        maxDecodeWidth: options.maxDecodeWidth,
        source,
        sourceRevision,
        diagnostics,
        tileCache: options.tileCache === true,
        cachedVariants: options.tileCache
          ? [...catalog.cachedVariants.entries()]
              .filter(([key]) => key.startsWith(`${entry.id}:`))
              .map(([, variant]) => variant)
          : [],
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
        if (
          typeof message.residentBytes !== 'number' ||
          !Number.isSafeInteger(message.residentBytes) ||
          message.residentBytes < 0 ||
          message.residentBytes > request.availableBytes
        ) {
          const error = new Error('Invalid worker resource accounting');
          request.reject(error);
          rejectAll(error);
          return;
        }
        reservations.set(sessionId, WORKER_BYTES + message.residentBytes);
        if (message.ok === false && typeof message.error === 'string')
          request.reject(
            message.deferred === true
              ? new DeferredDecodeError(message.error)
              : new Error(message.error),
          );
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
      worker.on('error', (error) => {
        rejectAll(error);
        const task = worker.terminate();
        stopping.set(sessionId, task);
        void task.catch(() => {
          scheduler.dispose();
        });
      });
      worker.on('exit', (code) => {
        stopping.set(sessionId, Promise.resolve(code));
        rejectAll(new Error('Archive worker stopped'));
      });
      function request(operation: 'open', availableBytes: number): Promise<ChapterManifest>;
      function request(
        operation: 'prepare',
        availableBytes: number,
        index: number,
        decodeWidth: number,
      ): Promise<PreparedPage>;
      function request(
        operation: 'open' | 'prepare',
        availableBytes: number,
        index?: number,
        decodeWidth?: number,
      ): Promise<ChapterManifest | PreparedPage> {
        if (failure) return Promise.reject(failure);
        if (pending.size >= MAX_PENDING)
          return Promise.reject(new Error('Archive request queue is full'));
        if (operation === 'open')
          return new Promise<ChapterManifest>((resolve, reject) => {
            const requestId = ++serial;
            pending.set(requestId, { operation, resolve, reject, availableBytes });
            worker.postMessage({ requestId, operation, availableBytes } satisfies WorkerRequest);
          });
        if (index === undefined || decodeWidth === undefined)
          return Promise.reject(new Error('Missing preparation settings'));
        return new Promise<PreparedPage>((resolve, reject) => {
          const requestId = ++serial;
          pending.set(requestId, { operation, resolve, reject, availableBytes });
          worker.postMessage({
            requestId,
            operation,
            index,
            decodeWidth,
            availableBytes,
          } satisfies WorkerRequest);
        });
      }
      const sessionId = id;
      const session: ArchiveSession = {
        tileCache: options.tileCache === true,
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
      const chapter = await withGrant(catalog, id, (bytes) => session.request('open', bytes));
      assertActive(id, session);
      if (chapter.sourceRevision !== sourceRevision) throw new Error('Archive revision mismatch');
      await assertSource(filePath, source);
      assertActive(id, session);
      session.pageCount = chapter.pages.length;
      session.pages = chapter.pages;
      const result: Chapter = { ...chapter, id, catalogId: catalog.id, entryId: entry.id };
      session.chapter = result;
      return { ok: true, chapter: result, budget: budget() };
    } catch (error) {
      if (id) await release(id).catch(() => {});
      if (id && !sessions.has(id) && !closing.has(id)) reservations.delete(id);
      if (directory && (!options.tileCache || !catalogs.has(catalog.id)))
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      return failure(error);
    }
  };
  const readChapter = (
    catalog: ArchiveCatalog,
    entry: CatalogEntry,
    options: ReaderOpenOptions,
    priority: ReaderWorkPriority,
  ): Promise<ReaderChapterResult> => {
    const pending = catalog.requests.get(entry.id);
    const key = `open:${catalog.id}:${entry.id}`;
    scheduler.promote(key, priority);
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
          ? { ok: true, chapter: existing.chapter, budget: budget() }
          : { ok: false, error: 'Chapter is already resident at another width' },
      );
    if (catalog.requests.size >= MAX_PENDING || sessions.size >= MAX_PENDING)
      return Promise.resolve({ ok: false, error: 'Chapter request limit reached' });
    const task = scheduler
      .run(key, catalog.id, priority, () => openEntry(catalog, entry, options))
      .catch(failure);
    catalog.requests.set(entry.id, { width: options.renderWidth, task });
    void task
      .finally(() => {
        if (catalog.requests.get(entry.id)?.task === task) catalog.requests.delete(entry.id);
      })
      .catch(() => {});
    return task;
  };
  return {
    async open(options: unknown, droppedPath?: unknown): Promise<ReaderOpenResult> {
      if (disposed || choosing) return { ok: false, error: 'Another Open operation is active' };
      if (!openOptions(options)) return { ok: false, error: 'Invalid reader preparation settings' };
      if (
        droppedPath !== undefined &&
        (typeof droppedPath !== 'string' ||
          !droppedPath ||
          droppedPath.length > 4096 ||
          droppedPath.includes('\0') ||
          !path.isAbsolute(droppedPath) ||
          path.extname(droppedPath).toLowerCase() !== '.cbz')
      )
        return { ok: false, error: 'Invalid dropped CBZ path' };
      environment();
      choosing = true;
      // The picker pauses the old reading context. Preserve accepted surfaces and
      // an active operation, but cancel its queued work so initial Open has priority.
      for (const key of catalogs.keys()) scheduler.cancel(key);
      for (const key of sessions.keys()) scheduler.cancel(key);
      let authorized: ArchiveCatalog | undefined;
      try {
        let selected: string;
        if (typeof droppedPath === 'string') selected = droppedPath;
        else {
          const defaultPath = await loadFolder(options.picker);
          const selection = await dialog.showOpenDialog(window, {
            title: 'Open CBZ',
            properties: ['openFile'],
            filters: [{ name: 'Comic book archive', extensions: ['cbz'] }],
            ...(defaultPath ? { defaultPath } : {}),
          });
          const chosen = selection.filePaths[0];
          if (selection.canceled || !chosen) return { ok: true, canceled: true };
          selected = chosen;
        }
        if (disposed || window.isDestroyed()) throw new Error('Reader closed');
        // Picker settings never become archive/worker/catalog settings.
        const preparation: ReaderOpenOptions = {
          renderWidth: options.renderWidth,
          maxDecodeWidth: options.maxDecodeWidth,
          maxDecodedMB: options.maxDecodedMB,
          ...(options.tileCache !== undefined ? { tileCache: options.tileCache } : {}),
        };
        const { catalog, entry } = await authorize(selected, preparation);
        authorized = catalog;
        const result = await readChapter(catalog, entry, preparation, 'visible');
        if (!result.ok)
          throw result.code === 'deferred'
            ? new DeferredDecodeError(result.error)
            : new Error(result.error);
        assertCatalog(catalog);
        if (options.picker?.rememberFolder !== false) {
          try {
            await fs.mkdir(path.dirname(folderFile), { recursive: true });
            await fs.writeFile(
              folderFile,
              JSON.stringify({ folder: path.dirname(path.resolve(selected)) }),
              'utf8',
            );
          } catch (error) {
            console.warn(`Load folder could not be saved: ${errorText(error)}`);
          }
        }
        const publicCatalog: ReaderCatalog = {
          id: catalog.id,
          chapters: catalog.entries.map(({ id, name }) => ({ id, name })),
        };
        return { ...result, catalog: publicCatalog, budget: budget() };
      } catch (error) {
        if (authorized) await releaseCatalog(authorized.id);
        return failure(error);
      } finally {
        choosing = false;
      }
    },
    async chapter(
      catalogId: unknown,
      entryId: unknown,
      options: unknown,
      priority: unknown = 'background',
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
        !workPriority(priority) ||
        options.maxDecodeWidth !== catalog.options.maxDecodeWidth ||
        options.maxDecodedMB !== catalog.options.maxDecodedMB ||
        options.tileCache !== catalog.options.tileCache
      )
        return { ok: false, error: 'Invalid or unauthorized chapter settings' };
      return readChapter(catalog, entry, options, priority);
    },
    async prepare(
      id: unknown,
      index: unknown,
      decodeWidth: unknown,
      priority: unknown = 'visible',
    ): Promise<ReaderPrepareResult> {
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
      if (
        !positive(decodeWidth) ||
        decodeWidth > MAX_WIDTH ||
        decodeWidth > session.maxDecodeWidth ||
        !workPriority(priority)
      )
        return { ok: false, error: 'Invalid or unauthorized decode width' };
      const page = session.pages[index];
      if (!page) return { ok: false, error: 'Page metadata unavailable' };
      const width = Math.min(page.width, decodeWidth),
        height = Math.max(1, Math.round((page.height * width) / page.width)),
        key = `${index}-${width}`;
      const workKey = `prepare:${id}:${key}`;
      const catalog = catalogs.get(session.catalogId);
      if (!catalog) return { ok: false, error: 'Reading catalog unavailable' };
      try {
        assertActive(id, session);
        await assertSource(session.filePath, session.source);
        assertActive(id, session);
        let task = session.pendingVariants.get(key);
        scheduler.promote(workKey, priority);
        if (!task) {
          task = scheduler.run(workKey, id, priority, async () => {
            assertActive(id, session);
            const variant = await withGrant(catalog, id, (bytes) =>
              session.request('prepare', bytes, index, width),
            );
            if (
              diagnosticLog &&
              variant.timing &&
              typeof variant.timing.cacheHit === 'boolean' &&
              Number.isFinite(variant.timing.inputMs) &&
              Number.isFinite(variant.timing.imageMs)
            ) {
              diagnosticLog.record('native', {
                kind: 'image',
                clockMs: performance.now(),
                values: {
                  chapterId: id,
                  pageIndex: index,
                  inputMs: variant.timing.inputMs,
                  imageWorkMs: variant.timing.imageMs,
                  cacheHit: variant.timing.cacheHit,
                  width,
                },
              });
            }
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
            if (variant.tiles) {
              const previous = catalog.cachedVariants.get(
                `${session.entryId}:${variant.pageId}:${variant.width}`,
              );
              catalog.cachedVariants.set(
                `${session.entryId}:${variant.pageId}:${variant.width}`,
                variant,
              );
              reservations.set(
                catalog.id,
                (reservations.get(catalog.id) ?? 0) - (previous?.bytes ?? 0) + variant.bytes,
              );
            }
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
          budget: budget(),
          ...(variant.tiles
            ? {
                catalogId: session.catalogId,
                entryId: session.entryId,
                tiles: variant.tiles.map((tile) => ({
                  index: tile.index,
                  left: tile.left,
                  top: tile.top,
                  width: tile.width,
                  height: tile.height,
                  encodedWidth: tile.encodedWidth,
                  encodedHeight: tile.encodedHeight,
                  offsetX: tile.offsetX,
                  offsetY: tile.offsetY,
                  bytes: tile.bytes,
                  url: `${SCHEME}://tile/${session.catalogId}/${session.entryId}/${page.id}-${variant.width}/${tile.index}.png`,
                })),
              }
            : {}),
        };
      } catch (error) {
        return failure(error);
      }
    },
    async release(id: unknown): Promise<Result> {
      if (typeof id !== 'string') return { ok: false, error: 'Invalid chapter identity' };
      if (catalogs.has(id)) await releaseCatalog(id);
      else await release(id);
      return { ok: true };
    },
    async reserveRender(owner: unknown, bytes: unknown, maximumMB: unknown): Promise<Result> {
      if (
        typeof owner !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(owner) ||
        typeof bytes !== 'number' ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        bytes > 4096 * MB ||
        typeof maximumMB !== 'number' ||
        !Number.isInteger(maximumMB) ||
        maximumMB < 64 ||
        maximumMB > 4096
      )
        return { ok: false, error: 'Invalid render reservation' };
      if (!bytes) {
        renderReservations.delete(owner);
        return { ok: true };
      }
      budgetLimit = Math.max(budgetLimit, maximumMB * MB);
      const current = budget();
      if (
        current.residentBytes -
          (renderReservations.get(owner) ?? 0) +
          current.inFlightBytes +
          bytes >
        budgetLimit
      )
        return failure(
          new DeferredDecodeError('Render preparation exceeds the shared reader budget'),
        );
      renderReservations.set(owner, bytes);
      return { ok: true };
    },
    async diagnostics(events: unknown): Promise<Result> {
      if (!Array.isArray(events) || events.length > 128 || !events.every(isReaderMetricEvent))
        return { ok: false, error: 'Invalid reader metric batch' };
      if (!diagnosticLog) return { ok: true };
      for (const event of events) diagnosticLog.record('renderer', event);
      return diagnosticLog.flush();
    },
    async dispose() {
      disposed = true;
      scheduler.dispose();
      await Promise.allSettled([...catalogs.keys()].map(releaseCatalog));
      await Promise.allSettled([...sessions.keys()].map(release));
      await Promise.allSettled([...closing.values()]);
      if (diagnosticLog) {
        app.removeListener('gpu-info-update', gpuInfo);
        diagnosticLog.record('native', {
          kind: 'stop',
          clockMs: performance.now(),
          values: { ...budget(), memoryMetric: 'estimated-admission' },
        });
        await diagnosticLog.close();
      }
      protocol.unhandle(SCHEME);
    },
  };
}
if (!isMainThread)
  void runArchiveWorker().catch((error: unknown) => {
    throw error;
  });
