import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import Box from '@mui/material/Box';
import { configuredSx } from '@logic/Appearance.ts';
import { errorText, finite, isColor, isObject } from '@logic/VisualConfig.ts';
import type {
  Chapter,
  PageMetadata,
  ReaderOpenOptions,
  ReaderOpenResult,
  ReaderPrepareResult,
  ReaderPrepareRequest,
  ReaderPreparedPage,
  ReaderChapterRequest,
  ReaderChapterResult,
  ReaderCatalog,
  Result,
  ReaderWorkPriority,
  ReaderMetricEvent,
  ReaderMetricValue,
  ReaderNavigationRequest,
  ReaderNavigationState,
  ReaderDropRequest,
  ReaderNumberSettingChange,
  ReaderPreferenceSnapshot,
  ReaderPreferenceUpdate,
} from '../../../../ShellHost.js';
import { defineChild } from '@logic/AreaDiscovery.ts';
import type { ConfigReport, ChildProps } from '@logic/AreaDiscovery.ts';
import { hasParts, isNamedRecord } from '@logic/ConfigValidation.ts';
import { hasRequestPort, hasStatePort } from '@logic/ParentConnections.ts';
import { attachReaderPixi, ReaderSurfaceError } from './BodyReaderPixi.ts';
import type { ResolvedConfig, ResolvedPart } from '@logic/ConfigValidation.ts';
import type {
  BodyPorts,
  ReaderOpenIntent,
  ReaderPhase,
  ReaderState,
  ScreenOpenResult,
} from '../BodyContract.ts';
export interface BodyReaderInput {
  openArchive(options: ReaderOpenOptions): Promise<ReaderOpenResult>;
  openExternalArchive(options: ReaderOpenOptions): Promise<ReaderOpenResult>;
  externalOpenRevision: number;
  openDroppedArchive(request: ReaderDropRequest): Promise<ReaderOpenResult>;
  openChapter(request: ReaderChapterRequest): Promise<ReaderChapterResult>;
  preparePage(request: ReaderPrepareRequest): Promise<ReaderPrepareResult>;
  releaseChapter(id: string): Promise<Result>;
  registerOpenRequest(handler: (source: ReaderOpenIntent) => Promise<ScreenOpenResult>): () => void;
  publishState(state: ReaderState): void;
  registerScrollSpeed(
    handler: (change: ReaderNumberSettingChange) => Result | Promise<Result>,
  ): () => void;
  publishScrollSpeed(speed: number): void;
  registerSmoothScrollDuration(
    handler: (change: ReaderNumberSettingChange) => Result | Promise<Result>,
  ): () => void;
  publishSmoothScrollDuration(durationMs: number): void;
  preferences: ReaderPreferenceSnapshot | null;
  persistPreference(update: ReaderPreferenceUpdate): Promise<Result>;
  registerNavigation(handler: (request: ReaderNavigationRequest) => Promise<Result>): () => void;
  publishNavigation(state: ReaderNavigationState): void;
  submitReaderMetrics(events: ReaderMetricEvent[]): Promise<Result>;
  reserveRender(
    request: import('../../../../ShellHost.js').ReaderRenderReserveRequest,
  ): Promise<Result>;
}

// CONFIG AND CONTRACT — one body-owned block, not separate discovered page controls.
export const componentId = 'reader.cbz';
export const partKeys = ['overlay', 'status'] as const;
const labelKeys = [
  'open',
  'replace',
  'empty',
  'scanning',
  'preparing',
  'ready',
  'failed',
  'loading',
  'zoomIn',
  'zoomOut',
] as const;
export interface ReaderConfig extends ResolvedConfig {
  initialPages: number;
  maxDecodedMB: number;
  maxRenderWidth: number;
  pageGap: number;
  pageInset: number;
  minZoom: number;
  maxZoom: number;
  zoomStep: number;
  diagnostics?: boolean;
  renderer?: 'dom' | 'pixi';
  maxFPS?: number;
  tileMemoryMB?: number;
  momentum?: { enabled: boolean; tickWindowMs?: number };
  scrollbar: ScrollbarSettings;
  labels: Record<(typeof labelKeys)[number], string>;
  parts: Record<(typeof partKeys)[number], ResolvedPart>;
}
interface ReaderChapter extends Chapter {
  alive: boolean;
  images: Map<number, HTMLImageElement>;
  pendingImages: Set<HTMLImageElement>;
  acceptedWidths: Map<number, number>;
  slots: HTMLDivElement[];
  decodeWidth: number;
  geometry: { readonly ratio: number; readonly maximumPixels: number };
  index: number;
  root: HTMLDivElement;
  complete: boolean;
  preparedPages: Map<number, ReaderPreparedPage>;
}
interface ChapterRecord {
  index: number;
  entryId: string;
  sourceRevision: string;
  pages: PageMetadata[];
  geometry: ReaderChapter['geometry'];
  width: number;
  height: number;
  chapter?: ReaderChapter;
}
interface ReaderSession {
  sceneId: string;
  focusIndex?: number;
  catalog: ReaderCatalog;
  alive: boolean;
  paused: boolean;
  epoch: number;
  records: Map<number, ChapterRecord>;
  errors: Map<number, string>;
  observer: IntersectionObserver;
  first: number;
  last: number;
  width: number;
  probeHeight: number;
  jobs: Map<number, ChapterJob>;
  pumping: boolean;
  serial: number;
  notice: { index: number; message: string } | null;
  restoredTop: number | null;
  lastTop: number;
}
interface ChapterJob {
  transferred: boolean;
  headerTask?: Promise<ReaderChapterResult>;
  index: number;
  epoch: number;
  priority: ReaderWorkPriority;
  serial: number;
  geometry: ReaderChapter['geometry'];
  chapter?: ReaderChapter;
  mounted: boolean;
  blocked: boolean;
  remaining: Set<number>;
  offsets: number[];
  height: number;
  operation: 'open' | number | null;
}
class ReaderDeferredError extends Error {}
class ReaderCancelledError extends Error {}
const priorityRank = (priority: ReaderWorkPriority) =>
  priority === 'demand' ? 0 : priority === 'visible' ? 1 : 2;
