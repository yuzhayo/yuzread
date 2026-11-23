import type { ReaderPreparedPage, ReaderWorkPriority, Result } from '../../../ShellHost.js';
import type {
  PixiInput,
  PixiOutput,
  PixiPageTiming,
  PixiView,
} from './BodyReaderPixiWorkerContract.js';

// CONFIG AND CONTRACT — the reader supplies document data and narrow capabilities.
export interface ReaderRenderPage {
  image: HTMLImageElement;
  page: ReaderPreparedPage;
}
export interface ReaderPixiOptions {
  gpu: boolean;
  momentum: boolean;
  speed: number;
  maxDecodedMB: number;
  getDocumentId(): string;
  getPages(): ReaderRenderPage[];
  canScroll(): boolean;
  onMotion(): void;
  reserve(owner: string, bytes: number, limit: number): Promise<Result>;
}
export class ReaderSurfaceError extends Error {
  constructor(
    message: string,
    readonly code?: 'deferred' | 'cancelled',
  ) {
    super(message);
  }
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const result = (v: unknown): v is Result =>
  record(v) &&
  (v.ok === true ||
    (v.ok === false &&
      typeof v.error === 'string' &&
      (v.code === undefined || v.code === 'deferred' || v.code === 'cancelled')));
function validOutput(v: unknown): v is PixiOutput {
  if (!record(v) || v.version !== 1) return false;
  switch (v.kind) {
    case 'initialized':
    case 'disposed':
      return true;
    case 'ready':
      return (
        v.backend === 'webgl' &&
        (v.webGLVersion === 1 || v.webGLVersion === 2) &&
        integer(v.maxTextureSize)
      );
    case 'rendered':
      return (
        integer(v.serial) && integer(v.revision) && integer(v.pages) && integer(v.visiblePages)
      );
    case 'prepared':
      return (
        integer(v.request) &&
        result(v.result) &&
        record(v.timing) &&
        typeof v.timing.bitmapMs === 'number' &&
        Number.isFinite(v.timing.bitmapMs) &&
        typeof v.timing.uploadMs === 'number' &&
        Number.isFinite(v.timing.uploadMs)
      );
    case 'released':
      return integer(v.request);
    case 'reserve':
      return integer(v.request) && integer(v.bytes) && v.bytes <= 4294967296;
    case 'position':
      return (
        integer(v.serial) &&
        integer(v.control) &&
        typeof v.y === 'number' &&
        Number.isFinite(v.y) &&
        v.y >= 0 &&
        typeof v.moving === 'boolean' &&
        typeof v.speed === 'number' &&
        Number.isFinite(v.speed) &&
        v.speed >= 0.1 &&
        v.speed <= 10
      );
    case 'failed':
      return typeof v.error === 'string';
    default:
      return false;
  }
}

export function attachReaderPixi(view: HTMLDivElement, options: ReaderPixiOptions) {
  const parent = view.parentElement;
  if (!parent) throw new Error('Reader is not mounted');
  const root = parent;
  const canvas = document.createElement('canvas');
  canvas.dataset.readerPixi = 'loading';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', view.getAttribute('aria-label') ?? 'Manga pages');
  Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none', opacity: '0' });
  const owner = crypto.randomUUID();
  const worker = new Worker(new URL('./BodyReaderPixiWorker.ts', import.meta.url), {
    type: 'module',
  });
  let closed = false,
    initialized = false,
    revision = 0,
    control = 0,
    requestId = 0;
  let speed = options.speed;
  view.dataset.scrollSpeed = String(speed);
  let baselineTop = view.scrollTop,
    documentId = '',
    layoutFrame: number | null = null;
  let timer: number | null = null,
    closing: Promise<void> | null = null,
    completeClose: (() => void) | null = null;
  let reserveChain: Promise<void> = Promise.resolve();
  let initializeResolve: (() => void) | null = null,
    initializeReject: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    initializeResolve = resolve;
    initializeReject = reject;
  });
  void ready.catch(() => {});
  const pending = new Map<
    number,
    { resolve: (value: PixiPageTiming) => void; reject: (error: Error) => void }
  >();
  const post = (value: PixiInput, transfers: Transferable[] = []) =>
    worker.postMessage(value, transfers);
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  function measure(): PixiView {
    return {
      revision: ++revision,
      control,
      documentId: options.getDocumentId(),
      width: Math.max(1, view.clientWidth),
      height: Math.max(1, view.clientHeight),
      ratio: window.devicePixelRatio || 1,
      x: view.scrollLeft,
      y: view.scrollTop,
      maxY: Math.max(0, view.scrollHeight - view.clientHeight),
    };
  }
  function positionCanvas() {
    const box = view.getBoundingClientRect(),
      parent = root.getBoundingClientRect();
    Object.assign(canvas.style, {
      left: `${box.left - parent.left + view.clientLeft}px`,
      top: `${box.top - parent.top + view.clientTop}px`,
      width: `${view.clientWidth}px`,
      height: `${view.clientHeight}px`,
    });
  }
  function syncLayout() {
    if (closed) return;
    if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
    const next = measure();
    if (documentId !== next.documentId) {
      documentId = next.documentId;
      next.control = ++control;
      baselineTop = view.scrollTop;
      view.dataset.readerMoving = 'false';
    }
    positionCanvas();
    const bounds = view.getBoundingClientRect();
    const pages = options
      .getPages()
      .filter((entry) => entry.image.isConnected)
      .map((entry) => {
        const box = entry.image.getBoundingClientRect();
        return {
          key: `${entry.page.id}:${entry.page.index}`,
          left: box.left - bounds.left - view.clientLeft + view.scrollLeft,
          top: box.top - bounds.top - view.clientTop + view.scrollTop,
          width: box.width,
          height: box.height,
        };
      })
      .filter((box) => box.width > 0 && box.height > 0);
    post({ version: 1, kind: 'layout', view: next, pages });
  }
  const queueLayout = () => {
    if (!closed && layoutFrame === null) layoutFrame = requestAnimationFrame(syncLayout);
  };
  function stop() {
    if (closed) return;
    baselineTop = view.scrollTop;
    view.dataset.readerMoving = 'false';
    post({
      version: 1,
      kind: 'stop',
      control: ++control,
      y: view.scrollTop,
      maxY: Math.max(0, view.scrollHeight - view.clientHeight),
    });
  }
  function scroll() {
    if (closed) return;
    const actual = view.scrollTop,
      delta = actual - baselineTop;
    if (Math.abs(delta) > 0.5) {
      post({
        version: 1,
        kind: 'rebase',
        control: ++control,
        delta,
        maxY: Math.max(0, view.scrollHeight - view.clientHeight),
      });
      baselineTop = actual;
    }
    post({ version: 1, kind: 'view', view: measure() });
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function wheel(event: WheelEvent) {
    if (event.ctrlKey) {
      stop();
      return;
    }
    const mode = event.deltaMode;
    if (
      !initialized ||
      !options.canScroll() ||
      !event.cancelable ||
      event.defaultPrevented ||
      event.shiftKey ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
      !Number.isFinite(event.deltaY) ||
      !event.deltaY
    )
      return;
    const unit =
      mode === 2
        ? view.clientHeight
        : mode === 1
          ? parseFloat(getComputedStyle(view).lineHeight) || 16
          : 1;
    const distance = Math.max(-1e6, Math.min(1e6, event.deltaY * unit * speed));
    // Fine pixel streams already carry device inertia; leave them native rather than adding a second coast.
    if (mode === 0 && Math.abs(event.deltaY) < 40) {
      stop();
      if (speed !== 1) {
        event.preventDefault();
        event.stopPropagation();
        options.onMotion();
        view.scrollTop += distance;
        scroll();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    options.onMotion();
    if (reduced.matches || !options.momentum) {
      stop();
      view.scrollTop += distance;
      scroll();
      return;
    }
    post({
      version: 1,
      kind: 'wheel',
      control: ++control,
      distance,
      maxY: Math.max(0, view.scrollHeight - view.clientHeight),
    });
  }
  const key = (event: KeyboardEvent) => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) return;
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'PageUp',
        'PageDown',
        'Home',
        'End',
        ' ',
      ].includes(event.key) ||
      (event.ctrlKey && (event.key === '0' || event.code === 'Numpad0'))
    )
      stop();
  };
  const visibility = () => {
    stop();
    if (!document.hidden) queueLayout();
  };
  const resize = new ResizeObserver(queueLayout),
    mutation = new MutationObserver(queueLayout);
  function fail(error: Error) {
    if (closed) return;
    view.dataset.pixiError = error.message;
    initializeReject?.(error);
    for (const value of pending.values()) value.reject(error);
    pending.clear();
    void close();
  }
  function receive(event: MessageEvent<unknown>) {
    if (!validOutput(event.data)) {
      fail(new Error('Invalid renderer reply'));
      return;
    }
    const message = event.data;
    if (message.kind === 'reserve') {
      reserveChain = reserveChain.then(async () => {
        let result: Result;
        try {
          result = await options.reserve(owner, message.bytes, options.maxDecodedMB);
        } catch (error) {
          result = {
            ok: false,
            error: error instanceof Error ? error.message : 'Render reservation failed',
          };
        }
        post({ version: 1, kind: 'reservation', request: message.request, result });
      });
      return;
    }
    if (message.kind === 'disposed') {
      void reserveChain
        .then(() => options.reserve(owner, 0, options.maxDecodedMB))
        .catch(() => {})
        .finally(finish);
      return;
    }
    if (closed) return;
    if (message.kind === 'initialized') {
      initialized = true;
      initializeResolve?.();
      if (!options.gpu) clearTimer();
    } else if (message.kind === 'ready') {
      clearTimer();
      canvas.dataset.pixiBackend = message.backend;
      canvas.dataset.pixiWebgl = String(message.webGLVersion);
    } else if (message.kind === 'position') {
      post({ version: 1, kind: 'ack', serial: message.serial });
      if (message.control !== control) return;
      view.dataset.workerSpeed = String(message.speed);
      if (!options.canScroll()) {
        if (message.moving) stop();
        return;
      }
      options.onMotion();
      view.scrollTop = message.y;
      baselineTop = view.scrollTop;
      view.dataset.readerMoving = String(message.moving);
    } else if (message.kind === 'rendered') {
      post({ version: 1, kind: 'ack', serial: message.serial });
      canvas.dataset.pixiRevision = String(message.revision);
      canvas.dataset.pixiPages = String(message.pages);
      canvas.dataset.pixiVisiblePages = String(message.visiblePages);
      if (message.visiblePages > 0) {
        canvas.dataset.readerPixi = 'ready';
        canvas.style.opacity = '1';
      }
    } else if (message.kind === 'prepared') {
      const task = pending.get(message.request);
      pending.delete(message.request);
      if (message.result.ok) task?.resolve(message.timing);
      else task?.reject(new ReaderSurfaceError(message.result.error, message.result.code));
    } else if (message.kind === 'released') {
      pending.get(message.request)?.resolve({ bitmapMs: 0, uploadMs: 0 });
      pending.delete(message.request);
    } else if (message.kind === 'failed') fail(new Error(message.error));
  }
  const workerError = (event: ErrorEvent) =>
    fail(new Error(event.message || 'Renderer worker failed'));
  const messageError = () => fail(new Error('Renderer message could not be decoded'));
  function request(value: (request: number) => PixiInput): Promise<PixiPageTiming> {
    if (closed)
      return Promise.reject(new ReaderSurfaceError('Reader renderer closed', 'cancelled'));
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post(value(id));
    });
  }
  function finish() {
    clearTimer();
    worker.terminate();
    canvas.remove();
    view.dataset.readerMoving = 'false';
    for (const task of pending.values())
      task.reject(new ReaderSurfaceError('Reader closed', 'cancelled'));
    pending.clear();
    completeClose?.();
    completeClose = null;
  }
  function close(): Promise<void> {
    if (closing) return closing;
    stop();
    closed = true;
    initialized = false;
    canvas.style.opacity = '0';
    if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
    resize.disconnect();
    mutation.disconnect();
    view.removeEventListener('scroll', scroll);
    root.removeEventListener('wheel', wheel, { capture: true });
    root.removeEventListener('pointerdown', stop, { capture: true });
    root.removeEventListener('input', stop, { capture: true });
    window.removeEventListener('keydown', key, { capture: true });
    window.removeEventListener('blur', stop);
    window.removeEventListener('pagehide', closeOnHide);
    document.removeEventListener('visibilitychange', visibility);
    reduced.removeEventListener('change', stop);
    clearTimer();
    closing = new Promise((resolve) => {
      completeClose = resolve;
    });
    post({ version: 1, kind: 'dispose' });
    // A timeout terminates the worker but deliberately does not recycle uncertain native reservation ownership.
    timer = window.setTimeout(finish, 10000);
    return closing;
  }
  const closeOnHide = () => {
    void close();
  };
  worker.addEventListener('message', receive);
  worker.addEventListener('error', workerError);
  worker.addEventListener('messageerror', messageError);
  const offscreen = options.gpu ? canvas.transferControlToOffscreen() : null;
  if (options.gpu) {
    view.after(canvas);
    positionCanvas();
  }
  post(
    { version: 1, kind: 'init', canvas: offscreen, view: measure(), speed },
    offscreen ? [offscreen] : [],
  );
  resize.observe(view);
  const strip = view.querySelector('[data-reader-pages]');
  if (strip)
    mutation.observe(strip, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });
  view.addEventListener('scroll', scroll, { passive: true });
  root.addEventListener('wheel', wheel, { capture: true, passive: false });
  root.addEventListener('pointerdown', stop, { capture: true, passive: true });
  root.addEventListener('input', stop, { capture: true, passive: true });
  window.addEventListener('keydown', key, { capture: true });
  window.addEventListener('blur', stop);
  window.addEventListener('pagehide', closeOnHide, { once: true });
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', stop);
  timer = window.setTimeout(() => fail(new Error('GPU worker initialization timed out')), 15000);
  return {
    setSpeed(next: number) {
      if (closed || !Number.isFinite(next) || next < 0.1 || next > 10 || next === speed) return;
      speed = next;
      view.dataset.scrollSpeed = String(next);
      post({
        version: 1,
        kind: 'speed',
        control: ++control,
        speed,
        maxY: Math.max(0, view.scrollHeight - view.clientHeight),
      });
    },
    stop,
    syncLayout,
    close,
    async preparePage(page: ReaderPreparedPage, priority: ReaderWorkPriority) {
      await ready;
      return request((id) => ({ version: 1, kind: 'prepare', request: id, page, priority }));
    },
    async releaseChapter(chapter: string) {
      if (!closed) await request((id) => ({ version: 1, kind: 'release', request: id, chapter }));
    },
  };
}
