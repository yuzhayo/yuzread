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
import type { ReaderPreparedPage, ReaderPreparedTile, Result } from '../../../../ShellHost.js';
import type {
  PixiInput,
  PixiOutput,
  PixiPageBox,
  PixiView,
} from './BodyReaderPixiWorkerContract.js';
import {
  advanceWheelGesture,
  appendWheelTick,
  createWheelGesture,
  scaleWheelGesture,
  scaleWheelDuration,
  advanceRenderDeadline,
  tileInViewport,
  tileWorkNeeded,
} from './BodyReaderPixiWorkerPolicy.ts';

// CONFIG AND CONTRACT — a reader-owned worker, not DOM/Node/IPC code.
const MB = 1048576;

// LOGIC AND CALCULATIONS — validate every message/page before it can affect worker state.
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
  finite(v.maxY, 0) &&
  finite(v.renderLeft, 0, 8192) &&
  finite(v.renderWidth, 0.125, 8202) &&
  v.renderLeft + v.renderWidth <= v.width + 1 / v.ratio + 0.001;
const validBox = (v: unknown): v is PixiPageBox =>
  record(v) &&
  typeof v.key === 'string' &&
  v.key.length <= 256 &&
  finite(v.left) &&
  finite(v.top) &&
  finite(v.width, 0.1, 65536) &&
  finite(v.height, 0.1);
