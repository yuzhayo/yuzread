import {
  Container,
  DOMAdapter,
  ImageSource,
  Rectangle,
  Sprite,
  Texture,
  WebGLRenderer,
  WebWorkerAdapter,
} from 'pixi.js';
import type { ReaderPreparedPage, Result } from '../../../ShellHost.js';
import type {
  PixiInput,
  PixiOutput,
  PixiPageBox,
  PixiView,
} from './BodyReaderPixiWorkerContract.js';
import { advanceMomentum, clampMomentum, momentumImpulse } from './BodyReaderPixiWorkerPolicy.ts';

// CONFIG AND CONTRACT — a reader-owned worker, not DOM/Node/IPC code.
const MB = 1048576;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown, min = -1e9, max = 1e9): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown): v is number =>
  finite(v, 0, Number.MAX_SAFE_INTEGER) && Number.isSafeInteger(v);
const result = (v: unknown): v is Result =>
  record(v) &&
  (v.ok === true ||
    (v.ok === false &&
      typeof v.error === 'string' &&
      (v.code === undefined || v.code === 'deferred' || v.code === 'cancelled')));
const validView = (v: unknown): v is PixiView =>
  record(v) &&
  integer(v.revision) &&
  integer(v.control) &&
  typeof v.documentId === 'string' &&
  v.documentId.length <= 128 &&
  finite(v.width, 1, 8192) &&
  finite(v.height, 1, 8192) &&
  finite(v.ratio, 0.1, 8) &&
  finite(v.x, 0) &&
  finite(v.y, 0) &&
  finite(v.maxY, 0);
const validBox = (v: unknown): v is PixiPageBox =>
  record(v) &&
  typeof v.key === 'string' &&
  v.key.length <= 256 &&
  finite(v.left) &&
  finite(v.top) &&
  finite(v.width, 0.1, 65536) &&
  finite(v.height, 0.1);
function validPage(v: unknown): v is ReaderPreparedPage {
  return (
    record(v) &&
    v.ok === true &&
    typeof v.id === 'string' &&
    /^[0-9a-f-]{36}$/.test(v.id) &&
    integer(v.index) &&
    typeof v.pageId === 'string' &&
    v.pageId.length <= 256 &&
    typeof v.sourceRevision === 'string' &&
    v.sourceRevision.length <= 256 &&
    integer(v.requestedWidth) &&
    finite(v.requestedWidth, 1, 8192) &&
    integer(v.width) &&
    finite(v.width, 1, 8192) &&
    integer(v.height) &&
    finite(v.height, 1, 1e9) &&
    v.url === `yuzread-page://page/${v.id}/${v.index}-${v.width}.png`
  );
}
function validInput(v: unknown): v is PixiInput {
  if (!record(v) || v.version !== 1) return false;
  switch (v.kind) {
    case 'init':
      return (
        (v.canvas === null || v.canvas instanceof OffscreenCanvas) &&
        validView(v.view) &&
        finite(v.speed, 0.1, 10)
      );
    case 'layout':
      return (
        validView(v.view) &&
        Array.isArray(v.pages) &&
        v.pages.length <= 100000 &&
        v.pages.every(validBox)
      );
    case 'view':
      return validView(v.view);
    case 'prepare':
      return (
        integer(v.request) &&
        validPage(v.page) &&
        ['demand', 'visible', 'background'].includes(String(v.priority))
      );
    case 'release':
      return integer(v.request) && typeof v.chapter === 'string';
    case 'wheel':
      return integer(v.control) && finite(v.distance, -1e6, 1e6) && finite(v.maxY, 0);
    case 'stop':
      return integer(v.control) && finite(v.y, 0) && finite(v.maxY, 0);
    case 'rebase':
      return integer(v.control) && finite(v.delta) && finite(v.maxY, 0);
    case 'speed':
      return integer(v.control) && finite(v.speed, 0.1, 10) && finite(v.maxY, 0);
    case 'ack':
      return integer(v.serial);
    case 'reservation':
      return integer(v.request) && result(v.result);
    case 'dispose':
      return true;
    default:
      return false;
  }
}
class SurfaceError extends Error {
  constructor(
    message: string,
    readonly code?: 'deferred' | 'cancelled',
  ) {
    super(message);
  }
}
const failure = (error: unknown): Result => ({
  ok: false,
  error: error instanceof Error ? error.message : 'GPU page preparation failed',
  ...(error instanceof SurfaceError && error.code ? { code: error.code } : {}),
});
const reply = (value: PixiOutput) => self.postMessage(value);
const pageKey = (p: ReaderPreparedPage) => `${p.id}:${p.index}`;

