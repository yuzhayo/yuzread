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
  Failure,
} from '../../../ShellHost.js';
import type { ConfigReport, ChildProps } from '@logic/AreaDiscovery.ts';
import { hasParts, isNamedRecord } from '@logic/ConfigValidation.ts';
import type { ResolvedConfig, ResolvedPart } from '@logic/ConfigValidation.ts';
import type { ActionSource } from '@logic/Diagnostics.ts';
export type ReaderPhase = '' | 'scanning' | 'preparing';
export interface ReaderState {
  readonly phase: ReaderPhase;
  readonly total: number;
}
export type ScreenOpenResult =
  | { ok: true; canceled: true }
  | { ok: true; chapter: { id: string; pages: number } }
  | Failure
  | undefined;
export interface BodyReaderInput {
  openArchive(options: ReaderOpenOptions): Promise<ReaderOpenResult>;
  openChapter(request: ReaderChapterRequest): Promise<ReaderChapterResult>;
  preparePage(request: ReaderPrepareRequest): Promise<ReaderPrepareResult>;
  releaseChapter(id: string): Promise<Result>;
  registerOpenRequest(handler: (source: ActionSource) => Promise<ScreenOpenResult>): () => void;
  publishState(state: ReaderState): void;
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
  scrollbar: ScrollbarSettings;
  labels: Record<(typeof labelKeys)[number], string>;
  parts: Record<(typeof partKeys)[number], ResolvedPart>;
}
interface ReaderChapter extends Chapter {
  alive: boolean;
  images: Map<number, HTMLImageElement>;
  acceptedWidths: Map<number, number>;
  slots: HTMLDivElement[];
  decodeWidth: number;
  geometry: { readonly ratio: number; readonly maximumPixels: number };
  index: number;
  root: HTMLDivElement;
  complete: boolean;
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
  pending: { index: number; epoch: number } | null;
  restoredTop: number | null;
  lastTop: number;
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
    reject('maxDecodedMB', '64–4096 MB chapter budget', config.maxDecodedMB);
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

// LOGIC — base geometry is fixed per opening; explicit zoom is a separate operation.
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

// LOGIC — page elements/resources are owned here, not recreated on scroll or hover.
export default function BodyReader({ config, input }: ChildProps<ReaderConfig, BodyReaderInput>) {
  const viewport = useRef<HTMLDivElement>(null),
    strip = useRef<HTMLDivElement>(null);
  const scrollbar = useReaderScrollbar(viewport, strip, config.scrollbar, config.label);
  const current = useRef<ReaderChapter | null>(null),
    candidate = useRef<ReaderChapter | null>(null),
    reading = useRef<ReaderSession | null>(null),
    candidateCatalog = useRef<string | null>(null),
    alive = useRef(true),
    opening = useRef(false);
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
  const host = useMemo(
    () => ({
      open: input.openArchive,
      chapter: input.openChapter,
      prepare: (id: string, index: number, decodeWidth: number) =>
        input.preparePage([id, index, decodeWidth]),
      release: input.releaseChapter,
    }),
    [input.openArchive, input.openChapter, input.preparePage, input.releaseChapter],
  );
  const release = (chapter: ReaderChapter | null | undefined) => {
    if (!chapter) return;
    chapter.alive = false;
    for (const image of chapter.images.values()) image.removeAttribute('src');
    chapter.images.clear();
    chapter.acceptedWidths.clear();
    void host.release(chapter.id).catch(() => {});
  };
  const releaseReading = (session: ReaderSession | null) => {
    if (!session || !session.alive) return;
    session.alive = false;
    session.epoch++;
    session.observer.disconnect();
    for (const record of session.records.values()) release(record.chapter);
    session.records.clear();
    void host.release(session.catalog.id).catch(() => {});
  };
  const prepare = async (
    chapter: ReaderChapter,
    page: PageMetadata,
    decodeWidth: number,
  ): Promise<HTMLImageElement | null> => {
    const response = await host.prepare(chapter.id, page.index, decodeWidth);
    if (!chapter.alive || !alive.current) return null;
    if (!response.ok) throw new Error(`${page.name}: ${response.error}`);
    if (!acceptsPreparedPage(chapter, page, decodeWidth, response))
      throw new Error(`${page.name}: Stale or mismatched prepared page`);
    const accepted = chapter.images.get(page.index);
    if (accepted && retainsAcceptedWidth(chapter.acceptedWidths.get(page.index), response.width))
      return accepted;
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
    image.src = response.url;
    try {
      await image.decode();
    } catch {
      image.removeAttribute('src');
      throw new Error(`Cannot decode page: ${page.name}`);
    }
    if (!chapter.alive || !alive.current) {
      image.removeAttribute('src');
      return null;
    }
    if (image.naturalWidth !== response.width || image.naturalHeight !== response.height) {
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
    return image;
  };

  // CHAPTER GEOMETRY — every chapter reserves its own immutable boxes and origin.
  const buildChapter = (chapter: ReaderChapter): ChapterRecord => {
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
    const bounds = view.getBoundingClientRect();
    const residents = [...session.records.values()]
      .filter((record) => record.chapter)
      .sort((a, b) => a.index - b.index);
    const anchor = preserve
      ? (
          residents.find((record) => {
            const box = record.chapter?.root.getBoundingClientRect();
            return box && box.bottom > bounds.top && box.top < bounds.top + view.clientHeight;
          }) ?? residents[0]
        )?.chapter?.root
      : undefined;
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
    if (before && anchor?.isConnected) {
      const after = anchor.getBoundingClientRect();
      view.scrollLeft += after.left - before.left;
      view.scrollTop += after.top - before.top;
      session.restoredTop = view.scrollTop;
    }
    for (const element of content.children) session.observer.observe(element);
  };
  const publishCurrent = (chapter: ReaderChapter) => {
    if (current.current === chapter) return;
    cancelZoom.current?.();
    current.current = chapter;
    setDisplay((value) => ({
      ...value,
      name: chapter.name,
      count: chapter.images.size,
      total: chapter.pages.length,
    }));
  };
  const reconcile = (session: ReaderSession) => {
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
    const primary = visible[0]?.chapter ?? current.current;
    if (!primary) return;
    publishCurrent(primary);
    content.dataset.currentChapter = primary.entryId;
    content.dataset.nextChapter = session.catalog.chapters[primary.index + 1]?.id ?? '';
    const keep = new Set([
      ...visible.map((record) => record.index),
      primary.index,
      primary.index + 1,
    ]);
    const evicted: ReaderChapter[] = [];
    for (const record of residents) {
      if (keep.has(record.index)) continue;
      if (record.chapter) evicted.push(record.chapter);
      delete record.chapter;
    }
    if (evicted.length) {
      renderReading(session); // Detach first, restore layout/anchor, then release pixels/workers.
      for (const chapter of evicted) release(chapter);
    }
    if (session.pending || !primary.complete) return;
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
    const index = demand ?? primary.index + 1;
    if (
      !session.catalog.chapters[index] ||
      session.records.get(index)?.chapter ||
      session.errors.has(index)
    )
      return;
    void loadNeighbor(session, index);
  };
  const loadNeighbor = async (session: ReaderSession, index: number) => {
    const entry = session.catalog.chapters[index];
    if (!entry || session.pending || !session.alive || session.paused) return;
    const request = { index, epoch: session.epoch };
    session.pending = request;
    let chapter: ReaderChapter | undefined;
    const valid = () =>
      alive.current &&
      session.alive &&
      !session.paused &&
      reading.current === session &&
      session.epoch === request.epoch;
    try {
      const previous = session.records.get(index);
      const ratio = Math.max(0.1, window.devicePixelRatio || 1);
      const geometry = previous?.geometry ?? {
        ratio,
        maximumPixels: Math.min(config.maxRenderWidth, maximumPixels(ratio)),
      };
      const response = await host.chapter([
        session.catalog.id,
        entry.id,
        {
          renderWidth: geometry.maximumPixels,
          maxDecodeWidth: config.maxRenderWidth,
          maxDecodedMB: config.maxDecodedMB,
        },
      ]);
      if (!response.ok) throw new Error(response.error);
      chapter = {
        ...response.chapter,
        alive: true,
        images: new Map(),
        acceptedWidths: new Map(),
        slots: [],
        decodeWidth: geometry.maximumPixels,
        geometry,
        index,
        root: document.createElement('div'),
        complete: false,
      };
      if (!valid()) return;
      if (!acceptsCatalogChapter(session.catalog, entry.id, chapter))
        throw new Error('Mismatched chapter/catalog identity');
      if (
        previous &&
        (previous.sourceRevision !== chapter.sourceRevision ||
          previous.pages.length !== chapter.pages.length ||
          previous.pages.some((page, i) => {
            const next = chapter?.pages[i];
            return (
              !next ||
              page.id !== next.id ||
              page.width !== next.width ||
              page.height !== next.height
            );
          }))
      )
        throw new Error('Stored chapter geometry/source changed; reopen the archive');
      for (const page of chapter.pages) {
        if (!valid()) return;
        if (!(await prepare(chapter, page, chapter.decodeWidth))) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!valid()) return;
      chapter.complete = true;
      const record = buildChapter(chapter);
      session.records.set(index, record);
      session.first = Math.min(session.first, index);
      session.last = Math.max(session.last, index);
      renderReading(session);
      chapter = undefined; // Ownership transfers only after accepted pixels and layout publication.
    } catch (error) {
      if (valid()) {
        const message = `${entry.name}: ${errorText(error)}`;
        session.errors.set(index, message);
        setDisplay((value) => ({ ...value, error: message }));
      }
    } finally {
      release(chapter);
      if (session.pending === request) session.pending = null;
      if (alive.current && session.alive && !session.paused && reading.current === session)
        reconcile(session);
    }
  };

  // LOGIC — first 3–5 appear early; complete current before speculative next work.
  const loadRemaining = async (
    session: ReaderSession,
    chapter: ReaderChapter,
    first: number,
    decodeWidth: number,
  ) => {
    for (let index = first; index < chapter.pages.length; index++) {
      if (!chapter.alive || !alive.current || !session.alive) return;
      try {
        const page = chapter.pages[index],
          slot = chapter.slots[index];
        if (!page || !slot) throw new Error('Page slot is unavailable');
        const image = await prepare(chapter, page, decodeWidth);
        if (!image || reading.current !== session || !session.alive) return;
        slot.replaceChildren(image);
        if (current.current === chapter) setDisplay((value) => ({ ...value, count: index + 1 }));
        // Yield between pages. No animation loop or React updates are tied to scrolling.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } catch (error) {
        if (chapter.alive && alive.current && current.current === chapter)
          setDisplay((value) => ({ ...value, error: errorText(error) }));
        return;
      }
    }
    chapter.complete = true;
    reconcile(session);
  };
  const maximumPixels = (ratio: number) => {
    if (!viewport.current) throw new Error('Reader is not mounted');
    const available = viewport.current.clientWidth - config.pageInset;
    return Math.max(1, Math.floor(available * ratio));
  };
  const openChapter = async (_source: ActionSource): Promise<ScreenOpenResult> => {
    if (opening.current) return { ok: false, error: 'Another Open operation is active' };
    opening.current = true;
    const previousReading = reading.current;
    if (previousReading) {
      previousReading.paused = true;
      previousReading.epoch++;
    }
    setDisplay((value) => ({ ...value, phase: 'scanning', error: '' }));
    let staging: ReaderChapter | undefined;
    try {
      // Snapshot before async dialog/decode work. A resize while loading must not
      // enlarge boxes beyond the pixels prepared for this accepted chapter.
      const ratio = Math.max(0.1, window.devicePixelRatio || 1);
      const decodeWidth = Math.min(config.maxRenderWidth, maximumPixels(ratio));
      const geometry = { ratio, maximumPixels: decodeWidth };
      const response = await host.open({
        renderWidth: decodeWidth,
        maxDecodeWidth: config.maxRenderWidth,
        maxDecodedMB: config.maxDecodedMB,
      });
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
        pending: null,
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
      void loadRemaining(session, staging, first, decodeWidth);
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
        reconcile(previousReading);
      }
    }
  };

  // ZOOM — only explicit input schedules a frame; ordinary scrolling stays native.
  useEffect(() => {
    const view = viewport.current,
      content = strip.current;
    if (!view || !content) return undefined;
    let frame: number | null = null;
    let pending: { chapter: ReaderChapter; value: number; x: number; y: number } | null = null;
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    };
    cancelZoom.current = cancel;
    const apply = (value: number, x: number, y: number) => {
      const next = normalizeZoom(value, config.minZoom, config.maxZoom, config.zoomStep);
      const old = zoomValue.current;
      if (next === old || !alive.current || !current.current?.alive) return;
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
      if (request && request.chapter === current.current && request.chapter.alive)
        apply(request.value, request.x, request.y);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const chapter = current.current;
      if (!chapter?.alive || !alive.current || !Number.isFinite(event.deltaY) || !event.deltaY)
        return;
      const value = normalizeZoom(
        (pending?.chapter === chapter ? pending.value : zoomValue.current) +
          (event.deltaY < 0 ? config.zoomStep : -config.zoomStep),
        config.minZoom,
        config.maxZoom,
        config.zoomStep,
      );
      pending = { chapter, value, x: event.clientX, y: event.clientY };
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

  // LIFECYCLE — passive scroll signals chapter crossings, never page/React frame work.
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
      session.lastTop = view.scrollTop;
      reconcile(session);
    };
    view.addEventListener('scroll', scroll, { passive: true });
    return () => view.removeEventListener('scroll', scroll);
  }, []);

  // LIFECYCLE — retire the catalog and every resident/in-flight generation on close.
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

  // LOGIC — the reader owns the open capability; the Windows area only requests it.
  useEffect(() => {
    return input.registerOpenRequest((source) => openChapter(source));
  }, [input.registerOpenRequest]);

  // UI — native scroll container; all tuning/visible styling comes from JSON.
  const status = display.error
    ? `${config.labels.failed}: ${display.error}`
    : display.phase
      ? config.labels[display.phase]
      : display.total
        ? `${display.name} · ${display.count}/${display.total}${display.count === display.total ? ` · ${config.labels.ready}` : ''}`
        : config.labels.empty;
  const overlayVisible = Boolean(display.phase || display.error);

  // LOGIC — publish the reader's phase so the Windows area can reflect its state.
  useEffect(() => {
    input.publishState({ phase: display.phase, total: display.total });
  }, [display.phase, display.total, input.publishState]);
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