function validPage(v: unknown): v is ReaderPreparedPage {
  if (!record(v)) return false;
  const { width, height } = v;
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
    integer(width) &&
    finite(width, 1, 8192) &&
    integer(height) &&
    finite(height, 1, 1e9) &&
    v.url === `yuzread-page://page/${v.id}/${v.index}-${v.width}.png` &&
    (v.tiles === undefined ||
      (Array.isArray(v.tiles) &&
        typeof v.catalogId === 'string' &&
        /^[0-9a-f-]{36}$/.test(v.catalogId) &&
        typeof v.entryId === 'string' &&
        /^[0-9a-f-]{36}$/.test(v.entryId) &&
        /^[0-9a-f]{64}$/.test(v.pageId) &&
        v.tiles.length > 0 &&
        v.tiles.length <= 10000 &&
        v.tiles.length === Math.ceil(width / 1024) * Math.ceil(height / 1024) &&
        v.tiles.every(
          (tile: unknown, index: number) =>
            record(tile) &&
            integer(tile.index) &&
            integer(tile.left) &&
            integer(tile.top) &&
            tile.index === index &&
            tile.left === (index % Math.ceil(width / 1024)) * 1024 &&
            tile.top === Math.floor(index / Math.ceil(width / 1024)) * 1024 &&
            finite(tile.width, 1, 1024) &&
            finite(tile.height, 1, 1024) &&
            tile.width === Math.min(1024, width - tile.left) &&
            tile.height === Math.min(1024, height - tile.top) &&
            finite(tile.encodedWidth, 1, 1026) &&
            finite(tile.encodedHeight, 1, 1026) &&
            integer(tile.offsetX) &&
            integer(tile.offsetY) &&
            tile.offsetX === (tile.left ? 1 : 0) &&
            tile.offsetY === (tile.top ? 1 : 0) &&
            tile.encodedWidth ===
              tile.width + tile.offsetX + (tile.left + tile.width < width ? 1 : 0) &&
            tile.encodedHeight ===
              tile.height + tile.offsetY + (tile.top + tile.height < height ? 1 : 0) &&
            finite(tile.bytes, 1, 128 * 1048576) &&
            tile.url ===
              `yuzread-page://tile/${v.catalogId}/${v.entryId}/${v.pageId}-${v.width}/${tile.index}.png`,
        )))
  );
}
function validInput(v: unknown): v is PixiInput {
  if (!record(v) || v.version !== 1) return false;
  switch (v.kind) {
    case 'init':
      return (
        (v.canvas === null || v.canvas instanceof OffscreenCanvas) &&
        validView(v.view) &&
        finite(v.speed, 0.1, 10) &&
        (v.maxFPS === 0 || finite(v.maxFPS, 10, 240)) &&
        Number.isInteger(v.maxFPS) &&
        finite(v.tileMemoryMB, 16, 512) &&
        finite(v.tickWindowMs, 50, 300) &&
        Number.isInteger(v.tickWindowMs) &&
        finite(v.smoothDurationMs, 100, 2000) &&
        Number.isInteger(v.smoothDurationMs)
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
        (v.warm === undefined ||
          (record(v.warm) && finite(v.warm.top, 0) && finite(v.warm.height, 1))) &&
        ['demand', 'visible', 'background'].includes(String(v.priority))
      );
    case 'release':
      return integer(v.request) && typeof v.chapter === 'string';
    case 'wheel':
      return (
        integer(v.control) &&
        finite(v.distance, -1e6, 1e6) &&
        finite(v.time, 0, Number.MAX_SAFE_INTEGER) &&
        finite(v.maxY, 0)
      );
    case 'stop':
      return integer(v.control) && finite(v.y, 0) && finite(v.maxY, 0);
    case 'rebase':
      return integer(v.control) && finite(v.delta) && finite(v.maxY, 0);
    case 'speed':
      return integer(v.control) && finite(v.speed, 0.1, 10) && finite(v.maxY, 0);
    case 'smooth-duration':
      return (
        integer(v.control) &&
        finite(v.durationMs, 100, 2000) &&
        Number.isInteger(v.durationMs) &&
        finite(v.maxY, 0)
      );
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
const pageKey = (p: ReaderPreparedPage) =>
  p.tiles ? `${p.catalogId}:${p.entryId}:${p.index}` : `${p.id}:${p.index}`;

// STATE AND COORDINATION — RESOURCES
// Bitmaps/textures are accepted page surfaces, never duplicate DOM images.
interface Page {
  chapter: string;
  source: ReaderPreparedPage;
  node: Container;
  bitmaps: ImageBitmap[];
  textures: Texture[];
  tiles: { sprite: Sprite; left: number; top: number; width: number; height: number }[];
  box?: PixiPageBox;
  documentId: string;
  padding: number;
  accounted: boolean;
  cache?: CachedTile[];
  pins: Set<number>;
  retired?: boolean;
}
interface CachedTile {
  source: ReaderPreparedTile;
  sprite: Sprite | null;
  texture: Texture | null;
  bitmap: ImageBitmap | null;
  used: number;
  cost: number;
  failed: boolean;
}
let cachedBytes = 0,
  cacheReservation = 0,
  cacheStaging = 0,
  tileLimit = 128 * MB,
  cacheBusy = false,
  activeTileChapter: string | null = null,
  cacheTask: Promise<void> = Promise.resolve();
// At most two full-size GPU uploads per admitted frame, including sampling borders.
const CACHE_UPLOAD_LIMIT = 2 * 1026 * 1026 * 4;
let cacheUploadBytes = CACHE_UPLOAD_LIMIT;
let demandY: number | null = null;
const warmWaiters: {
  page: Page;
  indices: number[];
  resolve: () => void;
  reject: (error: Error) => void;
}[] = [];
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
let resizeTask: Promise<void> | null = null;
const framebufferPixels = (value: PixiView) =>
  Math.max(1, Math.round(value.renderWidth * value.ratio)) *
  Math.max(1, Math.round(value.height * value.ratio));
const frameMatches = (value: PixiView) =>
  !!renderer &&
  renderer.canvas.width === Math.max(1, Math.round(value.renderWidth * value.ratio)) &&
  renderer.canvas.height === Math.max(1, Math.round(value.height * value.ratio)) &&
  renderer.resolution === value.ratio;
let visualDirty = true,
  maxFPS = 0,
  renderDeadline = 0;
let resourceId = 0,
  resourceChain: Promise<void> = Promise.resolve();
const resourceWaiters = new Map<number, (value: Result) => void>();
const baseline = () =>
  8 * MB +
  paddingBytes +
  Math.max(cacheReservation, cachedBytes + cacheStaging) +
  (renderer && view
    ? Math.max(
        framebufferPixels(view),
        rendererReady ? renderer.canvas.width * renderer.canvas.height : 0,
      ) *
        12 +
      4 * MB
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
  if (page.cache) for (const tile of page.cache) evictTile(tile);
  for (let n = warmWaiters.length - 1; n >= 0; n--)
    if (warmWaiters[n]?.page === page) {
      warmWaiters[n]?.reject(new SurfaceError('Page released', 'cancelled'));
      warmWaiters.splice(n, 1);
    }
  if (page.node.parent === stage && page.node.visible) visualDirty = true;
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
const boxOnScreen = (box: PixiPageBox) =>
  !!view &&
  tileInViewport(
    box.left - view.x,
    box.top - y,
    box.width,
    box.height,
    view.width,
    view.height,
    1 / view.ratio,
  );
const releases = new Map<number, string>();
let activeChapter: string | null = null;
function releasePages() {
  for (const [request, chapter] of releases) {
    if (activeChapter === chapter || activeTileChapter === chapter) continue;
    if (
      [...pages.values()].some((page) => page.chapter === chapter && !page.cache && visible(page))
    )
      continue;
    for (const [key, page] of pages)
      if (page.chapter === chapter) {
        if (page.cache && view?.documentId === page.documentId && page.box) {
          page.retired = true;
          continue;
        }
        pages.delete(key);
        destroyPage(page);
      }
    releases.delete(request);
    reply({ version: 1, kind: 'released', request });
  }
}

// STATE AND COORDINATION — MOMENTUM
// One worker frame loop; a single outstanding position prevents a mailbox backlog.
let y = 0,
  maxY = 0,
  velocity = 0,
  control = 0;
let gesture = createWheelGesture(),
  tickWindowMs = 150,
  smoothDurationMs = 0;
let frame: number | null = null,
  lastTime: number | null = null,
  serial = 0,
  outstanding = 0,
  positionDirty = false;
let upload: (() => void) | null = null;
let speed = 1;
let renderOutstanding = 0;
let blockedFrames = 0;
let tileIssue = false;
let skippedTiles = 0,
  skippedDecodeBytes = 0,
  skippedUploadBytes = 0;
interface RenderSummary {
  revision: number;
  pages: number;
  visiblePages: number;
  residentTiles: number;
  residentBytes: number;
  blockedFrames: number;
  skippedTiles: number;
  skippedDecodeBytes: number;
  skippedUploadBytes: number;
  frame: { left: number; width: number; height: number; ratio: number };
}
let renderSummary: RenderSummary | null = null;
let sentRender: RenderSummary | null = null;
function publishRender() {
  if (renderOutstanding || !renderSummary || disposed) return;
  if (
    sentRender &&
    sentRender.revision === renderSummary.revision &&
    sentRender.pages === renderSummary.pages &&
    sentRender.visiblePages === renderSummary.visiblePages &&
    sentRender.residentTiles === renderSummary.residentTiles &&
    sentRender.residentBytes === renderSummary.residentBytes &&
    sentRender.blockedFrames === renderSummary.blockedFrames &&
    sentRender.skippedTiles === renderSummary.skippedTiles
  )
    return;
  renderOutstanding = ++serial;
  sentRender = renderSummary;
  reply({ version: 1, kind: 'rendered', serial: renderOutstanding, ...renderSummary });
}
const moving = () => gesture.velocity !== 0 || gesture.remaining !== 0;
function clearMotion() {
  gesture = createWheelGesture();
  velocity = 0;
  lastTime = null;
}
function publishPosition() {
  if (outstanding || !positionDirty || disposed) return;
  positionDirty = false;
  outstanding = ++serial;
  reply({
    version: 1,
    kind: 'position',
    serial: outstanding,
    control,
    y,
    moving: moving(),
    speed,
    velocity,
    gestureActive:
      gesture.lastTick !== null &&
      performance.timeOrigin + performance.now() - gesture.lastTick <= tickWindowMs,
  });
}
function schedule() {
  if (frame !== null || disposed) return;
  frame = requestAnimationFrame(tick);
}
function tick(time: number) {
  frame = null;
  if (disposed) return;
  const clock = advanceRenderDeadline(time, renderDeadline, maxFPS);
  if (!clock.ready) {
    schedule();
    return;
  }
  renderDeadline = clock.deadline;
  cacheUploadBytes = 0;
  if (moving()) {
    const next = advanceWheelGesture(
      gesture,
      lastTime === null ? 0 : (time - lastTime) / 1000,
      performance.timeOrigin + performance.now(),
      speed,
      tickWindowMs,
      smoothDurationMs,
    );
    const desired = y + next.distance;
    let nextY = Math.max(0, Math.min(maxY, desired));
    demandY = nextY;
    const blocked = missingViewport(nextY);
    if (blocked) {
      blockedFrames++;
      startCache();
      nextY = y;
      if (
        [...pages.values()].some((page) =>
          page.cache?.some((tile) => tile.failed && tileVisible(page, tile, demandY ?? y)),
        )
      )
        clearMotion();
    }
    if (nextY !== y) visualDirty = true;
    y = nextY;
    // Waiting for a tile must not consume the remaining momentum or cause a catch-up jump.
    if (!blocked) {
      gesture = next.state;
      velocity = gesture.velocity;
    }
    if ((desired < 0 || desired > maxY) && Math.abs(y - desired) > 0.001) clearMotion();
    positionDirty = true;
  }
  lastTime = moving() ? time : null;
  const work = upload;
  upload = null;
  work?.();
  queueResize();
  if (renderer && rendererReady && view && frameMatches(view)) {
    let count = renderSummary?.visiblePages ?? 0;
    if (visualDirty && !missingViewport(y)) {
      count = 0;
      for (const page of pages.values()) {
        page.node.visible = visible(page);
        if (page.node.visible && page.box) {
          count++;
          const left = page.box.left - view.x,
            top = page.box.top - y;
          const scaleX = page.box.width / page.source.width,
            scaleY = page.box.height / page.source.height;
          page.node.position.set(left - view.renderLeft, top);
          page.node.scale.set(scaleX, scaleY);
          for (const tile of page.tiles)
            tile.sprite.visible = tileInViewport(
              left + tile.left * scaleX,
              top + tile.top * scaleY,
              tile.width * scaleX,
              tile.height * scaleY,
              view.width,
              view.height,
              1 / view.ratio,
            );
          if (page.cache)
            for (const tile of page.cache)
              if (tile.sprite) {
                const source = tile.source;
                tile.sprite.visible = tileInViewport(
                  left + source.left * scaleX,
                  top + source.top * scaleY,
                  source.width * scaleX,
                  source.height * scaleY,
                  view.width,
                  view.height,
                  1 / view.ratio,
                );
                if (tile.sprite.visible) tile.used = time;
              }
        }
      }
      renderer.render({ container: stage });
      visualDirty = false;
      if (tileIssue) {
        tileIssue = false;
        reply({ version: 1, kind: 'tile-error', error: '' });
      }
    }
    renderSummary = {
      revision: visualDirty ? (renderSummary?.revision ?? 0) : view.revision,
      pages: pages.size,
      visiblePages: count,
      residentTiles: [...pages.values()].reduce(
        (sum, page) =>
          sum + (page.cache?.filter((tile) => !!tile.sprite).length ?? page.tiles.length),
        0,
      ),
      residentBytes: cachedBytes,
      blockedFrames,
      skippedTiles,
      skippedDecodeBytes,
      skippedUploadBytes,
      frame:
        visualDirty && renderSummary
          ? renderSummary.frame
          : {
              left: view.renderLeft,
              width: view.renderWidth,
              height: view.height,
              ratio: view.ratio,
            },
    };
    publishRender();
  }
  publishPosition();
  releasePages();
  startCache();
  if (moving() || upload) schedule();
}
function stop(offset: number) {
  const nextY = Math.max(0, Math.min(maxY, offset));
  if (nextY !== y) visualDirty = true;
  y = nextY;
  demandY = null;
  clearMotion();
  positionDirty = true;
  schedule();
}

// STATE AND COORDINATION — TILE RESIDENCY
// Source files stay on disk; only visible/nearby decoded surfaces stay live.
function evictTile(tile: CachedTile, keepTexture = false): Texture | null {
  if (!tile.sprite) return null;
  const retained = keepTexture ? tile.texture : null;
  tile.sprite.destroy();
  if (!keepTexture) tile.texture?.destroy(true);
  tile.bitmap?.close();
  cachedBytes -= tile.cost;
  tile.sprite = null;
  tile.texture = null;
  tile.bitmap = null;
  tile.cost = 0;
  return retained;
}
function cachePriority(page: Page, tile: CachedTile, offset = demandY ?? y) {
  if (page.pins.has(tile.source.index)) return 0;
  if (!view || !page.box || page.documentId !== view.documentId) return 5;
  const box = page.box,
    sx = box.width / page.source.width,
    sy = box.height / page.source.height,
    source = tile.source;
  const left = box.left - view.x + source.left * sx,
    top = box.top - offset + source.top * sy,
    width = source.width * sx,
    height = source.height * sy;
  if (tileInViewport(left, top, width, height, view.width, view.height, 1 / view.ratio)) return 0;
  const lead = Math.max(view.height * 2, Math.min(view.height * 4, Math.abs(velocity) * 0.2));
  const before = velocity >= 0 ? view.height : lead,
    after = velocity >= 0 ? lead : view.height;
  if (!tileInViewport(left, top + before, width, height, view.width, view.height + before + after))
    return 5;
  const center = top + height / 2;
  return velocity >= 0 ? (center >= view.height ? 1 : 2) : center <= 0 ? 1 : 2;
}
function tileVisible(page: Page, tile: CachedTile, offset: number) {
  if (!view || !page.box || page.documentId !== view.documentId) return false;
  const box = page.box,
    source = tile.source;
  return tileInViewport(
    box.left - view.x + (source.left * box.width) / page.source.width,
    box.top - offset + (source.top * box.height) / page.source.height,
    (source.width * box.width) / page.source.width,
    (source.height * box.height) / page.source.height,
    view.width,
    view.height,
    1 / view.ratio,
  );
}
function checkTilePage(page: Page) {
  if (disposed || pages.get(pageKey(page.source)) !== page)
    throw new SurfaceError('Tile page released', 'cancelled');
}
const wantedTile = (page: Page, tile: CachedTile) =>
  tileWorkNeeded(cachePriority(page, tile), tileVisible(page, tile, y));
function skipTile(tile: CachedTile, decodeStarted: boolean) {
  const bytes = tile.source.encodedWidth * tile.source.encodedHeight * 4;
  skippedTiles++;
  if (!decodeStarted) skippedDecodeBytes += bytes;
  skippedUploadBytes += bytes;
  schedule();
}
function missingViewport(offset: number) {
  for (const page of pages.values())
    if (page.cache)
      for (const tile of page.cache)
        if (!tile.sprite && tileVisible(page, tile, offset)) return true;
  return false;
}
function makeRoom(cost: number, priority: number, source: ReaderPreparedTile) {
  let texture: Texture | null = null;
  while (cachedBytes + cost > tileLimit) {
    let victim: CachedTile | undefined,
      best = -1,
      reusableVictim = false;
    for (const page of pages.values())
      if (page.cache)
        for (const tile of page.cache) {
          if (!tile.sprite || page.pins.has(tile.source.index) || tileVisible(page, tile, y))
            continue;
          const rank = cachePriority(page, tile);
          if (rank < 5 && rank <= priority && priority !== 0) continue;
          const reusable =
            !texture &&
            rank === 5 &&
            tile.texture?.source instanceof ImageSource &&
            tile.texture.source.pixelWidth === source.encodedWidth &&
            tile.texture.source.pixelHeight === source.encodedHeight;
          // Equal distant victims have no lookahead role: prefer matching storage, then LRU.
          // Visible and nearby victim priorities/order remain unchanged.
          if (
            !victim ||
            rank > best ||
            (rank === best &&
              ((reusable && !reusableVictim) ||
                (reusable === reusableVictim && tile.used < victim.used)))
          ) {
            victim = tile;
            best = rank;
            reusableVictim = reusable;
          }
        }
    // Visible/warming tiles cannot be sacrificed to enforce a nominal pool size.
    if (!victim) return { accepted: priority === 0, texture };
    const compatible =
      !texture &&
      victim.texture?.source instanceof ImageSource &&
      victim.texture.source.pixelWidth === source.encodedWidth &&
      victim.texture.source.pixelHeight === source.encodedHeight;
    // Only recycle an eviction already required by the existing policy. No spare pool or changed lookahead.
    if (compatible) texture = evictTile(victim, true);
    else evictTile(victim);
  }
  return { accepted: true, texture };
}
function settleWarm() {
  for (let n = warmWaiters.length - 1; n >= 0; n--) {
    const waiter = warmWaiters[n];
    if (!waiter) continue;
    if (waiter.indices.some((index) => waiter.page.cache?.[index]?.failed)) {
      waiter.reject(new Error('Required tile is unavailable'));
      warmWaiters.splice(n, 1);
    } else if (waiter.indices.every((index) => !!waiter.page.cache?.[index]?.sprite)) {
      waiter.resolve();
      warmWaiters.splice(n, 1);
    }
  }
}
function startCache() {
  if (cacheBusy || disposed || !rendererReady) return;
  cacheTask = loadCache().catch((error) => {
    stop(y);
    tileIssue = true;
    reply({
      version: 1,
      kind: 'tile-error',
      error: error instanceof Error ? error.message : 'Tile loading failed',
    });
  });
}
async function loadCache() {
  if (cacheBusy || disposed) return;
  cacheBusy = true;
  try {
    while (!disposed) {
      let chosen: { page: Page; tile: CachedTile; priority: number; distance: number } | undefined;
      for (const page of pages.values())
        if (page.cache)
          for (const tile of page.cache) {
            if (tile.sprite || tile.failed) continue;
            const priority = cachePriority(page, tile);
            const center = page.box
              ? page.box.top +
                ((tile.source.top + tile.source.height / 2) * page.box.height) /
                  page.source.height -
                (demandY ?? y)
              : 0;
            const distance = Math.abs(center - (view?.height ?? 0) / 2);
            if (
              priority < 5 &&
              (!chosen ||
                priority < chosen.priority ||
                (priority === chosen.priority && distance < chosen.distance))
            )
              chosen = { page, tile, priority, distance };
          }
      if (!chosen) break;
      const { page, tile, priority } = chosen,
        source = tile.source,
        cost = source.encodedWidth * source.encodedHeight * 8;
      const room = makeRoom(cost, priority, source);
      if (!room.accepted) {
        room.texture?.destroy(true);
        break;
      }
      activeTileChapter = page.chapter;
      let bitmap: ImageBitmap | null = null,
        texture: Texture | null = room.texture;
      let decodeStarted = false;
      try {
        checkTilePage(page);
        cacheStaging = cost + source.bytes;
        await reserve(baseline() + stagingBytes);
        checkTilePage(page);
        if (!wantedTile(page, tile)) {
          skipTile(tile, decodeStarted);
          continue;
        }
        const response = await fetch(source.url, { signal: abort.signal, credentials: 'omit' });
        if (!response.ok || Number(response.headers.get('content-length')) !== source.bytes)
          throw new Error('Cached tile is unavailable');
        const blob = await response.blob();
        checkTilePage(page);
        if (blob.size !== source.bytes) throw new Error('Cached tile bytes are incomplete');
        if (!wantedTile(page, tile)) {
          skipTile(tile, decodeStarted);
          continue;
        }
        decodeStarted = true;
        bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
        checkTilePage(page);
        if (bitmap.width !== source.encodedWidth || bitmap.height !== source.encodedHeight)
          throw new Error('Cached tile dimensions do not match');
        if (!wantedTile(page, tile)) {
          skipTile(tile, decodeStarted);
          continue;
        }
        const frame = new Rectangle(source.offsetX, source.offsetY, source.width, source.height);
        if (texture) {
          texture.frame.copyFrom(frame);
          texture.orig.copyFrom(frame);
          texture.updateUvs();
        } else
          texture = new Texture({
            source: new ImageSource({
              resource: bitmap,
              autoGenerateMipmaps: false,
              autoGarbageCollect: false,
            }),
            frame,
          });
        const created = texture,
          current = renderer,
          decoded = bitmap;
        if (!current) throw new Error('Renderer closed');
        const uploadBytes = source.encodedWidth * source.encodedHeight * 4;
        let submitted = false;
        const submit = () => {
          checkTilePage(page);
          if (!wantedTile(page, tile)) return;
          if (room.texture) {
            // Same dimensions preserve GPU storage; Pixi uploads the replacement with texSubImage2D.
            // The old bitmap is closed at eviction; this single slot is covered by cacheStaging.
            created.source.resource = decoded;
            created.source.update();
          } else current.texture.initSource(created.source);
          cacheUploadBytes += uploadBytes;
          submitted = true;
        };
        if (cacheUploadBytes + uploadBytes <= CACHE_UPLOAD_LIMIT) submit();
        else
          await new Promise<void>((resolve, reject) => {
            upload = () => {
              try {
                submit();
                resolve();
              } catch (error) {
                reject(error);
              }
            };
            schedule();
          });
        checkTilePage(page);
        if (!submitted) {
          skipTile(tile, decodeStarted);
          continue;
        }
        const sprite = new Sprite({ texture });
        sprite.eventMode = 'none';
        sprite.position.set(source.left, source.top);
        page.node.addChild(sprite);
        tile.sprite = sprite;
        tile.texture = texture;
        tile.bitmap = bitmap;
        tile.cost = cost;
        tile.used = performance.now();
        cachedBytes += cost;
        bitmap = null;
        texture = null;
        if (visible(page)) visualDirty = true;
        settleWarm();
        schedule();
      } catch (error) {
        if (
          !disposed &&
          !wantedTile(page, tile) &&
          !(error instanceof SurfaceError && error.code === 'cancelled')
        ) {
          skipTile(tile, decodeStarted);
          continue;
        }
        if (error instanceof SurfaceError && error.code === 'deferred') {
          for (let n = warmWaiters.length - 1; n >= 0; n--)
            if (warmWaiters[n]?.page === page) {
              warmWaiters[n]?.reject(error);
              warmWaiters.splice(n, 1);
            }
          break;
        }
        tile.failed = true;
        settleWarm();
        if (!(error instanceof SurfaceError && error.code === 'cancelled')) throw error;
      } finally {
        texture?.destroy(true);
        bitmap?.close();
        activeTileChapter = null;
        cacheStaging = 0;
        if (!disposed) await reserve(baseline() + stagingBytes);
        releasePages();
      }
    }
  } finally {
    cacheBusy = false;
  }
}
async function prepareCached(message: Extract<PixiInput, { kind: 'prepare' }>) {
  const source = message.page,
    key = pageKey(source);
  check(source.id);
  await initializing;
  if (!cacheReservation) {
    // Reserve pool capacity before native background work starts, so streaming does not compete
    // with the decoder's exclusive workspace grant for each tiny tile increase.
    cacheReservation = tileLimit + 16 * MB;
    try {
      await reserve(baseline() + stagingBytes);
    } catch (error) {
      cacheReservation = 0;
      throw error;
    }
  }
  check(source.id);
  let page = pages.get(key);
  if (!page) {
    if (!source.tiles) throw new Error('Missing cached tile manifest');
    page = {
      chapter: source.id,
      source,
      node: new Container(),
      bitmaps: [],
      textures: [],
      tiles: [],
      documentId: '',
      padding: 0,
      accounted: false,
      pins: new Set(),
      cache: source.tiles.map((tile) => ({
        source: tile,
        sprite: null,
        texture: null,
        bitmap: null,
        used: 0,
        cost: 0,
        failed: false,
      })),
    };
    page.node.visible = false;
    pages.set(key, page);
    stage.addChild(page.node);
    const box = layout.get(key);
    if (box && view) {
      page.box = box;
      page.documentId = view.documentId;
    }
  } else if (
    page.source.pageId !== source.pageId ||
    page.source.sourceRevision !== source.sourceRevision ||
    page.source.width !== source.width ||
    page.source.height !== source.height
  )
    throw new Error('Cached page identity changed');
  page.chapter = source.id;
  page.source = source;
  page.retired = false;
  if (source.tiles && page.cache)
    for (const tile of page.cache) {
      const updated = source.tiles[tile.source.index];
      if (updated) tile.source = updated;
      tile.failed = false;
    }
  await initializing;
  check(source.id);
  if (message.warm && page.cache) {
    const warm = message.warm,
      indices = page.cache
        .filter(
          (tile) =>
            tile.source.top + tile.source.height > warm.top &&
            tile.source.top < warm.top + warm.height,
        )
        .map((tile) => tile.source.index);
    for (const index of indices) page.pins.add(index);
    const waiting = new Promise<void>((resolve, reject) =>
      warmWaiters.push({ page, indices, resolve, reject }),
    );
    startCache();
    settleWarm();
    try {
      await waiting;
    } finally {
      for (const index of indices) page.pins.delete(index);
    }
  }
  startCache();
  schedule();
  return { bitmapMs: 0, uploadMs: 0 };
}

// STATE AND COORDINATION — GPU PREPARATION
// One priority/FIFO page at a time; legacy whole-PNG upload remains tile-bounded.
const jobs: Extract<PixiInput, { kind: 'prepare' }>[] = [];
let preparing = false;
const cancelled = new Set<string>();
const check = (chapter: string) => {
  if (disposed || cancelled.has(chapter)) throw new SurfaceError('Page released', 'cancelled');
};
async function prepare(message: Extract<PixiInput, { kind: 'prepare' }>) {
  const { page } = message;
  if (page.tiles) return prepareCached(message);
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
    tiles: [],
    pins: new Set(),
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
        entry.tiles.push({ sprite, left, top, width, height });
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
    entry.node.visible = visible(entry);
    if (entry.node.visible) visualDirty = true;
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
    view?.renderWidth === next.renderWidth &&
    view.height === next.height &&
    view.ratio === next.ratio &&
    !missingViewport(y)
  ) {
    renderer.resize(next.renderWidth, next.height, next.ratio);
    visualDirty = true;
    schedule();
  }
}
function queueResize() {
  if (disposed || resizeTask || !view || !rendererReady || frameMatches(view) || missingViewport(y))
    return;
  resizeTask = resizeRenderer(view)
    .catch((error) =>
      reply({
        version: 1,
        kind: 'failed',
        error: error instanceof Error ? error.message : 'GPU resize failed',
      }),
    )
    .finally(() => {
      resizeTask = null;
      if (!disposed) schedule();
    });
}
async function initialize(message: Extract<PixiInput, { kind: 'init' }>) {
  view = message.view;
  speed = message.speed;
  maxFPS = message.maxFPS;
  tileLimit = message.tileMemoryMB * MB;
  tickWindowMs = message.tickWindowMs;
  smoothDurationMs = message.smoothDurationMs;
  y = view.y;
  maxY = view.maxY;
  control = view.control;
  if (!message.canvas) {
    await reserve(baseline());
    reply({ version: 1, kind: 'initialized' });
    return;
  }
  renderer = new WebGLRenderer();
  await reserve(baseline());
  await renderer.init({
    canvas: message.canvas,
    width: view.renderWidth,
    height: view.height,
    resolution: view.ratio,
    backgroundAlpha: 0,
    antialias: false,
    gcActive: false,
    failIfMajorPerformanceCaveat: true,
  });
  if (disposed) return;
  rendererReady = true;
  if (!frameMatches(view)) await resizeRenderer(view);
  const maximum: unknown = renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE);
  if (!finite(maximum, 4, 65536)) throw new Error('GPU texture limit is invalid');
  reply({ version: 1, kind: 'initialized' });
  reply({
    version: 1,
    kind: 'ready',
    backend: 'webgl',
    webGLVersion: renderer.context.webGLVersion,
    maxTextureSize: maximum,
  });
  schedule();
}

// LIFECYCLE AND CLEANUP — dispose settles pending work before acknowledging resources.
let pumpingTask: Promise<void> = Promise.resolve();
async function dispose() {
  disposed = true;
  abort.abort();
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  const pendingUpload = upload;
  upload = null;
  pendingUpload?.();
  for (const waiter of warmWaiters.splice(0))
    waiter.reject(new SurfaceError('Reader closed', 'cancelled'));
  for (const job of jobs.splice(0))
    reply({
      version: 1,
      kind: 'prepared',
      request: job.request,
      result: { ok: false, code: 'cancelled', error: 'Reader closed' },
      timing: { bitmapMs: 0, uploadMs: 0 },
    });
  await Promise.allSettled([initializing, pumpingTask, cacheTask, resourceChain, resizeTask]);
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
// STATE AND COORDINATION — MESSAGE DISPATCH
// One validated mailbox owns initialization, layout, input, preparation and release.
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
    if (
      !view ||
      view.documentId !== message.view.documentId ||
      view.x !== message.view.x ||
      view.width !== message.view.width ||
      view.height !== message.view.height ||
      view.ratio !== message.view.ratio ||
      view.renderLeft !== message.view.renderLeft ||
      view.renderWidth !== message.view.renderWidth
    )
      visualDirty = true;
    const changed = view?.documentId !== message.view.documentId;
    view = message.view;
    maxY = view.maxY;
    if (changed) {
      control = view.control;
      stop(view.y);
    }
    if (message.kind === 'layout') {
      const nextLayout = new Map(message.pages.map((box) => [box.key, box]));
      for (const [key, old] of layout)
        if (!nextLayout.has(key) && boxOnScreen(old)) visualDirty = true;
      for (const [key, box] of nextLayout) {
        const old = layout.get(key);
        if (
          (!old ||
            old.left !== box.left ||
            old.top !== box.top ||
            old.width !== box.width ||
            old.height !== box.height) &&
          (boxOnScreen(box) || (old && boxOnScreen(old)))
        )
          visualDirty = true;
      }
      layout.clear();
      for (const box of message.pages) layout.set(box.key, box);
    }
    for (const [key, page] of pages) {
      const box = layout.get(key);
      if (box) {
        page.box = box;
        page.documentId = view.documentId;
      }
      if (page.retired && page.documentId !== view.documentId) {
        pages.delete(key);
        destroyPage(page);
      }
    }
    queueResize();
    schedule();
    startCache();
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
      if (positionDirty) schedule();
    }
    if (message.serial === renderOutstanding) {
      renderOutstanding = 0;
      publishRender();
    }
  } else if (message.control >= control) {
    control = message.control;
    maxY = message.maxY;
    if (message.kind === 'wheel') {
      for (const page of pages.values())
        if (page.cache) for (const tile of page.cache) tile.failed = false;
      gesture = appendWheelTick(
        gesture,
        message.distance,
        message.time,
        speed,
        tickWindowMs,
        smoothDurationMs,
      );
      velocity = gesture.velocity;
      lastTime ??= performance.now();
      schedule();
    } else if (message.kind === 'speed') {
      const factor = message.speed / speed;
      speed = message.speed;
      gesture = scaleWheelGesture(gesture, factor, speed, smoothDurationMs);
      velocity = gesture.velocity;
      positionDirty = true;
      schedule();
    } else if (message.kind === 'smooth-duration') {
      gesture = scaleWheelDuration(gesture, smoothDurationMs, message.durationMs, speed);
      smoothDurationMs = message.durationMs;
      velocity = gesture.velocity;
      positionDirty = true;
      schedule();
    } else if (message.kind === 'stop') stop(message.y);
    else if (message.kind === 'rebase') {
      const nextY = Math.max(0, Math.min(maxY, y + message.delta));
      if (nextY !== y) visualDirty = true;
      y = nextY;
      demandY = null;
      positionDirty = true;
      schedule();
    }
  }
});