// RESOURCES — bitmaps/textures are the accepted page surfaces, never duplicate DOM images.
interface Page {
  chapter: string;
  source: ReaderPreparedPage;
  node: Container;
  bitmaps: ImageBitmap[];
  textures: Texture[];
  box?: PixiPageBox;
  documentId: string;
  padding: number;
  accounted: boolean;
}
DOMAdapter.set(WebWorkerAdapter);
const stage = new Container(),
  pages = new Map<string, Page>();
const abort = new AbortController();
let view: PixiView | null = null,
  renderer: WebGLRenderer | null = null;
let initializing: Promise<void> | null = null,
  disposed = false,
  stagingBytes = 0,
  rendererReady = false,
  paddingBytes = 0;
let resourceId = 0,
  resourceChain: Promise<void> = Promise.resolve();
const resourceWaiters = new Map<number, (value: Result) => void>();
const baseline = () =>
  8 * MB +
  paddingBytes +
  (renderer && view
    ? Math.ceil(view.width * view.ratio) * Math.ceil(view.height * view.ratio) * 12 + 4 * MB
    : 0);
function reserve(bytes: number): Promise<void> {
  const task = resourceChain.then(async () => {
    if (disposed) throw new SurfaceError('Reader closed', 'cancelled');
    const request = ++resourceId;
    const response = await new Promise<Result>((resolve) => {
      resourceWaiters.set(request, resolve);
      reply({ version: 1, kind: 'reserve', request, bytes });
    });
    if (!response.ok) throw new SurfaceError(response.error, response.code);
  });
  resourceChain = task.catch(() => {});
  return task;
}
function destroyPage(page: Page) {
  if (page.accounted) {
    paddingBytes -= page.padding;
    page.accounted = false;
  }
  page.node.destroy({ children: true });
  for (const texture of page.textures) texture.destroy(true);
  for (const bitmap of page.bitmaps) bitmap.close();
}
function visible(page: Page) {
  const box = page.box;
  return (
    !!view &&
    !!box &&
    page.documentId === view.documentId &&
    box.left + box.width > view.x &&
    box.left < view.x + view.width &&
    box.top + box.height > y &&
    box.top < y + view.height
  );
}
const releases = new Map<number, string>();
let activeChapter: string | null = null;
function releasePages() {
  for (const [request, chapter] of releases) {
    if (activeChapter === chapter) continue;
    if ([...pages.values()].some((page) => page.chapter === chapter && visible(page))) continue;
    for (const [key, page] of pages)
      if (page.chapter === chapter) {
        pages.delete(key);
        destroyPage(page);
      }
    releases.delete(request);
    reply({ version: 1, kind: 'released', request });
  }
}

// MOMENTUM — one worker frame loop; a single outstanding position prevents a mailbox backlog.
let y = 0,
  maxY = 0,
  velocity = 0,
  target = 0,
  control = 0;
let frame: number | null = null,
  lastTime: number | null = null,
  serial = 0,
  outstanding = 0,
  positionDirty = false;