// Offset lookup is independent of DOM/page image state, including a history spacer.
export function pageAtOffset(offsets: readonly number[], offset: number): number {
  let low = 0,
    high = offsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((offsets[middle] ?? Infinity) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}
interface ReaderDisplay {
  name: string;
  count: number;
  total: number;
  phase: ReaderPhase;
  error: string;
}
// Prepared pixels must belong to this immutable chapter/page, not just any valid URL.
export function acceptsPreparedPage(
  chapter: Chapter,
  page: PageMetadata,
  requestedWidth: number,
  result: ReaderPreparedPage,
): boolean {
  if (
    !Number.isInteger(requestedWidth) ||
    requestedWidth < 1 ||
    !Number.isInteger(result.width) ||
    result.width < 1 ||
    !Number.isInteger(result.height)
  )
    return false;
  const width = Math.min(page.width, requestedWidth),
    height = Math.max(1, Math.round((page.height * width) / page.width));
  return (
    result.id === chapter.id &&
    (result.tiles === undefined ||
      (result.catalogId === chapter.catalogId && result.entryId === chapter.entryId)) &&
    result.sourceRevision === chapter.sourceRevision &&
    result.pageId === page.id &&
    result.index === page.index &&
    result.requestedWidth === requestedWidth &&
    result.width === width &&
    Math.abs(result.height - height) <= 1 &&
    result.height > 0
  );
}
export const retainsAcceptedWidth = (accepted: number | undefined, incoming: number): boolean =>
  accepted !== undefined && incoming <= accepted;
export const acceptsCatalogChapter = (
  catalog: ReaderCatalog,
  entryId: string,
  chapter: Chapter,
): boolean =>
  chapter.catalogId === catalog.id &&
  chapter.entryId === entryId &&
  catalog.chapters.some((entry) => entry.id === entryId && entry.name === chapter.name) &&
  chapter.pages.length > 0 &&
  chapter.pages.every((page, index) => page.index === index);
const storedChapterMatches = (record: ChapterRecord | undefined, chapter: Chapter) =>
  !record ||
  (record.sourceRevision === chapter.sourceRevision &&
    record.pages.length === chapter.pages.length &&
    record.pages.every((page, index) => {
      const next = chapter.pages[index];
      return (
        next && page.id === next.id && page.width === next.width && page.height === next.height
      );
    }));
export function chapterNavigationIndex(
  chapters: readonly { id: string }[],
  currentId: string,
  request: ReaderNavigationRequest,
): number {
  const current = chapters.findIndex((entry) => entry.id === currentId);
  const index =
    request.action === 'select'
      ? chapters.findIndex((entry) => entry.id === request.entryId)
      : current < 0
        ? -1
        : current + (request.action === 'previous' ? -1 : 1);
  return index >= 0 && index < chapters.length ? index : -1;
}
export const configKeys = [
  'initialPages',
  'maxDecodedMB',
  'maxRenderWidth',
  'pageGap',
  'pageInset',
  'minZoom',
  'maxZoom',
  'zoomStep',
  'labels',
  'diagnostics',
  'renderer',
  'maxFPS',
  'tileMemoryMB',
  'momentum',
  'scrollbar',
];
export function validateConfig(
  config: ResolvedConfig,
  report: ConfigReport,
): config is ReaderConfig {
  let valid = hasParts(config, partKeys);
  const reject: ConfigReport = (key, expected, actual) => {
    valid = false;
    report(key, expected, actual);
  };
  if (!Number.isInteger(config.initialPages) || !finite(config.initialPages, 3, 5))
    reject('initialPages', '3–5 initial pages', config.initialPages);
  if (!Number.isInteger(config.maxDecodedMB) || !finite(config.maxDecodedMB, 64, 4096))
    reject('maxDecodedMB', '64–4096 MB shared reader budget', config.maxDecodedMB);
  if (!Number.isInteger(config.maxRenderWidth) || !finite(config.maxRenderWidth, 320, 8192))
    reject('maxRenderWidth', '320–8192 physical pixels', config.maxRenderWidth);
  if (!finite(config.pageGap, 0, 100)) reject('pageGap', '0–100 CSS pixels', config.pageGap);
  if (!finite(config.pageInset, 0, 200)) reject('pageInset', '0–200 CSS pixels', config.pageInset);
  if (
    !finite(config.minZoom, 0.25, 1) ||
    !finite(config.maxZoom, 1, 8) ||
    config.minZoom >= config.maxZoom
  ) {
    reject('minZoom', 'min zoom below max zoom, both 0.25–8', {
      min: config.minZoom,
      max: config.maxZoom,
    });
  }
  if (!finite(config.zoomStep, 0.05, 1)) reject('zoomStep', '0.05–1 zoom step', config.zoomStep);
  if (config.diagnostics !== undefined && typeof config.diagnostics !== 'boolean')
    reject('diagnostics', 'boolean opt-in, default false', config.diagnostics);
  if (config.renderer !== undefined && config.renderer !== 'dom' && config.renderer !== 'pixi')
    reject('renderer', 'dom or pixi', config.renderer);
  if (
    config.maxFPS !== undefined &&
    (!Number.isInteger(config.maxFPS) || (config.maxFPS !== 0 && !finite(config.maxFPS, 10, 240)))
  )
    reject('maxFPS', '0 (uncapped) or 10–240 frame ceiling', config.maxFPS);
  if (
    config.tileMemoryMB !== undefined &&
    (!Number.isInteger(config.tileMemoryMB) || !finite(config.tileMemoryMB, 16, 512))
  )
    reject('tileMemoryMB', '16–512 MB estimated tile surfaces', config.tileMemoryMB);
  if (
    config.momentum !== undefined &&
    (!isObject(config.momentum) ||
      typeof config.momentum.enabled !== 'boolean' ||
      (config.momentum.tickWindowMs !== undefined &&
        (!Number.isInteger(config.momentum.tickWindowMs) ||
          !finite(config.momentum.tickWindowMs, 50, 300))) ||
      Object.keys(config.momentum).some((key) => !['enabled', 'tickWindowMs'].includes(key)))
  )
    reject('momentum', 'enabled boolean and optional tickWindowMs 50–300', config.momentum);
  if (
    !isNamedRecord(
      config.labels,
      labelKeys,
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    )
  )
    reject('labels', 'all reader status/action labels', config.labels);
  if (!validateReaderScrollbar(config.scrollbar, report)) valid = false;
  return valid;
}

// CHILD REGISTRATION — BodyReader consumes every declared Body capability, and no host global.
const acceptsParentPorts = (value: unknown): value is BodyPorts =>
  hasRequestPort(
    value,
    'navigateChapter',
    'ui.reader.navigation.input',
    'ui.reader.navigation.output',
  ) &&
  hasStatePort(value, 'navigation', 'ui.reader.navigation.state') &&
  hasRequestPort(value, 'setScrollSpeed', 'ui.reader.speed.input', 'ui.reader.speed.output') &&
  hasStatePort(value, 'scrollSpeed', 'ui.reader.speed.state') &&
  hasRequestPort(
    value,
    'setSmoothScrollDuration',
    'ui.reader.smooth-duration.input',
    'ui.reader.smooth-duration.output',
  ) &&
  hasStatePort(value, 'smoothScrollDuration', 'ui.reader.smooth-duration.state') &&
  hasStatePort(value, 'readerPreferences', 'native.reader.preferences.state') &&
  hasRequestPort(
    value,
    'saveReaderPreference',
    'native.reader.preference.input',
    'native.result',
  ) &&
  hasRequestPort(value, 'open', 'ui.open.input.v2', 'ui.open.output') &&
  hasStatePort(value, 'readerState', 'ui.reader.state') &&
  hasRequestPort(
    value,
    'archiveOpen',
    'native.reader.open.input.v3',
    'native.reader.open.output.v4',
  ) &&
  hasRequestPort(
    value,
    'externalOpen',
    'native.reader.external-open.input.v1',
    'native.reader.open.output.v4',
  ) &&
  hasStatePort(value, 'externalOpenRevision', 'native.reader.external-open.revision') &&
  hasRequestPort(value, 'dropOpen', 'native.reader.drop.input', 'native.reader.open.output.v4') &&
  hasRequestPort(
    value,
    'chapterOpen',
    'native.reader.chapter.input.v2',
    'native.reader.chapter.output.v2',
  ) &&
  hasRequestPort(
    value,
    'prepare',
    'native.reader.prepare.input.v3',
    'native.reader.prepare.output.v3',
  ) &&
  hasRequestPort(value, 'release', 'native.reader.release.input', 'native.result') &&
  hasRequestPort(value, 'readerMetrics', 'native.reader.metrics.input', 'native.result') &&
  hasRequestPort(value, 'renderReserve', 'native.reader.render-reserve.input', 'native.result');
export const child = defineChild(
  'Body',
  BodyReader,
  validateConfig,
  { componentId, configKeys, partKeys },
  acceptsParentPorts,
  (ports) => ({
    openArchive: ports.archiveOpen.request,
    openExternalArchive: ports.externalOpen.request,
    externalOpenRevision: ports.externalOpenRevision.getSnapshot(),
    openDroppedArchive: ports.dropOpen.request,
    openChapter: ports.chapterOpen.request,
    preparePage: ports.prepare.request,
    releaseChapter: ports.release.request,
    registerOpenRequest: ports.open.register,
    publishState: ports.readerState.publish,
    submitReaderMetrics: ports.readerMetrics.request,
    reserveRender: ports.renderReserve.request,
    registerScrollSpeed: ports.setScrollSpeed.register,
    publishScrollSpeed: ports.scrollSpeed.publish,
    registerSmoothScrollDuration: ports.setSmoothScrollDuration.register,
    publishSmoothScrollDuration: ports.smoothScrollDuration.publish,
    preferences: ports.readerPreferences.getSnapshot(),
    persistPreference: ports.saveReaderPreference.request,
    registerNavigation: ports.navigateChapter.register,
    publishNavigation: ports.navigation.publish,
  }),
);

// LOGIC AND CALCULATIONS
// GEOMETRY — base geometry is fixed per opening; explicit zoom is separate.
const displayBox = (page: PageMetadata, maximumPixels: number, ratio: number) => {
  const widthPixels = Math.min(page.width, Math.max(1, Math.floor(maximumPixels)));
  const heightPixels = Math.max(1, Math.round((page.height * widthPixels) / page.width));
  return { width: widthPixels / ratio, height: heightPixels / ratio, pixels: widthPixels };
};
export const normalizeZoom = (value: number, min: number, max: number, step: number) => {
  if (!Number.isFinite(value)) return 1;
  // Anchor the step grid at 100%, so reset is exact even with a custom step.
  const snapped = 1 + Math.round((value - 1) / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
};

// STATE AND COORDINATION
// DIAGNOSTICS — no monitor/listeners/timers/frame callbacks exist when disabled.
export function createScrollContinuity() {
  let x = 0,
    y = 0,
    ready = false,
    expectedUntil = -1;
  return {
    expect(now: number) {
      expectedUntil = Math.max(expectedUntil, now + 750);
    },
    reset(nextX: number, nextY: number) {
      x = nextX;
      y = nextY;
      ready = true;
    },
    observe(nextX: number, nextY: number, now: number) {
      const dx = nextX - x,
        dy = nextY - y;
      const unexpected = ready && now > expectedUntil && (Math.abs(dx) >= 2 || Math.abs(dy) >= 2);
      x = nextX;
      y = nextY;
      ready = true;
      return { dx, dy, unexpected };
    },
  };
}
interface ReaderMetrics {
  record(kind: ReaderMetricEvent['kind'], values: Record<string, ReaderMetricValue>): void;
  expect(reason: string): void;
  close(): void;
}
function useReaderMetrics(
  enabled: boolean,
  viewport: RefObject<HTMLDivElement | null>,
  submit: BodyReaderInput['submitReaderMetrics'],
) {
  const metrics = useRef<ReaderMetrics | null>(null);
  useEffect(() => {
    const view = viewport.current,
      root = view?.parentElement;
    if (!enabled || !view || !root) return undefined;
    const continuity = createScrollContinuity();
    continuity.reset(view.scrollLeft, view.scrollTop);
    let closed = false,
      failed = false,
      sending = false,
      dropped = 0,
      dragging = false;
    let width = view.clientWidth,
      height = view.clientHeight,
      lastActivity = 0;
    let timer: number | null = null,
      frame: number | null = null,
      previousFrame: number | null = null;
    let sampleStart = 0,
      samples = 0,
      maximumGap = 0,
      hitches = 0;
    const pending: ReaderMetricEvent[] = [];
    const scheduleFlush = () => {
      if (timer !== null || closed || failed || !pending.length) return;
      timer = window.setTimeout(() => {
        timer = null;
        flush();
      }, 1000);
    };
    const record = (kind: ReaderMetricEvent['kind'], values: Record<string, ReaderMetricValue>) => {
      if (closed || failed) return;
      if (pending.length >= 127) dropped++;
      else pending.push({ kind, clockMs: performance.now(), values });
      scheduleFlush();
    };
    const flush = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (sending || !pending.length || failed) return;
      const batch = pending.splice(0);
      if (dropped) {
        batch.push({
          kind: 'motion',
          clockMs: performance.now(),
          values: { reason: 'dropped-metrics', count: dropped },
        });
        dropped = 0;
      }
      sending = true;
      void submit(batch)
        .then((result) => {
          if (!result.ok) failed = true;
        })
        .catch(() => {
          failed = true;
        })
        .finally(() => {
          sending = false;
          if (failed) stopFrames();
          else if (closed) flush();
          else scheduleFlush();
        });
    };
    const summary = () => {
      if (samples > 1 && previousFrame !== null && previousFrame > sampleStart)
        record('frame-summary', {
          metric: 'raf-callback-cadence',
          samples,
          durationMs: previousFrame - sampleStart,
          callbackHz: ((samples - 1) * 1000) / (previousFrame - sampleStart),
          maxGapMs: maximumGap,
          hitches,
        });
      previousFrame = null;
      samples = 0;
      maximumGap = 0;
      hitches = 0;
    };
    const stopFrames = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      summary();
    };
    const sample = (now: number) => {
      frame = null;
      if (closed || failed || document.hidden) {
        stopFrames();
        return;
      }
      if (previousFrame !== null) {
        const gap = now - previousFrame;
        maximumGap = Math.max(maximumGap, gap);
        if (gap >= 25) {
          hitches++;
          record('frame-gap', { durationMs: gap, metric: 'raf-callback-gap' });
        }
      } else sampleStart = now;
      previousFrame = now;
      samples++;
      if (now - lastActivity <= 350) frame = requestAnimationFrame(sample);
      else summary();
    };
    const activity = () => {
      if (closed || failed || document.hidden) return;
      lastActivity = performance.now();
      if (frame === null) frame = requestAnimationFrame(sample);
    };
    const expect = (reason: string) => {
      if (closed || failed) return;
      continuity.expect(performance.now());
      activity();
      if (['open', 'layout', 'zoom', 'resize'].includes(reason)) record('motion', { reason });
    };
    const scroll = () => {
      if (view.clientWidth !== width || view.clientHeight !== height) {
        width = view.clientWidth;
        height = view.clientHeight;
        expect('resize');
      }
      if (dragging) expect('pointer');
      const motion = continuity.observe(view.scrollLeft, view.scrollTop, performance.now());
      if (motion.unexpected)
        record('scroll-jump', {
          dx: motion.dx,
          dy: motion.dy,
          reason: 'no-recent-input-or-layout',
        });
      activity();
    };
    const wheel = () => expect('wheel');
    const key = (event: KeyboardEvent) => {
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
        ].includes(event.key)
      )
        expect('key');
    };
    const down = () => {
      dragging = true;
      expect('pointer');
    };
    const up = () => {
      dragging = false;
      expect('pointer-release');
    };
    const input = () => expect('scrollbar');
    const resize = () => expect('resize');
    const visibility = () => {
      stopFrames();
      continuity.reset(view.scrollLeft, view.scrollTop);
    };
    const blur = () => {
      dragging = false;
      visibility();
    };
    root.addEventListener('wheel', wheel, { capture: true, passive: true });
    root.addEventListener('pointerdown', down, { capture: true, passive: true });
    root.addEventListener('input', input, { capture: true, passive: true });
    view.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('keydown', key, { capture: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur);
    let longTasks: PerformanceObserver | null = null;
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      longTasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) record('long-task', { durationMs: entry.duration });
      });
      longTasks.observe({ type: 'longtask', buffered: true });
    }
    const monitor: ReaderMetrics = {
      record(kind, values) {
        record(kind, values);
        if (kind === 'image' || kind === 'attach') activity();
      },
      expect,
      close() {
        if (closed) return;
        stopFrames();
        flush();
        closed = true;
        if (timer !== null) clearTimeout(timer);
        root.removeEventListener('wheel', wheel, { capture: true });
        root.removeEventListener('pointerdown', down, { capture: true });
        root.removeEventListener('input', input, { capture: true });
        view.removeEventListener('scroll', scroll);
        window.removeEventListener('keydown', key, { capture: true });
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('blur', blur);
        longTasks?.disconnect();
      },
    };
    metrics.current = monitor;
    window.addEventListener('pagehide', monitor.close, { once: true });
    return () => {
      window.removeEventListener('pagehide', monitor.close);
      monitor.close();
      if (metrics.current === monitor) metrics.current = null;
    };
  }, [enabled, viewport, submit]);
  return metrics;
}