let upload: (() => void) | null = null;
let speed = 1;
let renderOutstanding = 0;
interface RenderSummary {
  revision: number;
  pages: number;
  visiblePages: number;
}
let renderSummary: RenderSummary | null = null;
let sentRender: RenderSummary | null = null;
function publishRender() {
  if (renderOutstanding || !renderSummary || disposed) return;
  if (
    sentRender &&
    sentRender.revision === renderSummary.revision &&
    sentRender.pages === renderSummary.pages &&
    sentRender.visiblePages === renderSummary.visiblePages
  )
    return;
  renderOutstanding = ++serial;
  sentRender = renderSummary;
  reply({ version: 1, kind: 'rendered', serial: renderOutstanding, ...renderSummary });
}
const moving = () => velocity !== 0 || target !== 0;
function publishPosition() {
  if (outstanding || !positionDirty || disposed) return;
  positionDirty = false;
  outstanding = ++serial;
  reply({ version: 1, kind: 'position', serial: outstanding, control, y, moving: moving(), speed });
}
function schedule() {
  if (frame !== null || disposed) return;
  frame = requestAnimationFrame(tick);
}
function tick(time: number) {
  frame = null;
  if (disposed) return;
  if (moving()) {
    const next = advanceMomentum(
      velocity,
      target,
      lastTime === null ? 0 : (time - lastTime) / 1000,
      speed,
    );
    const desired = y + next.distance;
    y = Math.max(0, Math.min(maxY, desired));
    velocity = next.velocity;
    target = next.target;
    if (Math.abs(y - desired) > 0.001) velocity = target = 0;
    positionDirty = true;
  }
  lastTime = moving() ? time : null;
  const work = upload;
  upload = null;
  work?.();
  if (
    renderer &&
    rendererReady &&
    view &&
    renderer.screen.width === view.width &&
    renderer.screen.height === view.height &&
    renderer.resolution === view.ratio
  ) {
    let count = 0;
    for (const page of pages.values()) {
      page.node.visible = visible(page);
      if (page.node.visible && page.box) {
        count++;
        page.node.position.set(page.box.left - view.x, page.box.top - y);
        page.node.scale.set(
          page.box.width / page.source.width,
          page.box.height / page.source.height,
        );
      }
    }
    renderer.render({ container: stage });
    renderSummary = { revision: view.revision, pages: pages.size, visiblePages: count };
    publishRender();
  }
  publishPosition();
  releasePages();
  if (moving() || upload) schedule();
}
function stop(offset: number) {
  y = Math.max(0, Math.min(maxY, offset));
  velocity = target = 0;
  lastTime = null;
  positionDirty = true;
  schedule();
}

// GPU PREPARATION — one priority/FIFO page at a time, one bounded tile upload per frame.
const jobs: Extract<PixiInput, { kind: 'prepare' }>[] = [];
let preparing = false;
const cancelled = new Set<string>();
const check = (chapter: string) => {
  if (disposed || cancelled.has(chapter)) throw new SurfaceError('Page released', 'cancelled');
};
async function prepare(message: Extract<PixiInput, { kind: 'prepare' }>) {
  const { page } = message;
  check(page.id);
  const key = pageKey(page),
    retained = pages.get(key);
  if (retained) {
    if (
      retained.source.pageId !== page.pageId ||
      retained.source.sourceRevision !== page.sourceRevision ||
      retained.source.width !== page.width
    )
      throw new Error('Prepared page identity changed');
    return { bitmapMs: 0, uploadMs: 0 };
  }
  await initializing;
  const current = renderer;
  if (!current || !rendererReady) throw new Error('GPU renderer is unavailable');
  check(page.id);
  const response = await fetch(page.url, { signal: abort.signal, credentials: 'omit' });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png'))
    throw new Error('Prepared page token is unavailable');
  const encodedBytes = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 1)
    throw new Error('Prepared page length is invalid');
  stagingBytes = encodedBytes + page.width * page.height * 4;
  const entry: Page = {
    chapter: page.id,
    source: page,
    node: new Container(),
    bitmaps: [],
    textures: [],
    documentId: '',
    padding: 0,
    accounted: false,
  };
  let bitmapMs = 0,
    uploadMs = 0;
  try {
    await reserve(baseline() + stagingBytes);
    check(page.id);
    const blob = await response.blob();
    check(page.id);
    if (blob.size !== encodedBytes) throw new Error('Prepared page bytes are incomplete');
    const header = new DataView(await blob.slice(0, 24).arrayBuffer());
    if (
      header.byteLength !== 24 ||
      header.getUint32(0) !== 0x89504e47 ||
      header.getUint32(4) !== 0x0d0a1a0a ||
      header.getUint32(12) !== 0x49484452 ||
      header.getUint32(16) !== page.width ||
      header.getUint32(20) !== page.height
    )
      throw new Error('Prepared PNG dimensions do not match');
    const maximum: unknown = current.gl.getParameter(current.gl.MAX_TEXTURE_SIZE);
    if (!finite(maximum, 4, 65536)) throw new Error('GPU texture limit is invalid');
    const tileSize = Math.min(1024, maximum - 2);
    for (let top = 0; top < page.height; top += tileSize)
      for (let left = 0; left < page.width; left += tileSize) {
        check(page.id);
        const width = Math.min(tileSize, page.width - left),
          height = Math.min(tileSize, page.height - top);
        const x0 = Math.max(0, left - 1),
          y0 = Math.max(0, top - 1);
        const x1 = Math.min(page.width, left + width + 1),
          y1 = Math.min(page.height, top + height + 1);
        entry.padding += ((x1 - x0) * (y1 - y0) - width * height) * 8;
        const start = performance.now();
        const bitmap = await createImageBitmap(blob, x0, y0, x1 - x0, y1 - y0, {
          imageOrientation: 'none',
        });
        entry.bitmaps.push(bitmap);
        bitmapMs += performance.now() - start;
        check(page.id);
        if (bitmap.width !== x1 - x0 || bitmap.height !== y1 - y0)
          throw new Error('Prepared bitmap dimensions do not match');
        const texture = new Texture({
          source: new ImageSource({
            resource: bitmap,
            autoGenerateMipmaps: false,
            autoGarbageCollect: false,
          }),
          frame: new Rectangle(left - x0, top - y0, width, height),
        });
        entry.textures.push(texture);
        const sprite = new Sprite({ texture });
        sprite.eventMode = 'none';
        sprite.position.set(left, top);
        entry.node.addChild(sprite);
        await new Promise<void>((resolve, reject) => {
          upload = () => {
            try {
              check(page.id);
              const start = performance.now();
              current.texture.initSource(texture.source);
              uploadMs += performance.now() - start;
              resolve();
            } catch (error) {
              reject(error);
            }
          };
          schedule();
        });
      }
    check(page.id);
    entry.accounted = true;
    paddingBytes += entry.padding;
    pages.set(key, entry);
    stage.addChild(entry.node);
    const box = layout.get(key);
    if (box && view) {
      entry.box = box;
      entry.documentId = view.documentId;
    }
    schedule();
    return { bitmapMs, uploadMs };
  } catch (error) {
    destroyPage(entry);
    throw error;
  } finally {
    stagingBytes = 0;
    if (!disposed) await reserve(baseline());
  }
}
async function pump() {
  if (preparing || disposed) return;
  preparing = true;
  try {
    while (jobs.length && !disposed) {
      jobs.sort((a, b) => rank(a.priority) - rank(b.priority));
      const message = jobs.shift();
      if (!message) break;
      activeChapter = message.page.id;
      try {
        const timing = await prepare(message);
        reply({
          version: 1,
          kind: 'prepared',
          request: message.request,
          result: { ok: true },
          timing,
        });
      } catch (error) {
        reply({
          version: 1,
          kind: 'prepared',
          request: message.request,
          result: failure(error),
          timing: { bitmapMs: 0, uploadMs: 0 },
        });
      } finally {
        activeChapter = null;
        releasePages();
      }
    }
  } finally {
    preparing = false;
  }
}
const rank = (value: string) => (value === 'demand' ? 0 : value === 'visible' ? 1 : 2);
const layout = new Map<string, PixiPageBox>();
async function resizeRenderer(next: PixiView) {
  if (!renderer || !rendererReady) return;
  await reserve(baseline() + stagingBytes);
  if (
    !disposed &&
    view?.width === next.width &&
    view.height === next.height &&
    view.ratio === next.ratio
  ) {
    renderer.resize(next.width, next.height, next.ratio);
    schedule();
  }
}
async function initialize(message: Extract<PixiInput, { kind: 'init' }>) {
  view = message.view;
  speed = message.speed;
  y = view.y;
  maxY = view.maxY;
  control = view.control;
  reply({ version: 1, kind: 'initialized' });
  if (!message.canvas) {
    await reserve(baseline());
    return;
  }
  renderer = new WebGLRenderer();
  await reserve(baseline());
  await renderer.init({
    canvas: message.canvas,
    width: view.width,
    height: view.height,
    resolution: view.ratio,
    backgroundAlpha: 0,
    antialias: false,
    gcActive: false,
    failIfMajorPerformanceCaveat: true,
  });
  if (disposed) return;
  rendererReady = true;
  if (
    renderer.screen.width !== view.width ||
    renderer.screen.height !== view.height ||
    renderer.resolution !== view.ratio
  )
    await resizeRenderer(view);
  const maximum: unknown = renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE);
  if (!finite(maximum, 4, 65536)) throw new Error('GPU texture limit is invalid');
  reply({
    version: 1,
    kind: 'ready',
    backend: 'webgl',
    webGLVersion: renderer.context.webGLVersion,
    maxTextureSize: maximum,
  });
  schedule();
}