// UI AND LOCAL EVENTS
// SCROLLBAR — a floating control for the native scroller; never a layout gutter.
interface ScrollbarSettings {
  width: number;
  radius: number;
  inset: number;
  colors: Record<'hidden' | 'track' | 'thumb' | 'hover' | 'active', string>;
}
function validateReaderScrollbar(
  settings: unknown,
  report: ConfigReport,
): settings is ScrollbarSettings {
  const colors = ['hidden', 'track', 'thumb', 'hover', 'active'];
  if (
    !isObject(settings) ||
    Object.keys(settings).some((key) => !['width', 'radius', 'inset', 'colors'].includes(key)) ||
    !finite(settings.width, 8, 32) ||
    !finite(settings.radius, 0, 16) ||
    !finite(settings.inset, 0, settings.width / 2 - 0.5) ||
    !isObject(settings.colors) ||
    !isNamedRecord(settings.colors, colors, isColor)
  ) {
    report('scrollbar', 'width/radius/inset in CSS pixels and all scrollbar colors', settings);
    return false;
  }
  return true;
}

function useReaderScrollbar(
  viewport: RefObject<HTMLDivElement | null>,
  strip: RefObject<HTMLDivElement | null>,
  settings: ScrollbarSettings,
  label: string,
) {
  const control = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const view = viewport.current;
    const range = control.current;
    const content = strip.current;
    if (!view || !range || !content) return undefined;
    let dragging = false,
      visible = false,
      maximum = 0;
    view.dataset.scrollbarVisible = 'false';
    range.dataset.scrollbarVisible = 'false';
    const show = (next: boolean) => {
      next = next && maximum > 0;
      if (next === visible) return;
      visible = next;
      view.dataset.scrollbarVisible = String(next);
      range.dataset.scrollbarVisible = String(next);
    };
    const value = () => {
      range.value = String(view.scrollTop);
      range.setAttribute('aria-valuenow', range.value);
    };
    const metrics = () => {
      maximum = Math.max(0, view.scrollHeight - view.clientHeight);
      range.max = String(maximum);
      range.disabled = maximum === 0;
      range.style.display = maximum ? 'block' : 'none';
      range.style.height = `${view.clientHeight}px`;
      const thumb = Math.min(
        view.clientHeight,
        Math.max(
          settings.width * 2,
          (view.clientHeight * view.clientHeight) / Math.max(1, view.scrollHeight),
        ),
      );
      range.style.setProperty('--reader-scroll-thumb', `${thumb}px`);
      range.setAttribute('aria-valuemax', String(maximum));
      value();
      if (!maximum) show(false);
    };
    const hover = () => range.matches(':hover') || range.matches(':focus-visible');
    const enter = () => show(true);
    const leave = () => {
      if (!dragging) show(range.matches(':focus-visible'));
    };
    const down = (event: Event) => {
      if (event instanceof PointerEvent && event.button === 0) {
        dragging = true;
        show(true);
      }
    };
    const up = () => {
      dragging = false;
      show(hover());
    };
    const cancel = () => {
      dragging = false;
      show(false);
    };
    const input = () => {
      view.scrollTop = Number(range.value);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) {
        // Keep the existing reader zoom owner, including its pointer anchor.
        view.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaMode: event.deltaMode,
            ctrlKey: true,
            clientX: event.clientX,
            clientY: event.clientY,
            cancelable: true,
          }),
        );
      } else {
        const unit =
          event.deltaMode === 2
            ? view.clientHeight
            : event.deltaMode === 1
              ? parseFloat(getComputedStyle(view).lineHeight) || settings.width
              : 1;
        view.scrollBy(
          event.shiftKey && !event.deltaX
            ? { left: event.deltaY * unit }
            : { left: event.deltaX * unit, top: event.deltaY * unit },
        );
      }
    };
    const listeners: [EventTarget, string, EventListener][] = [
      [view, 'scroll', value],
      [range, 'pointerenter', enter],
      [range, 'pointerleave', leave],
      [range, 'pointerdown', down],
      [range, 'input', input],
      [range, 'focus', enter],
      [range, 'blur', up],
      [window, 'pointerup', up],
      [window, 'pointercancel', cancel],
      [window, 'blur', cancel],
    ];
    for (const [target, type, callback] of listeners)
      target.addEventListener(type, callback, { passive: true });
    range.addEventListener('wheel', wheel, { passive: false });
    const resize = new ResizeObserver(metrics);
    resize.observe(view);
    const mutation = new MutationObserver(metrics);
    mutation.observe(content, { childList: true, attributes: true });
    metrics();
    return () => {
      for (const [target, type, callback] of listeners) target.removeEventListener(type, callback);
      range.removeEventListener('wheel', wheel);
      resize.disconnect();
      mutation.disconnect();
      delete view.dataset.scrollbarVisible;
    };
  }, [viewport, strip, settings]);

  const colors = settings.colors;
  return {
    viewportSx: {
      '&::-webkit-scrollbar': { width: '0px' },
      '&::-webkit-scrollbar:horizontal': {
        height: `${settings.width}px`,
        backgroundColor: colors.track,
      },
      '&::-webkit-scrollbar-thumb:horizontal': {
        backgroundColor: colors.thumb,
        borderRadius: `${settings.radius}px`,
        border: `${settings.inset}px solid ${colors.hidden}`,
        backgroundClip: 'padding-box',
      },
    },
    // One native range control floats above the body. Its size/value follow the
    // actual scroll container; no custom pointer-drag engine or React frame loop.
    overlay: (
      <Box
        component="input"
        ref={control}
        type="range"
        min={0}
        max={1}
        step={1}
        defaultValue={0}
        role="scrollbar"
        aria-label={label}
        aria-orientation="vertical"
        aria-controls="reader-viewport"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={0}
        data-reader-scrollbar
        data-drag-region="no-drag"
        sx={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: `${settings.width}px`,
          height: '100%',
          margin: 0,
          padding: 0,
          border: 0,
          opacity: 0,
          appearance: 'none',
          writingMode: 'vertical-lr',
          direction: 'ltr',
          backgroundColor: colors.track,
          outlineColor: colors.active,
          '&[data-scrollbar-visible="true"], &:focus-visible': { opacity: 1 },
          '&::-webkit-slider-runnable-track': {
            width: '100%',
            height: '100%',
            backgroundColor: colors.hidden,
          },
          '&::-webkit-slider-thumb': {
            WebkitAppearance: 'none',
            border: 0,
            width: `${settings.width - settings.inset * 2}px`,
            height: 'var(--reader-scroll-thumb)',
            borderRadius: `${settings.radius}px`,
            backgroundColor: colors.thumb,
          },
          '&:hover::-webkit-slider-thumb': { backgroundColor: colors.hover },
          '&:active::-webkit-slider-thumb, &:focus-visible::-webkit-slider-thumb': {
            backgroundColor: colors.active,
          },
        }}
      />
    ),
  };
}
// END SCROLLBAR