// LIFECYCLE — dispose settles pending work before acknowledging owned resources.
let pumpingTask: Promise<void> = Promise.resolve();
async function dispose() {
  disposed = true;
  abort.abort();
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  const pendingUpload = upload;
  upload = null;
  pendingUpload?.();
  for (const job of jobs.splice(0))
    reply({
      version: 1,
      kind: 'prepared',
      request: job.request,
      result: { ok: false, code: 'cancelled', error: 'Reader closed' },
      timing: { bitmapMs: 0, uploadMs: 0 },
    });
  await Promise.allSettled([initializing, pumpingTask, resourceChain]);
  for (const page of pages.values()) destroyPage(page);
  pages.clear();
  stage.destroy({ children: true });
  if (rendererReady && renderer && !renderer.gl.isContextLost()) renderer.gl.finish();
  renderer?.destroy();
  renderer = null;
  for (const request of releases.keys()) reply({ version: 1, kind: 'released', request });
  releases.clear();
  reply({ version: 1, kind: 'disposed' });
  self.close();
}
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!validInput(event.data)) {
    reply({ version: 1, kind: 'failed', error: 'Invalid renderer message' });
    return;
  }
  const message = event.data;
  if (message.kind === 'reservation') {
    resourceWaiters.get(message.request)?.(message.result);
    resourceWaiters.delete(message.request);
    return;
  }
  if (message.kind === 'dispose') {
    void dispose();
    return;
  }
  if (disposed) return;
  if (message.kind === 'init') {
    if (!initializing)
      initializing = initialize(message).catch((error) => {
        reply({
          version: 1,
          kind: 'failed',
          error: error instanceof Error ? error.message : 'GPU initialization failed',
        });
      });
  } else if (message.kind === 'layout' || message.kind === 'view') {
    if (view && message.view.revision <= view.revision) return;
    const changed = view?.documentId !== message.view.documentId;
    view = message.view;
    maxY = view.maxY;
    if (changed) {
      control = view.control;
      stop(view.y);
    }
    if (message.kind === 'layout') {
      layout.clear();
      for (const box of message.pages) layout.set(box.key, box);
    }
    for (const [key, page] of pages) {
      const box = layout.get(key);
      if (box) {
        page.box = box;
        page.documentId = view.documentId;
      }
    }
    if (
      renderer &&
      rendererReady &&
      (renderer.screen.width !== view.width ||
        renderer.screen.height !== view.height ||
        renderer.resolution !== view.ratio)
    )
      void resizeRenderer(view).catch((error) =>
        reply({
          version: 1,
          kind: 'failed',
          error: error instanceof Error ? error.message : 'GPU resize failed',
        }),
      );
    schedule();
  } else if (message.kind === 'prepare') {
    if (jobs.length >= 8) {
      reply({
        version: 1,
        kind: 'prepared',
        request: message.request,
        result: { ok: false, code: 'deferred', error: 'Render preparation queue is full' },
        timing: { bitmapMs: 0, uploadMs: 0 },
      });
      return;
    }
    jobs.push(message);
    if (!preparing) pumpingTask = pump();
  } else if (message.kind === 'release') {
    cancelled.add(message.chapter);
    releases.set(message.request, message.chapter);
    releasePages();
    schedule();
  } else if (message.kind === 'ack') {
    if (message.serial === outstanding) {
      outstanding = 0;
      publishPosition();
    }
    if (message.serial === renderOutstanding) {
      renderOutstanding = 0;
      publishRender();
    }
  } else if (message.control >= control) {
    control = message.control;
    maxY = message.maxY;
    if (message.kind === 'wheel') {
      target = clampMomentum(target + momentumImpulse(message.distance, speed), speed);
      lastTime ??= performance.now();
      schedule();
    } else if (message.kind === 'speed') {
      const factor = message.speed / speed;
      speed = message.speed;
      velocity = clampMomentum(velocity * factor, speed);
      target = clampMomentum(target * factor, speed);
      positionDirty = true;
      schedule();
    } else if (message.kind === 'stop') stop(message.y);
    else if (message.kind === 'rebase') {
      y = Math.max(0, Math.min(maxY, y + message.delta));
      positionDirty = true;
      schedule();
    }
  }
});