// STATE AND COORDINATION
// READER SESSION — page resources and chapter state are owned here, not recreated on scroll.
export default function BodyReader({ config, input }: ChildProps<ReaderConfig, BodyReaderInput>) {
  const viewport = useRef<HTMLDivElement>(null),
    strip = useRef<HTMLDivElement>(null);
  const scrollbar = useReaderScrollbar(viewport, strip, config.scrollbar, config.label);
  const metrics = useReaderMetrics(
    config.diagnostics === true,
    viewport,
    input.submitReaderMetrics,
  );
  const current = useRef<ReaderChapter | null>(null),
    candidate = useRef<ReaderChapter | null>(null),
    reading = useRef<ReaderSession | null>(null),
    candidateCatalog = useRef<string | null>(null),
    alive = useRef(true),
    opening = useRef(false);
  const navigating = useRef(false),
    navigationSignature = useRef(''),
    externalTarget = useRef(0),
    externalHandled = useRef(0),
    externalPumping = useRef(false),
    externalSurfaceReady = useRef(false);
  externalTarget.current = Math.max(externalTarget.current, input.externalOpenRevision);
  const [display, setDisplay] = useState<ReaderDisplay>({
    name: '',
    count: 0,
    total: 0,
    phase: '',
    error: '',
  });
  const [zoom, setZoom] = useState(1);
  const zoomValue = useRef(1),
    cancelZoom = useRef<(() => void) | null>(null);
  const surface = useRef<ReturnType<typeof attachReaderPixi> | null>(null);
  const configuredSpeed = input.preferences?.values.scrollSpeed,
    configuredSmoothDuration = input.preferences?.values.smoothScrollDurationMs;
  const scrollSpeedSetting = useRef<number | null>(null),
    smoothDuration = useRef<number | null>(null);
  if (scrollSpeedSetting.current === null && finite(configuredSpeed, 1, 100))
    scrollSpeedSetting.current = configuredSpeed;
  if (
    smoothDuration.current === null &&
    Number.isInteger(configuredSmoothDuration) &&
    finite(configuredSmoothDuration, 100, 2000)
  )
    smoothDuration.current = configuredSmoothDuration;
  const host = useMemo(
    () => ({
      open: input.openArchive,
      external: input.openExternalArchive,
      drop: input.openDroppedArchive,
      chapter: input.openChapter,
      prepare: (id: string, index: number, decodeWidth: number, priority: ReaderWorkPriority) =>
        input.preparePage([id, index, decodeWidth, priority]),
      release: input.releaseChapter,
    }),
    [
      input.openArchive,
      input.openExternalArchive,
      input.openDroppedArchive,
      input.openChapter,
      input.preparePage,
      input.releaseChapter,
    ],
  );
  const syncNavigation = () => {
    const session = reading.current;
    const state: ReaderNavigationState = {
      catalogId: session?.alive ? session.catalog.id : '',
      currentId: session?.alive ? (current.current?.entryId ?? '') : '',
      chapters: session?.alive ? session.catalog.chapters : [],
      busy: opening.current || navigating.current,
    };
    const signature = `${state.catalogId}|${state.currentId}|${state.busy}`;
    if (signature !== navigationSignature.current) {
      navigationSignature.current = signature;
      input.publishNavigation(state);
    }
  };
  const release = (chapter: ReaderChapter | null | undefined) => {
    if (!chapter || !chapter.alive) return Promise.resolve();
    chapter.alive = false;
    for (const image of chapter.images.values()) image.removeAttribute('src');
    for (const image of chapter.pendingImages) image.removeAttribute('src');
    chapter.images.clear();
    chapter.pendingImages.clear();
    chapter.acceptedWidths.clear();
    chapter.preparedPages.clear();
    return (surface.current?.releaseChapter(chapter.id) ?? Promise.resolve())
      .catch(() => {})
      .then(() =>
        host
          .release(chapter.id)
          .then(() => {})
          .catch(() => {}),
      );
  };
  const releaseReading = (session: ReaderSession | null, keepCatalog = false) => {
    if (!session || !session.alive) return Promise.resolve();
    session.alive = false;
    session.epoch++;
    session.observer.disconnect();
    const retiring: Promise<void>[] = [];
    for (const job of session.jobs.values()) if (!job.mounted) retiring.push(release(job.chapter));
    session.jobs.clear();
    for (const record of session.records.values()) retiring.push(release(record.chapter));
    session.records.clear();
    return Promise.all(retiring)
      .then(() => (keepCatalog ? undefined : host.release(session.catalog.id)))
      .then(() => {})
      .catch(() => {});
  };
  const prepare = async (
    chapter: ReaderChapter,
    page: PageMetadata,
    decodeWidth: number,
    priority: ReaderWorkPriority = 'visible',
    requestedWarm?: { top: number; height: number },
  ): Promise<HTMLImageElement | null> => {
    const monitor = metrics.current,
      nativeStart = monitor ? performance.now() : 0;
    const response = await host.prepare(chapter.id, page.index, decodeWidth, priority);
    const nativeMs = monitor ? performance.now() - nativeStart : 0;
    if (!chapter.alive || !alive.current) return null;
    if (!response.ok)
      throw response.code === 'deferred'
        ? new ReaderDeferredError(response.error)
        : response.code === 'cancelled'
          ? new ReaderCancelledError(response.error)
          : new Error(`${page.name}: ${response.error}`);
    if (!acceptsPreparedPage(chapter, page, decodeWidth, response))
      throw new Error(`${page.name}: Stale or mismatched prepared page`);
    const accepted = chapter.images.get(page.index);
    if (accepted && retainsAcceptedWidth(chapter.acceptedWidths.get(page.index), response.width)) {
      monitor?.record('image', {
        chapterId: chapter.id,
        pageIndex: page.index,
        nativeMs,
        imageDecodeMs: 0,
        retained: true,
      });
      return accepted;
    }
    const image = new Image();
    image.alt = page.name;
    image.decoding = 'async';
    image.draggable = false;
    Object.assign(image.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
    });
    chapter.pendingImages.add(image);
    const gpu = config.renderer !== 'dom';
    if (gpu) image.style.visibility = 'hidden';
    else image.src = response.url;
    const imageStart = monitor ? performance.now() : 0;
    try {
      if (gpu) {
        if (!surface.current) throw new Error('GPU renderer is not mounted');
        const scale = zoomValue.current / chapter.geometry.ratio;
        const offset =
          chapter.pages
            .slice(0, page.index)
            .reduce(
              (sum, p) =>
                sum +
                displayBox(p, chapter.geometry.maximumPixels, chapter.geometry.ratio).height +
                config.pageGap,
              0,
            ) * zoomValue.current;
        const warm =
          requestedWarm ??
          (priority !== 'background' &&
          (priority === 'demand' || offset < (viewport.current?.clientHeight ?? 0))
            ? {
                top: 0,
                height: Math.max(
                  1,
                  Math.min(
                    response.height,
                    ((viewport.current?.clientHeight ?? 1) -
                      Math.min(offset, viewport.current?.clientHeight ?? 0)) /
                      scale,
                  ),
                ),
              }
            : undefined);
        await surface.current.preparePage(response, priority, warm);
      } else await image.decode();
    } catch (error) {
      image.removeAttribute('src');
      if (!chapter.alive || !alive.current) return null;
      if (error instanceof ReaderSurfaceError && error.code === 'deferred')
        throw new ReaderDeferredError(error.message);
      if (error instanceof ReaderSurfaceError && error.code === 'cancelled')
        throw new ReaderCancelledError(error.message);
      if (gpu && error instanceof Error) throw error;
      throw new Error(`Cannot decode page: ${page.name}`);
    } finally {
      chapter.pendingImages.delete(image);
      if (monitor)
        monitor.record('image', {
          chapterId: chapter.id,
          pageIndex: page.index,
          nativeMs,
          ...(gpu
            ? { rendererPrepareMs: performance.now() - imageStart }
            : { imageDecodeMs: performance.now() - imageStart }),
          cancelled: !chapter.alive || !alive.current,
        });
    }
    if (!chapter.alive || !alive.current) {
      image.removeAttribute('src');
      return null;
    }
    if (
      !gpu &&
      (image.naturalWidth !== response.width || image.naturalHeight !== response.height)
    ) {
      image.removeAttribute('src');
      throw new Error(`${page.name}: Prepared dimensions do not match decoded pixels`);
    }
    const latest = chapter.images.get(page.index);
    if (latest && retainsAcceptedWidth(chapter.acceptedWidths.get(page.index), response.width)) {
      image.removeAttribute('src');
      return latest;
    }
    chapter.acceptedWidths.set(page.index, response.width);
    chapter.images.set(page.index, image);
    chapter.preparedPages.set(page.index, response);
    return image;
  };

  // CHAPTER GEOMETRY — every chapter reserves its own immutable boxes and origin.
  const buildChapter = (chapter: ReaderChapter): ChapterRecord => {
    const start = metrics.current ? performance.now() : 0;
    const { maximumPixels, ratio } = chapter.geometry;
    const boxes = chapter.pages.map((page) => displayBox(page, maximumPixels, ratio));
    const width = Math.max(...boxes.map((box) => box.width)),
      height = boxes.reduce((sum, box) => sum + box.height + config.pageGap, 0);
    chapter.root.dataset.readerChapter = chapter.entryId;
    chapter.root.dataset.readerIndex = String(chapter.index);
    chapter.root.dataset.readerSession = chapter.id;
    chapter.root.setAttribute('aria-label', chapter.name);
    Object.assign(chapter.root.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: `${width}px`,
      height: `${height}px`,
      flexShrink: 0,
      marginLeft: 'auto',
      marginRight: 'auto',
    });
    const fragment = document.createDocumentFragment();
    chapter.slots = chapter.pages.map((page, index) => {
      const box = boxes[index];
      if (!box) throw new Error('Page geometry is unavailable');
      const slot = document.createElement('div');
      slot.dataset.readerPage = String(page.index);
      slot.setAttribute('aria-label', page.name);
      Object.assign(slot.style, {
        display: 'block',
        width: `${box.width}px`,
        height: `${box.height}px`,
        marginBottom: `${config.pageGap}px`,
        position: 'relative',
        overflow: 'hidden',
        marginLeft: 'auto',
        marginRight: 'auto',
        flexShrink: 0,
      });
      const image = chapter.images.get(page.index);
      if (image) slot.append(image);
      fragment.append(slot);
      return slot;
    });
    chapter.root.replaceChildren(fragment);
    if (metrics.current)
      metrics.current.record('attach', {
        chapterId: chapter.id,
        durationMs: performance.now() - start,
        pages: chapter.images.size,
        stage: 'chapter-build',
      });
    return {
      index: chapter.index,
      entryId: chapter.entryId,
      sourceRevision: chapter.sourceRevision,
      pages: chapter.pages,
      geometry: chapter.geometry,
      width,
      height,
      chapter,
    };
  };

  // ANCHORS AND RESIDENCY — old pixels are removed, contiguous history becomes one
  // lightweight spacer per gap, and unchanged visible chapter/image nodes are retained.
  const renderReading = (session: ReaderSession, preserve = true) => {
    const content = strip.current,
      view = viewport.current;
    if (!content || !view || reading.current !== session || !session.alive) return;
    metrics.current?.expect('layout');
    const started = metrics.current ? performance.now() : 0;
    const bounds = view.getBoundingClientRect();
    const oldChildren = [...content.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        (element.dataset.readerChapter !== undefined || element.dataset.readerSpacer === 'history'),
    );
    const anchor = preserve
      ? (oldChildren.find((element) => {
          const index = Number(element.dataset.readerIndex);
          const box = element.getBoundingClientRect();
          return (
            element.dataset.readerChapter !== undefined &&
            session.records.get(index)?.chapter?.root === element &&
            box.bottom > bounds.top &&
            box.top < bounds.top + view.clientHeight
          );
        }) ??
        oldChildren.find((element) => {
          const box = element.getBoundingClientRect();
          return box.bottom > bounds.top && box.top < bounds.top + view.clientHeight;
        }) ??
        oldChildren[0])
      : undefined;
    const anchorIndex = anchor
      ? Number(anchor.dataset.readerIndex ?? anchor.dataset.readerStart)
      : -1;
    const before = anchor?.getBoundingClientRect();
    const fragment = document.createDocumentFragment();
    const spacer = (height: number, start: number, end: number, kind: string) => {
      if (!height) return;
      const element = document.createElement('div');
      element.dataset.readerSpacer = kind;
      element.dataset.readerStart = String(start);
      element.dataset.readerEnd = String(end);
      Object.assign(element.style, { height: `${height}px`, width: '100%', flexShrink: 0 });
      fragment.append(element);
    };
    if (session.first > 0)
      spacer(session.probeHeight, session.first - 1, session.first - 1, 'previous');
    let gapHeight = 0,
      gapStart = session.first;
    for (let index = session.first; index <= session.last; index++) {
      const record = session.records.get(index);
      if (!record) throw new Error('Chapter history geometry is unavailable');
      session.width = Math.max(session.width, record.width);
      if (!record.chapter) {
        if (!gapHeight) gapStart = index;
        gapHeight += record.height;
        continue;
      }
      spacer(gapHeight, gapStart, index - 1, 'history');
      gapHeight = 0;
      fragment.append(record.chapter.root);
    }
    spacer(gapHeight, gapStart, session.last, 'history');
    if (session.last < session.catalog.chapters.length - 1)
      spacer(session.probeHeight, session.last + 1, session.last + 1, 'next');
    content.style.width = `${session.width}px`;
    content.dataset.readerCatalog = session.catalog.id;
    session.observer.disconnect();
    content.replaceChildren(fragment);
    if (before && anchor) {
      const replacement = [...content.children].find(
        (element) =>
          element instanceof HTMLElement &&
          (Number(element.dataset.readerIndex) === anchorIndex ||
            (element.dataset.readerSpacer === 'history' &&
              Number(element.dataset.readerStart) <= anchorIndex &&
              Number(element.dataset.readerEnd) >= anchorIndex)),
      );
      if (replacement instanceof HTMLElement) {
        const after = replacement.getBoundingClientRect();
        let origin = after.top;
        if (replacement.dataset.readerSpacer === 'history')
          for (let index = Number(replacement.dataset.readerStart); index < anchorIndex; index++)
            origin += (session.records.get(index)?.height ?? 0) * zoomValue.current;
        if (anchor === replacement && anchor.dataset.readerChapter !== undefined)
          view.scrollLeft += after.left - before.left;
        view.scrollTop += origin - before.top;
      }
      session.restoredTop = view.scrollTop;
    }
    for (const element of content.children) session.observer.observe(element);
    surface.current?.syncLayout();
    if (metrics.current)
      metrics.current.record('attach', {
        durationMs: performance.now() - started,
        stage: 'chapter-publish',
      });
  };
  const publishCurrent = (chapter: ReaderChapter) => {
    if (current.current === chapter) return;
    cancelZoom.current?.();
    current.current = chapter;
    syncNavigation();
    setDisplay((value) => ({
      ...value,
      name: chapter.name,
      count: chapter.images.size,
      total: chapter.pages.length,
    }));
  };
  const clearNotice = (session: ReaderSession, index: number) => {
    if (session.notice?.index !== index) return;
    const message = session.notice.message;
    session.notice = null;
    setDisplay((value) => (value.error === message ? { ...value, error: '' } : value));
  };
  const resumeBlocked = (session: ReaderSession) => {
    if (!session.alive || reading.current !== session) return;
    for (const job of session.jobs.values()) job.blocked = false;
    void pumpReading(session);
  };
  const createJob = (
    session: ReaderSession,
    index: number,
    priority: ReaderWorkPriority,
    chapter?: ReaderChapter,
  ): ChapterJob => {
    const ratio = Math.max(0.1, window.devicePixelRatio || 1);
    const job: ChapterJob = {
      transferred: false,
      index,
      epoch: session.epoch,
      priority,
      serial: ++session.serial,
      geometry: chapter?.geometry ??
        session.records.get(index)?.geometry ?? {
          ratio,
          maximumPixels: Math.min(config.maxRenderWidth, maximumPixels(ratio)),
        },
      mounted: Boolean(chapter),
      blocked: false,
      remaining: new Set(),
      offsets: [],
      height: 0,
      operation: null,
      ...(chapter ? { chapter } : {}),
    };
    session.jobs.set(index, job);
    if (chapter) initializePages(job, chapter);
    return job;
  };
  const initializePages = (job: ChapterJob, chapter: ReaderChapter) => {
    let height = 0;
    job.offsets = chapter.pages.map((page) => {
      const offset = height;
      height +=
        displayBox(page, chapter.geometry.maximumPixels, chapter.geometry.ratio).height +
        config.pageGap;
      return offset;
    });
    job.height = height;
    job.remaining = new Set(
      chapter.pages.filter((page) => !chapter.images.has(page.index)).map((page) => page.index),
    );
  };
  const jobViewportOffset = (session: ReaderSession, job: ChapterJob): number => {
    const view = viewport.current,
      content = strip.current,
      chapter = job.chapter;
    if (!view || !content || !chapter) return 0;
    let origin = chapter.root.isConnected ? chapter.root.getBoundingClientRect().top : undefined;
    if (origin === undefined)
      for (const element of content.children) {
        if (!(element instanceof HTMLElement) || !element.dataset.readerSpacer) continue;
        const start = Number(element.dataset.readerStart),
          end = Number(element.dataset.readerEnd);
        if (job.index < start || job.index > end) continue;
        const box = element.getBoundingClientRect();
        origin =
          element.dataset.readerSpacer === 'previous'
            ? box.bottom - job.height * zoomValue.current
            : box.top;
        if (element.dataset.readerSpacer === 'history')
          for (let index = start; index < job.index; index++)
            origin += (session.records.get(index)?.height ?? 0) * zoomValue.current;
        break;
      }
    return (
      (view.getBoundingClientRect().top - (origin ?? content.getBoundingClientRect().bottom)) /
      zoomValue.current
    );
  };
  const requiredPages = (session: ReaderSession, job: ChapterJob): number[] => {
    const view = viewport.current,
      chapter = job.chapter;
    if (!view || !chapter) return [];
    const local = jobViewportOffset(session, job);
    const first = pageAtOffset(job.offsets, Math.max(0, local));
    const last = pageAtOffset(
      job.offsets,
      Math.max(0, local + view.clientHeight / zoomValue.current - 0.5),
    );
    const pages = Array.from({ length: last - first + 1 }, (_, index) => first + index);
    for (
      let index = last + 1;
      pages.length < config.initialPages && index < chapter.pages.length;
      index++
    )
      pages.push(index);
    for (let index = first - 1; pages.length < config.initialPages && index >= 0; index--)
      pages.push(index);
    return pages;
  };
  const upgradeJob = (session: ReaderSession, job: ChapterJob, priority: ReaderWorkPriority) => {
    if (priorityRank(priority) >= priorityRank(job.priority)) return;
    job.priority = priority;
    job.blocked = false;
    const entry = session.catalog.chapters[job.index];
    if (job.operation === 'open' && entry)
      void host
        .chapter([
          session.catalog.id,
          entry.id,
          {
            renderWidth: job.geometry.maximumPixels,
            maxDecodeWidth: config.maxRenderWidth,
            maxDecodedMB: config.maxDecodedMB,
            tileCache: config.renderer !== 'dom',
          },
          priority,
        ])
        .catch(() => {});
    else if (typeof job.operation === 'number' && job.chapter)
      void host
        .prepare(job.chapter.id, job.operation, job.chapter.decodeWidth, priority)
        .catch(() => {});
  };
  const reconcile = (session: ReaderSession): void => {
    const view = viewport.current,
      content = strip.current;
    if (
      !view ||
      !content ||
      !alive.current ||
      !session.alive ||
      session.paused ||
      reading.current !== session
    )
      return;
    const bounds = view.getBoundingClientRect(),
      bottom = bounds.top + view.clientHeight;
    const residents = [...session.records.values()]
      .filter((record) => record.chapter?.alive)
      .sort((a, b) => a.index - b.index);
    const visible = residents.filter((record) => {
      const box = record.chapter?.root.getBoundingClientRect();
      return box && box.bottom > bounds.top + 0.5 && box.top < bottom - 0.5;
    });
    const primary =
      visible.find((record) => record.index === session.focusIndex)?.chapter ??
      visible[0]?.chapter ??
      (current.current?.alive ? current.current : residents[0]?.chapter);
    if (primary) {
      publishCurrent(primary);
      content.dataset.currentChapter = primary.entryId;
      content.dataset.nextChapter = session.catalog.chapters[primary.index + 1]?.id ?? '';
    }
    const keep = new Set([
      ...visible.map((record) => record.index),
      ...(primary ? [primary.index, primary.index + 1] : []),
    ]);
    const evicted: ReaderChapter[] = [];
    for (const record of residents) {
      if (keep.has(record.index)) continue;
      if (record.chapter) evicted.push(record.chapter);
      session.jobs.delete(record.index);
      delete record.chapter;
    }
    if (evicted.length) {
      renderReading(session); // Detach first, restore layout/anchor, then release pixels/workers.
      void Promise.all(evicted.map(release)).then(() => resumeBlocked(session));
    }
    // Only intersections with a spacer request old/extra-short chapters. There is
    // no speculative previous slot, page-scroll frame loop or per-page visibility scan.
    let demand: number | undefined;
    for (const element of content.children) {
      if (!(element instanceof HTMLElement) || !element.dataset.readerSpacer) continue;
      const box = element.getBoundingClientRect();
      if (Math.min(box.bottom, bottom) - Math.max(box.top, bounds.top) <= 0.5) continue;
      const start = Number(element.dataset.readerStart),
        end = Number(element.dataset.readerEnd);
      demand = start;
      if (element.dataset.readerSpacer === 'history') {
        let offset = Math.max(0, bounds.top - box.top) / zoomValue.current;
        for (let index = start; index <= end; index++) {
          const height = session.records.get(index)?.height ?? 0;
          if (offset < height) {
            demand = index;
            break;
          }
          offset -= height;
        }
      }
      break;
    }
    const index = demand ?? (primary?.complete ? primary.index + 1 : undefined);
    for (const [key, job] of session.jobs) {
      if (job.mounted || key === index || (primary && key === primary.index + 1)) continue;
      session.jobs.delete(key);
      clearNotice(session, key);
      if (job.chapter) void release(job.chapter).then(() => resumeBlocked(session));
    }
    if (
      index !== undefined &&
      session.catalog.chapters[index] &&
      !session.records.get(index)?.chapter &&
      !session.errors.has(index)
    ) {
      const job =
        session.jobs.get(index) ??
        createJob(session, index, demand === undefined ? 'background' : 'demand');
      if (demand !== undefined) upgradeJob(session, job, 'demand');
    }
    void pumpReading(session);
  };
  const publishJob = (session: ReaderSession, job: ChapterJob) => {
    const chapter = job.chapter;
    if (!chapter || job.mounted) return;
    session.records.set(job.index, buildChapter(chapter));
    session.first = Math.min(session.first, job.index);
    session.last = Math.max(session.last, job.index);
    job.mounted = true;
    if (!chapter.complete) job.priority = 'visible';
    renderReading(session);
  };
  const reclaimUnused = async (session: ReaderSession, target: ChapterJob): Promise<boolean> => {
    const view = viewport.current;
    if (!view) return false;
    const bounds = view.getBoundingClientRect(),
      bottom = bounds.top + view.clientHeight;
    const retired: ReaderChapter[] = [];
    // Discard unused speculative pixels before sacrificing any offscreen history.
    for (const job of session.jobs.values())
      if (job !== target && !job.mounted && job.priority === 'background' && job.chapter) {
        retired.push(job.chapter);
        delete job.chapter;
        job.remaining.clear();
        job.blocked = true;
      }
    for (const record of session.records.values()) {
      const chapter = record.chapter;
      if (!chapter || chapter === target.chapter) continue;
      const box = chapter.root.getBoundingClientRect();
      if (box.bottom > bounds.top + 0.5 && box.top < bottom - 0.5) continue;
      retired.push(chapter);
      delete record.chapter;
      session.jobs.delete(record.index);
      if (current.current === chapter) current.current = null;
    }
    if (!retired.length) return false;
    renderReading(session);
    await Promise.all(retired.map(release));
    return true;
  };
  const nextJob = (session: ReaderSession) => {
    const foregroundBlocked = [...session.jobs.values()].some(
      (job) => job.blocked && job.priority !== 'background',
    );
    return [...session.jobs.values()]
      .filter((job) => !job.blocked && (!foregroundBlocked || job.priority !== 'background'))
      .sort(
        (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.serial - b.serial,
      )[0];
  };

  // LOGIC AND CALCULATIONS — PREPARATION
  // One reader pump owns all current/demand/next pages and browser
  // image acceptance. Native workers share a second, global single-operation queue.
  const pumpReading = async (session: ReaderSession): Promise<void> => {
    if (session.pumping || !session.alive || session.paused || reading.current !== session) return;
    session.pumping = true;
    try {
      while (alive.current && session.alive && !session.paused && reading.current === session) {
        const job = nextJob(session);
        if (!job) break;
        const entry = session.catalog.chapters[job.index];
        if (!entry) {
          session.jobs.delete(job.index);
          continue;
        }
        const valid = () =>
          alive.current &&
          session.alive &&
          reading.current === session &&
          session.jobs.get(job.index) === job &&
          !job.transferred &&
          (job.mounted || (!session.paused && session.epoch === job.epoch));
        try {
          if (!job.chapter) {
            job.operation = 'open';
            job.headerTask = host.chapter([
              session.catalog.id,
              entry.id,
              {
                renderWidth: job.geometry.maximumPixels,
                maxDecodeWidth: config.maxRenderWidth,
                maxDecodedMB: config.maxDecodedMB,
                tileCache: config.renderer !== 'dom',
              },
              job.priority,
            ]);
            const response = await job.headerTask;
            if (!response.ok)
              throw response.code === 'deferred'
                ? new ReaderDeferredError(response.error)
                : response.code === 'cancelled'
                  ? new ReaderCancelledError(response.error)
                  : new Error(response.error);
            const chapter: ReaderChapter = {
              ...response.chapter,
              alive: true,
              images: new Map(),
              preparedPages: new Map(),
              pendingImages: new Set(),
              acceptedWidths: new Map(),
              slots: [],
              decodeWidth: job.geometry.maximumPixels,
              geometry: job.geometry,
              index: job.index,
              root: document.createElement('div'),
              complete: false,
            };
            job.chapter = chapter;
            if (!valid()) continue;
            const previous = session.records.get(job.index);
            if (
              !acceptsCatalogChapter(session.catalog, entry.id, chapter) ||
              !storedChapterMatches(previous, chapter)
            )
              throw new Error(
                'Stored chapter geometry/source identity changed; reopen the archive',
              );
            initializePages(job, chapter);
          }
          const chapter = job.chapter;
          if (!valid() || !chapter) continue;
          const needed: number[] = job.priority === 'background' ? [] : requiredPages(session, job);
          if (
            !job.mounted &&
            job.priority !== 'background' &&
            needed.every((index) => chapter.images.has(index))
          )
            publishJob(session, job);
          const index =
            needed.find((index) => job.remaining.has(index)) ?? job.remaining.values().next().value;
          if (index === undefined) {
            chapter.complete = true;
            publishJob(session, job);
            session.jobs.delete(job.index);
            clearNotice(session, job.index);
            reconcile(session);
            continue;
          }
          const page = chapter.pages[index];
          if (!page) throw new Error('Page metadata unavailable');
          job.operation = index;
          const top = Math.max(
            0,
            (jobViewportOffset(session, job) - (job.offsets[index] ?? 0)) * chapter.geometry.ratio,
          );
          const warm = needed.includes(index)
            ? {
                top,
                height: Math.max(
                  1,
                  ((viewport.current?.clientHeight ?? 1) * chapter.geometry.ratio) /
                    zoomValue.current,
                ),
              }
            : undefined;
          const image = await prepare(chapter, page, chapter.decodeWidth, job.priority, warm);
          if (!image || !valid()) continue;
          job.remaining.delete(index);
          if (job.mounted) {
            const start = metrics.current ? performance.now() : 0;
            chapter.slots[index]?.replaceChildren(image);
            if (metrics.current)
              metrics.current.record('attach', {
                chapterId: chapter.id,
                pageIndex: index,
                durationMs: performance.now() - start,
                stage: 'page-attach',
              });
          }
          if (current.current === chapter)
            setDisplay((value) => ({ ...value, count: chapter.images.size }));
          clearNotice(session, job.index);
          if (
            !job.mounted &&
            job.priority !== 'background' &&
            requiredPages(session, job).every((index) => chapter.images.has(index))
          )
            publishJob(session, job);
          // Re-evaluate priority after one accepted page, never in an animation loop.
          await new Promise((resolve) => setTimeout(resolve, 0));
          reconcile(session);
        } catch (error) {
          if (!valid()) continue;
          if (session.paused) {
            job.blocked = true;
            continue;
          }
          if (error instanceof ReaderCancelledError) continue;
          if (error instanceof ReaderDeferredError) {
            if (job.priority !== 'background' && (await reclaimUnused(session, job))) {
              if (valid()) {
                job.blocked = false;
                continue;
              }
            }
            job.blocked = true;
            const message = `${entry.name}: ${error.message}`;
            session.notice = { index: job.index, message };
            setDisplay((value) => ({ ...value, error: message }));
          } else {
            session.jobs.delete(job.index);
            session.errors.set(job.index, `${entry.name}: ${errorText(error)}`);
            setDisplay((value) => ({ ...value, error: session.errors.get(job.index) ?? '' }));
            if (!job.mounted) await release(job.chapter);
          }
        } finally {
          job.operation = null;
          if (!valid() && !job.mounted && !job.transferred) void release(job.chapter);
        }
      }
    } finally {
      session.pumping = false;
      if (
        alive.current &&
        session.alive &&
        !session.paused &&
        reading.current === session &&
        nextJob(session)
      )
        void pumpReading(session);
    }
  };
  const maximumPixels = (ratio: number) => {
    if (!viewport.current) throw new Error('Reader is not mounted');
    const available = viewport.current.clientWidth - config.pageInset;
    return Math.max(1, Math.floor(available * ratio));
  };
  const openChapter = async (
    source: ReaderOpenIntent,
    droppedFile?: File,
  ): Promise<ScreenOpenResult> => {
    if (opening.current || navigating.current)
      return { ok: false, error: 'Another reader navigation is active' };
    opening.current = true;
    syncNavigation();
    surface.current?.stop();
    metrics.current?.expect('open');
    const previousReading = reading.current;
    if (previousReading) {
      previousReading.paused = true;
      previousReading.epoch++;
      for (const [index, job] of previousReading.jobs)
        if (!job.mounted) {
          previousReading.jobs.delete(index);
          clearNotice(previousReading, index);
          void release(job.chapter);
        }
    }
    setDisplay((value) => ({ ...value, phase: 'scanning', error: '' }));
    let staging: ReaderChapter | undefined;
    try {
      // Snapshot before async dialog/decode work. A resize while loading must not
      // enlarge boxes beyond the pixels prepared for this accepted chapter.
      const ratio = Math.max(0.1, window.devicePixelRatio || 1);
      const decodeWidth = Math.min(config.maxRenderWidth, maximumPixels(ratio));
      const geometry = { ratio, maximumPixels: decodeWidth };
      const options: ReaderOpenOptions = {
        renderWidth: decodeWidth,
        maxDecodeWidth: config.maxRenderWidth,
        maxDecodedMB: config.maxDecodedMB,
        tileCache: config.renderer !== 'dom',
        ...(source.picker ? { picker: source.picker } : {}),
      };
      const response = droppedFile
        ? await host.drop([droppedFile, options])
        : source.external
          ? await host.external(options)
          : await host.open(options);
      if (!alive.current) {
        if (response.ok && 'chapter' in response)
          void host.release(response.catalog.id).catch(() => {});
        return;
      }
      if (!response.ok) throw new Error(response.error);
      if ('canceled' in response) {
        setDisplay((value) => ({ ...value, phase: '' }));
        return { ok: true, canceled: true };
      }
      candidateCatalog.current = response.catalog.id;
      const index = response.catalog.chapters.findIndex(
        (entry) => entry.id === response.chapter.entryId,
      );
      if (
        index < 0 ||
        !acceptsCatalogChapter(response.catalog, response.chapter.entryId, response.chapter)
      )
        throw new Error('Mismatched opening chapter/catalog identity');
      staging = {
        ...response.chapter,
        alive: true,
        images: new Map(),
        preparedPages: new Map(),
        pendingImages: new Set(),
        acceptedWidths: new Map(),
        slots: [],
        decodeWidth,
        geometry,
        index,
        root: document.createElement('div'),
        complete: false,
      };
      candidate.current = staging;
      setDisplay((value) => ({ ...value, phase: 'preparing' }));
      const first = Math.min(config.initialPages, staging.pages.length);
      for (let index = 0; index < first; index++) {
        const page = staging.pages[index];
        if (!page) throw new Error('Page metadata is unavailable');
        if (!(await prepare(staging, page, decodeWidth))) return;
      }
      const view = viewport.current;
      if (!view) throw new Error('Reader is not mounted');
      const record = buildChapter(staging);
      const session: ReaderSession = {
        sceneId: crypto.randomUUID(),
        catalog: response.catalog,
        alive: true,
        paused: false,
        epoch: 0,
        records: new Map([[index, record]]),
        errors: new Map(),
        first: index,
        last: index,
        width: record.width,
        probeHeight: view.clientHeight,
        jobs: new Map(),
        pumping: false,
        serial: 0,
        notice: null,
        restoredTop: null,
        lastTop: 0,
        observer: new IntersectionObserver(() => reconcile(session), { root: view }),
      };
      cancelZoom.current?.();
      reading.current = session;
      current.current = staging;
      renderReading(session, false);
      view.scrollTop = (index > 0 ? session.probeHeight : 0) * zoomValue.current;
      view.scrollLeft = 0;
      surface.current?.stop();
      surface.current?.syncLayout();
      session.lastTop = view.scrollTop;
      session.restoredTop = view.scrollTop;
      candidate.current = null;
      candidateCatalog.current = null;
      releaseReading(previousReading);
      setDisplay({
        name: staging.name,
        count: first,
        total: staging.pages.length,
        phase: '',
        error: '',
      });
      if (first === staging.pages.length) staging.complete = true;
      else createJob(session, index, 'visible', staging);
      reconcile(session);
      return { ok: true, chapter: { id: staging.id, pages: staging.pages.length } };
    } catch (error) {
      release(staging);
      if (candidateCatalog.current) void host.release(candidateCatalog.current).catch(() => {});
      candidateCatalog.current = null;
      candidate.current = null;
      if (alive.current) setDisplay((value) => ({ ...value, phase: '', error: errorText(error) }));
      return { ok: false, error: errorText(error) };
    } finally {
      opening.current = false;
      if (previousReading?.alive && reading.current === previousReading) {
        previousReading.paused = false;
        for (const job of previousReading.jobs.values()) job.blocked = false;
        reconcile(previousReading);
      }
      syncNavigation();
      queueMicrotask(pumpExternalOpens);
    }
  };

  // CHAPTER NAVIGATION — reuse resident pixels, otherwise stage an authorized entry.
  const navigateChapter = async (request: ReaderNavigationRequest): Promise<Result> => {
    const previous = reading.current,
      view = viewport.current;
    if (!previous?.alive || !view || !alive.current || request.catalogId !== previous.catalog.id)
      return { ok: false, error: 'The chapter list belongs to a different reading context' };
    if (opening.current || navigating.current)
      return { ok: false, error: 'Reader navigation is busy' };
    const index = chapterNavigationIndex(
      previous.catalog.chapters,
      current.current?.entryId ?? '',
      request,
    );
    if (index < 0) return { ok: false, error: 'No chapter in that direction' };
    const entry = previous.catalog.chapters[index];
    if (!entry) return { ok: false, error: 'Chapter is unavailable' };
    navigating.current = true;
    syncNavigation();
    surface.current?.stop();
    cancelZoom.current?.();
    metrics.current?.expect('chapter-jump');
    previous.paused = true;
    previous.epoch++;
    setDisplay((value) => ({ ...value, phase: 'preparing', error: '' }));
    let staging = previous.records.get(index)?.chapter,
      owned = false;
    const valid = () => alive.current && previous.alive && reading.current === previous;
    try {
      let adopted: ChapterJob | undefined;
      const retiring: Promise<void>[] = [];
      for (const [key, job] of previous.jobs) {
        if (job.mounted) continue;
        job.transferred = true;
        previous.jobs.delete(key);
        if (!staging && key === index) adopted = job;
        else
          retiring.push(
            (async () => {
              if (job.headerTask) await job.headerTask.catch(() => {});
              await release(job.chapter);
            })(),
          );
      }
      await Promise.all(retiring);
      if (!valid()) throw new ReaderCancelledError('Reader context changed');
      if (adopted) {
        if (adopted.headerTask) {
          const response = await adopted.headerTask;
          if (!response.ok) throw new Error(response.error);
        }
        staging = adopted.chapter;
        owned = !!staging;
      }
      const remembered = previous.records.get(index);
      const ratio = Math.max(0.1, window.devicePixelRatio || 1);
      const geometry = staging?.geometry ??
        remembered?.geometry ?? {
          ratio,
          maximumPixels: Math.min(config.maxRenderWidth, maximumPixels(ratio)),
        };
      if (!staging) {
        const response = await host.chapter([
          previous.catalog.id,
          entry.id,
          {
            renderWidth: geometry.maximumPixels,
            maxDecodeWidth: config.maxRenderWidth,
            maxDecodedMB: config.maxDecodedMB,
            tileCache: config.renderer !== 'dom',
          },
          'demand',
        ]);
        if (!response.ok) throw new Error(response.error);
        staging = {
          ...response.chapter,
          alive: true,
          images: new Map(),
          preparedPages: new Map(),
          pendingImages: new Set(),
          acceptedWidths: new Map(),
          slots: [],
          decodeWidth: geometry.maximumPixels,
          geometry,
          index,
          root: document.createElement('div'),
          complete: false,
        };
        owned = true;
      }
      if (owned) candidate.current = staging;
      if (
        !valid() ||
        !acceptsCatalogChapter(previous.catalog, entry.id, staging) ||
        !storedChapterMatches(remembered, staging)
      )
        throw new Error('Stored chapter identity/geometry changed; reopen the archive');
      const first = Math.min(config.initialPages, staging.pages.length);
      const existingFirst = staging.preparedPages.get(0);
      if (config.renderer !== 'dom' && existingFirst && surface.current)
        await surface.current.preparePage(existingFirst, 'demand', {
          top: 0,
          height: Math.min(
            existingFirst.height,
            (view.clientHeight * staging.geometry.ratio) / zoomValue.current,
          ),
        });
      for (let pageIndex = 0; pageIndex < first; pageIndex++) {
        if (!valid()) throw new ReaderCancelledError('Reader context changed');
        if (staging.images.has(pageIndex)) continue;
        const page = staging.pages[pageIndex];
        if (!page) throw new Error('Chapter page is unavailable');
        const image = await prepare(staging, page, staging.decodeWidth, 'demand');
        if (!image) throw new ReaderCancelledError('Chapter was released');
        if (staging.root.isConnected) staging.slots[pageIndex]?.replaceChildren(image);
      }
      if (!valid() || !staging.alive) throw new ReaderCancelledError('Reader context changed');
      staging.complete = staging.images.size === staging.pages.length;
      let session = previous;
      if (!staging.root.isConnected) {
        const record = buildChapter(staging);
        const records = new Map<number, ChapterRecord>();
        for (const [key, record] of previous.records)
          records.set(key, {
            index: record.index,
            entryId: record.entryId,
            sourceRevision: record.sourceRevision,
            pages: record.pages,
            geometry: record.geometry,
            width: record.width,
            height: record.height,
          });
        records.set(index, record);
        const next: ReaderSession = {
          sceneId: crypto.randomUUID(),
          catalog: previous.catalog,
          alive: true,
          paused: true,
          epoch: 0,
          records,
          errors: new Map(),
          first: index,
          last: index,
          width: Math.max(previous.width, record.width),
          probeHeight: view.clientHeight,
          jobs: new Map(),
          pumping: false,
          serial: 0,
          notice: null,
          restoredTop: null,
          lastTop: 0,
          observer: new IntersectionObserver(() => reconcile(next), { root: view }),
          focusIndex: index,
        };
        session = next;
        reading.current = next;
        current.current = staging;
        renderReading(next, false);
        view.scrollTop = (index > 0 ? next.probeHeight : 0) * zoomValue.current;
        candidate.current = null;
        await releaseReading(previous, true);
        if (!alive.current || reading.current !== session)
          throw new ReaderCancelledError('Reader context changed');
      } else {
        session.focusIndex = index;
        view.scrollTop +=
          staging.root.getBoundingClientRect().top -
          view.getBoundingClientRect().top -
          view.clientTop;
        current.current = staging;
      }
      session.focusIndex = index;
      session.paused = false;
      session.restoredTop = view.scrollTop;
      session.lastTop = view.scrollTop;
      surface.current?.stop();
      surface.current?.syncLayout();
      setDisplay({
        name: staging.name,
        count: staging.images.size,
        total: staging.pages.length,
        phase: '',
        error: '',
      });
      if (!staging.complete && !session.jobs.has(index))
        createJob(session, index, 'visible', staging);
      reconcile(session);
      return { ok: true };
    } catch (error) {
      if (owned) await release(staging);
      if (alive.current) setDisplay((value) => ({ ...value, phase: '', error: errorText(error) }));
      return { ok: false, error: errorText(error) };
    } finally {
      candidate.current = null;
      navigating.current = false;
      if (previous.alive && reading.current === previous) {
        previous.paused = false;
        for (const job of previous.jobs.values()) job.blocked = false;
        reconcile(previous);
      }
      if (alive.current) syncNavigation();
      queueMicrotask(pumpExternalOpens);
    }
  };

  // EXTERNAL OPEN — serialize Explorer requests through the same staged Reader operation.
  function pumpExternalOpens() {
    if (
      !alive.current ||
      surface.current === null ||
      !externalSurfaceReady.current ||
      externalPumping.current ||
      opening.current ||
      navigating.current ||
      externalHandled.current >= externalTarget.current
    )
      return;
    externalPumping.current = true;
    const revision = externalHandled.current + 1;
    void openChapter({
      componentId,
      instanceId: config.id,
      filePath: config.filePath,
      configPath: config.configPath,
      external: true,
    }).finally(() => {
      externalHandled.current = revision;
      externalPumping.current = false;
      if (externalHandled.current < externalTarget.current) queueMicrotask(pumpExternalOpens);
    });
  }

  // UI AND LOCAL EVENTS — ZOOM
  // Only explicit input schedules a frame; ordinary scrolling stays native.
  useEffect(() => {
    const view = viewport.current,
      content = strip.current;
    if (!view || !content) return undefined;
    let frame: number | null = null;
    let pending: { session: ReaderSession; value: number; x: number; y: number } | null = null;
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    };
    cancelZoom.current = cancel;
    const apply = (value: number, x: number, y: number) => {
      const next = normalizeZoom(value, config.minZoom, config.maxZoom, config.zoomStep);
      const old = zoomValue.current;
      if (next === old || !alive.current || !reading.current?.alive) return;
      surface.current?.stop();
      metrics.current?.expect('zoom');
      // Measure immediately before mutation, not when input was queued. The strip's
      // real origin includes auto-margin centering, both scroll axes and vertical origin.
      const before = content.getBoundingClientRect();
      const pointX = (x - before.left) / old,
        pointY = (y - before.top) / old;
      content.style.zoom = String(next);
      const after = content.getBoundingClientRect();
      // Native scroll bounds clamp naturally when the scaled chapter cannot reach
      // the requested anchor (for example, a column narrower than the viewport).
      view.scrollLeft += after.left + pointX * next - x;
      view.scrollTop += after.top + pointY * next - y;
      zoomValue.current = next;
      setZoom(next);
    };
    const flush = () => {
      const request = pending;
      frame = null;
      pending = null;
      if (request && request.session === reading.current && request.session.alive)
        apply(request.value, request.x, request.y);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const session = reading.current;
      if (!session?.alive || !alive.current || !Number.isFinite(event.deltaY) || !event.deltaY)
        return;
      const value = normalizeZoom(
        (pending?.session === session ? pending.value : zoomValue.current) +
          (event.deltaY < 0 ? config.zoomStep : -config.zoomStep),
        config.minZoom,
        config.maxZoom,
        config.zoomStep,
      );
      pending = { session, value, x: event.clientX, y: event.clientY };
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || (event.key !== '0' && event.code !== 'Numpad0')) return;
      event.preventDefault();
      cancel();
      const bounds = view.getBoundingClientRect();
      apply(
        1,
        bounds.left + view.clientLeft + view.clientWidth / 2,
        bounds.top + view.clientTop + view.clientHeight / 2,
      );
    };
    view.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('blur', cancel);
    return () => {
      cancel();
      if (cancelZoom.current === cancel) cancelZoom.current = null;
      view.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('blur', cancel);
    };
  }, [config.minZoom, config.maxZoom, config.zoomStep]);

  // LIFECYCLE AND CLEANUP — passive scroll signals crossings, never page/React frame work.
  useEffect(() => {
    const view = viewport.current;
    if (!view) return undefined;
    const scroll = () => {
      const session = reading.current;
      if (!session) return;
      if (session.restoredTop !== null && Math.abs(session.restoredTop - view.scrollTop) <= 1) {
        session.restoredTop = null;
        session.lastTop = view.scrollTop;
        return;
      }
      session.restoredTop = null;
      delete session.focusIndex;
      session.lastTop = view.scrollTop;
      reconcile(session);
    };
    view.addEventListener('scroll', scroll, { passive: true });
    return () => view.removeEventListener('scroll', scroll);
  }, []);

  // LIFECYCLE AND CLEANUP — retire catalog and resident/in-flight generations on close.
  useEffect(() => {
    alive.current = true;
    const cleanup = () => {
      cancelZoom.current?.();
      alive.current = false;
      release(candidate.current);
      if (candidateCatalog.current) void host.release(candidateCatalog.current).catch(() => {});
      releaseReading(reading.current);
      current.current = null;
    };
    window.addEventListener('pagehide', cleanup, { once: true });
    return () => {
      window.removeEventListener('pagehide', cleanup);
      cleanup();
    };
  }, []);

  // UI AND LOCAL EVENTS — drag/drop and public reader requests reuse the same open operation.
  useEffect(() => {
    const view = viewport.current;
    if (!view) return undefined;
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = opening.current || navigating.current ? 'none' : 'copy';
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(event.dataTransfer.files);
      const file = files[0];
      if (files.length !== 1 || !file || !/\.cbz$/i.test(file.name)) {
        setDisplay((value) => ({ ...value, error: 'Drop one CBZ file at a time' }));
        return;
      }
      if (opening.current || navigating.current) return;
      void openChapter(
        {
          componentId,
          instanceId: config.id,
          filePath: config.filePath,
          configPath: config.configPath,
        },
        file,
      );
    };
    view.addEventListener('dragenter', over);
    view.addEventListener('dragover', over);
    view.addEventListener('drop', drop);
    return () => {
      view.removeEventListener('dragenter', over);
      view.removeEventListener('dragover', over);
      view.removeEventListener('drop', drop);
    };
  }, [input.openDroppedArchive]);
  useEffect(() => {
    return input.registerOpenRequest((source) => openChapter(source));
  }, [input.registerOpenRequest]);
  useEffect(() => {
    externalTarget.current = Math.max(externalTarget.current, input.externalOpenRevision);
    pumpExternalOpens();
  }, [input.externalOpenRevision]);
  useEffect(() => {
    syncNavigation();
    return input.registerNavigation(navigateChapter);
  }, [input.registerNavigation, input.publishNavigation]);

  // LIFECYCLE AND CLEANUP — RENDER SURFACE
  // One worker lives for the reader lifetime, not one per page/chapter.
  useEffect(() => {
    const view = viewport.current;
    const speedSetting = scrollSpeedSetting.current,
      durationMs = smoothDuration.current;
    if (!view || speedSetting === null || durationMs === null) return undefined;
    try {
      const renderer = attachReaderPixi(view, {
        gpu: config.renderer !== 'dom',
        momentum: config.momentum?.enabled !== false,
        speed: speedSetting / 10,
        maxFPS: config.maxFPS ?? 0,
        tileMemoryMB: config.tileMemoryMB ?? 128,
        tickWindowMs: config.momentum?.tickWindowMs ?? 150,
        smoothDurationMs: durationMs,
        maxDecodedMB: config.maxDecodedMB,
        getDocumentId: () => reading.current?.sceneId ?? '',
        getPages: () =>
          [...(reading.current?.records.values() ?? [])].flatMap((record) => {
            const chapter = record.chapter;
            return chapter?.alive
              ? [...chapter.preparedPages.values()].flatMap((page) => {
                  const image = chapter.images.get(page.index);
                  return image ? [{ image, page }] : [];
                })
              : [];
          }),
        canScroll: () =>
          alive.current && reading.current?.alive === true && !reading.current.paused,
        onMotion: () => metrics.current?.expect('momentum'),
        onIssue: (error) => {
          if (alive.current) setDisplay((value) => ({ ...value, error }));
        },
        reserve: (owner, bytes, limit) => input.reserveRender([owner, bytes, limit]),
      });
      surface.current = renderer;
      externalSurfaceReady.current = false;
      void renderer
        .ready()
        .then(() => {
          if (surface.current !== renderer) return;
          externalSurfaceReady.current = true;
          pumpExternalOpens();
        })
        .catch(() => {});
      return () => {
        externalSurfaceReady.current = false;
        if (surface.current === renderer) surface.current = null;
        void renderer.close();
      };
    } catch (error) {
      console.error(`Renderer unavailable: ${errorText(error)}`);
      return undefined;
    }
  }, [
    config.renderer,
    config.maxFPS,
    config.tileMemoryMB,
    config.momentum?.enabled,
    config.momentum?.tickWindowMs,
    config.maxDecodedMB,
    configuredSpeed,
    configuredSmoothDuration,
    input.reserveRender,
  ]);

  // STATE AND COORDINATION — apply accepted values live, then persist their overrides.
  useEffect(() => {
    const initial = scrollSpeedSetting.current;
    if (initial === null) return undefined;
    input.publishScrollSpeed(initial);
    return input.registerScrollSpeed(async (change) => {
      if (!finite(change.value, 1, 100)) return { ok: false, error: 'Scroll speed must be 10–100' };
      const previous = scrollSpeedSetting.current;
      scrollSpeedSetting.current = change.value;
      surface.current?.setSpeed(change.value / 10);
      input.publishScrollSpeed(change.value);
      const saved = await input.persistPreference({
        id: 'scrollSpeed',
        value: change.reset ? null : change.value,
      });
      if (!saved.ok && scrollSpeedSetting.current === change.value && previous !== null) {
        scrollSpeedSetting.current = previous;
        surface.current?.setSpeed(previous / 10);
        input.publishScrollSpeed(previous);
      }
      return saved;
    });
  }, [
    configuredSpeed,
    input.registerScrollSpeed,
    input.publishScrollSpeed,
    input.persistPreference,
  ]);
  useEffect(() => {
    const initial = smoothDuration.current;
    if (initial === null) return undefined;
    input.publishSmoothScrollDuration(initial);
    return input.registerSmoothScrollDuration(async (change) => {
      if (!Number.isInteger(change.value) || !finite(change.value, 100, 2000))
        return { ok: false, error: 'Smooth-scroll duration must be 100–2000 ms' };
      const previous = smoothDuration.current;
      smoothDuration.current = change.value;
      surface.current?.setSmoothDuration(change.value);
      input.publishSmoothScrollDuration(change.value);
      const saved = await input.persistPreference({
        id: 'smoothScrollDurationMs',
        value: change.reset ? null : change.value,
      });
      if (!saved.ok && smoothDuration.current === change.value && previous !== null) {
        smoothDuration.current = previous;
        surface.current?.setSmoothDuration(previous);
        input.publishSmoothScrollDuration(previous);
      }
      return saved;
    });
  }, [
    configuredSmoothDuration,
    input.registerSmoothScrollDuration,
    input.publishSmoothScrollDuration,
    input.persistPreference,
  ]);
  const status = display.error
    ? `${config.labels.failed}: ${display.error}`
    : display.phase
      ? config.labels[display.phase]
      : display.total
        ? `${display.name} · ${display.count}/${display.total}${display.count === display.total ? ` · ${config.labels.ready}` : ''}`
        : config.labels.empty;
  const overlayVisible = Boolean(display.phase || display.error);

  // STATE AND COORDINATION — publish phase so the Windows area can reflect reader state.
  useEffect(() => {
    input.publishState({ phase: display.phase, total: display.total });
  }, [display.phase, display.total, input.publishState]);
  // UI AND LOCAL EVENTS — native scroll container and configured status presentation.
  return (
    <Box
      className="fill"
      data-reader="true"
      aria-label={config.label}
      sx={{
        ...configuredSx(config),
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        position: 'relative',
      }}
    >
      <Box
        ref={viewport}
        id="reader-viewport"
        data-reader-viewport
        tabIndex={0}
        aria-label={config.label}
        sx={{
          flex: '1 1 0',
          minHeight: 0,
          width: '100%',
          overflowY: 'auto',
          overflowX: 'auto',
          scrollbarGutter: 'auto',
          overflowAnchor: 'none',
          position: 'relative',
          ...scrollbar.viewportSx,
        }}
      >
        <div
          ref={strip}
          data-reader-pages
          data-zoom={zoom}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        />
      </Box>
      {scrollbar.overlay}
      <Box
        data-reader-overlay
        data-visible={overlayVisible ? 'true' : 'false'}
        aria-live="polite"
        role="status"
        sx={{
          ...configuredSx(config.parts.overlay),
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          opacity: overlayVisible ? 1 : 0,
          transition: 'opacity 200ms',
          pointerEvents: 'none',
        }}
      >
        <Box
          component="output"
          data-reader-status
          data-prepared={display.count}
          data-total={display.total}
          sx={{ ...configuredSx(config.parts.status, display.error ? 'error' : undefined) }}
        >
          {status}
        </Box>
      </Box>
    </Box>
  );
}
