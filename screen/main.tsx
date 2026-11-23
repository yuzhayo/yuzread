import { createRoot } from 'react-dom/client';
import { createDiagnostics } from '@logic/Diagnostics.ts';
import { discoverAreas } from '@logic/AreaDiscovery.ts';
import { validateScreenConfig } from '@logic/ConfigValidation.ts';
import { contract, createRequest, createState, parentBinding } from '@logic/ParentConnections.ts';
import Screen from './Screen.tsx';
import type { ScreenInput } from './Screen.tsx';
import { errorText, isObject, oneOf } from '@logic/VisualConfig.ts';
import type {
  WindowState,
  WindowOperation,
  WindowActionResult,
  ReaderOpenOptions,
  ReaderOpenResult,
  ReaderPrepareResult,
  ReaderPrepareRequest,
  ReaderChapterRequest,
  ReaderChapterResult,
  ReaderCatalog,
  Chapter,
  PageMetadata,
  DiagnosticRecord,
  Result,
  ReaderBudget,
  ReaderWorkPriority,
  ReaderMetricEvent,
} from '../ShellHost.js';
import './styles.css';

// LOGIC — discover, validate, compose capabilities, then mount. No filesystem in UI.
async function start() {
  const bootstrap = await window.shellHost.bootstrap();
  if ('ok' in bootstrap) throw new Error(bootstrap.error);
  const raw = bootstrap.config;
  if (!isObject(raw) || !isObject(raw.window) || typeof raw.window.title !== 'string')
    throw new Error('Invalid bootstrap window title');
  // CONFIG AND CONTRACT — native boundary adapters only, no feature imports/policy.
  const diagnostics = createDiagnostics(window.shellHost.diagnostics);
  const validState = (v: unknown): v is WindowState =>
    isObject(v) && typeof v.maximized === 'boolean' && typeof v.minimized === 'boolean';
  const positive = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v > 0;
  const count = (v: unknown): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  const metricEvent = (v: unknown): v is ReaderMetricEvent =>
    isObject(v) &&
    oneOf(v.kind, [
      'image',
      'attach',
      'frame-gap',
      'frame-summary',
      'long-task',
      'scroll-jump',
      'motion',
    ] as const) &&
    typeof v.clockMs === 'number' &&
    Number.isFinite(v.clockMs) &&
    v.clockMs >= 0 &&
    v.clockMs <= 1e12 &&
    Object.keys(v).every((key) => ['kind', 'clockMs', 'values'].includes(key)) &&
    isObject(v.values) &&
    Object.keys(v.values).length <= 16 &&
    Object.entries(v.values).every(
      ([key, item]) =>
        /^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(key) &&
        (typeof item === 'boolean' ||
          (typeof item === 'string' && item.length <= 128) ||
          (typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1e12)),
    );
  const budget = (v: unknown): v is ReaderBudget =>
    isObject(v) &&
    count(v.limitBytes) &&
    count(v.residentBytes) &&
    count(v.inFlightBytes) &&
    v.limitBytes <= 4096 * 1048576 &&
    v.residentBytes + v.inFlightBytes <= v.limitBytes &&
    count(v.activeJobs) &&
    v.activeJobs <= 1 &&
    count(v.queuedJobs) &&
    v.queuedJobs <= 64;
  const budgetField = (v: Record<string, unknown>) => v.budget === undefined || budget(v.budget);
  const priority = (v: unknown): v is ReaderWorkPriority | undefined =>
    v === undefined || oneOf(v, ['demand', 'visible', 'background'] as const);
  const failure = (v: Record<string, unknown>) =>
    v.ok === false &&
    typeof v.error === 'string' &&
    (v.code === undefined || v.code === 'deferred' || v.code === 'cancelled') &&
    budgetField(v);
  const page = (v: unknown): v is PageMetadata =>
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.index === 'number' &&
    Number.isInteger(v.index) &&
    v.index >= 0 &&
    typeof v.name === 'string' &&
    positive(v.width) &&
    positive(v.height) &&
    positive(v.targetWidth) &&
    positive(v.targetHeight);
  const chapter = (v: unknown): v is Chapter =>
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.catalogId === 'string' &&
    typeof v.entryId === 'string' &&
    typeof v.sourceRevision === 'string' &&
    typeof v.name === 'string' &&
    typeof v.estimatedBytes === 'number' &&
    Array.isArray(v.pages) &&
    v.pages.every(page);
  const validCatalog = (v: unknown): v is ReaderCatalog =>
    isObject(v) &&
    typeof v.id === 'string' &&
    Array.isArray(v.chapters) &&
    v.chapters.length > 0 &&
    v.chapters.length <= 10000 &&
    v.chapters.every(
      (entry: unknown) =>
        isObject(entry) && typeof entry.id === 'string' && typeof entry.name === 'string',
    );
  const chapterResult = (v: unknown): v is ReaderChapterResult =>
    isObject(v) && (failure(v) || (v.ok === true && chapter(v.chapter) && budgetField(v)));
  const openResult = (v: unknown): v is ReaderOpenResult => {
    if (!isObject(v)) return false;
    if (v.ok === false) return failure(v);
    if (v.ok !== true || !budgetField(v)) return false;
    if (v.canceled === true) return true;
    const value = v.chapter,
      list = v.catalog;
    return (
      chapter(value) &&
      validCatalog(list) &&
      value.catalogId === list.id &&
      list.chapters.some((entry) => entry.id === value.entryId)
    );
  };
  const picker = (v: unknown) =>
    v === undefined ||
    (isObject(v) &&
      (v.folderPath === undefined ||
        (typeof v.folderPath === 'string' &&
          v.folderPath.length <= 4096 &&
          !v.folderPath.includes('\0'))) &&
      (v.rememberFolder === undefined || typeof v.rememberFolder === 'boolean'));
  const options = (v: unknown): v is ReaderOpenOptions =>
    isObject(v) &&
    typeof v.renderWidth === 'number' &&
    typeof v.maxDecodeWidth === 'number' &&
    typeof v.maxDecodedMB === 'number' &&
    picker(v.picker) &&
    (v.tileCache === undefined || typeof v.tileCache === 'boolean');
  const preparedTiles = (v: unknown) =>
    v === undefined ||
    (Array.isArray(v) &&
      v.length > 0 &&
      v.length <= 10000 &&
      v.every(
        (tile: unknown) =>
          isObject(tile) &&
          count(tile.index) &&
          count(tile.left) &&
          count(tile.top) &&
          positive(tile.width) &&
          tile.width <= 1024 &&
          positive(tile.height) &&
          tile.height <= 1024 &&
          positive(tile.encodedWidth) &&
          tile.encodedWidth <= 1026 &&
          positive(tile.encodedHeight) &&
          tile.encodedHeight <= 1026 &&
          (tile.offsetX === 0 || tile.offsetX === 1) &&
          (tile.offsetY === 0 || tile.offsetY === 1) &&
          positive(tile.bytes) &&
          typeof tile.url === 'string',
      ));
  const result = (v: unknown): v is Result =>
    isObject(v) && (v.ok === true || (v.ok === false && typeof v.error === 'string'));
  const diagnostic = (v: unknown): v is DiagnosticRecord =>
    isObject(v) &&
    [
      'code',
      'componentId',
      'instanceId',
      'parentId',
      'filePath',
      'configPath',
      'expected',
      'actual',
      'key',
      'firstTimestamp',
      'lastTimestamp',
      'action',
      'message',
    ].every((key) => typeof v[key] === 'string') &&
    typeof v.count === 'number';
  const ports = {
    windowAction: createRequest(
      contract('native.window.input', (v: unknown): v is WindowOperation =>
        oneOf(v, ['minimize', 'restoreDefault', 'toggleMaximize', 'close'] as const),
      ),
      contract(
        'native.window.output',
        (v: unknown): v is WindowActionResult =>
          isObject(v) &&
          ((v.ok === false && typeof v.error === 'string') ||
            (v.ok === true && validState(v.state))),
      ),
      { ok: false, error: 'Capability is unavailable' },
    ),
    windowState: createState(contract('native.window.state', validState), bootstrap.windowState),
    title: createState(
      contract('native.title', (v: unknown): v is string => typeof v === 'string'),
      raw.window.title,
    ),
    hover: createState(
      contract(
        'native.hover',
        (v: unknown): v is string[] =>
          Array.isArray(v) && v.every((value) => typeof value === 'string'),
      ),
      bootstrap.hoveredSections,
    ),
    archiveOpen: createRequest(
      contract('native.reader.open.input.v3', options),
      contract('native.reader.open.output.v4', openResult),
      { ok: false, error: 'Capability is unavailable' },
    ),
    chapterOpen: createRequest(
      contract(
        'native.reader.chapter.input.v2',
        (v: unknown): v is ReaderChapterRequest =>
          Array.isArray(v) &&
          (v.length === 3 || v.length === 4) &&
          typeof v[0] === 'string' &&
          typeof v[1] === 'string' &&
          options(v[2]) &&
          priority(v[3]),
      ),
      contract('native.reader.chapter.output.v2', chapterResult),
      { ok: false, error: 'Capability is unavailable' },
    ),
    prepare: createRequest(
      contract(
        'native.reader.prepare.input.v3',
        (v: unknown): v is ReaderPrepareRequest =>
          Array.isArray(v) &&
          (v.length === 3 || v.length === 4) &&
          typeof v[0] === 'string' &&
          typeof v[1] === 'number' &&
          typeof v[2] === 'number' &&
          priority(v[3]),
      ),
      contract(
        'native.reader.prepare.output.v3',
        (v: unknown): v is ReaderPrepareResult =>
          isObject(v) &&
          (failure(v) ||
            (v.ok === true &&
              budgetField(v) &&
              typeof v.url === 'string' &&
              typeof v.id === 'string' &&
              typeof v.pageId === 'string' &&
              typeof v.sourceRevision === 'string' &&
              typeof v.index === 'number' &&
              Number.isInteger(v.index) &&
              v.index >= 0 &&
              positive(v.requestedWidth) &&
              positive(v.width) &&
              positive(v.height) &&
              preparedTiles(v.tiles) &&
              (v.tiles === undefined ||
                (typeof v.catalogId === 'string' && typeof v.entryId === 'string')))),
      ),
      { ok: false, error: 'Capability is unavailable' },
    ),
    release: createRequest(
      contract('native.reader.release.input', (v: unknown): v is string => typeof v === 'string'),
      contract('native.result', result),
      { ok: false, error: 'Capability is unavailable' },
    ),
    readerMetrics: createRequest(
      contract(
        'native.reader.metrics.input',
        (v: unknown): v is ReaderMetricEvent[] =>
          Array.isArray(v) && v.length <= 128 && v.every(metricEvent),
      ),
      contract('native.result', result),
      { ok: false, error: 'Capability is unavailable' },
    ),
    renderReserve: createRequest(
      contract(
        'native.reader.render-reserve.input',
        (v: unknown): v is import('../ShellHost.js').ReaderRenderReserveRequest =>
          Array.isArray(v) &&
          v.length === 3 &&
          typeof v[0] === 'string' &&
          /^[0-9a-f-]{36}$/.test(v[0]) &&
          typeof v[1] === 'number' &&
          Number.isSafeInteger(v[1]) &&
          v[1] >= 0 &&
          v[1] <= 4294967296 &&
          typeof v[2] === 'number' &&
          Number.isInteger(v[2]) &&
          v[2] >= 64 &&
          v[2] <= 4096,
      ),
      contract('native.result', result),
      { ok: false, error: 'Capability is unavailable' },
    ),
    issues: createState(
      contract(
        'native.issues',
        (v: unknown): v is DiagnosticRecord[] => Array.isArray(v) && v.every(diagnostic),
      ),
      diagnostics.getSnapshot(),
    ),
    labels: createState(
      contract(
        'screen.status.labels',
        (v: unknown): v is { ready: string; issues: string } =>
          isObject(v) && typeof v.ready === 'string' && typeof v.issues === 'string',
      ),
      { ready: '', issues: '' },
    ),
  };
  const host = window.shellHost;
  const forwardWindowState = (next: WindowState) => {
    const current = ports.windowState.getSnapshot();
    if (next.maximized !== current.maximized || next.minimized !== current.minimized)
      ports.windowState.publish(next);
  };
  const cleanup = [
    ports.windowAction.register(async (operation) => {
      const response = await host.windowAction(operation);
      if (response.ok) forwardWindowState(response.state);
      return response;
    }),
    ports.archiveOpen.register(host.reader.open),
    ports.chapterOpen.register(([catalogId, entryId, options, priority]) =>
      host.reader.chapter(catalogId, entryId, options, priority),
    ),
    ports.prepare.register(([id, index, decodeWidth, priority]) =>
      host.reader.prepare(id, index, decodeWidth, priority),
    ),
    ports.release.register(host.reader.release),
    ports.readerMetrics.register(host.reader.diagnostics),
    ports.renderReserve.register(([owner, bytes, limit]) =>
      host.reader.reserveRender(owner, bytes, limit),
    ),
    host.onWindowState(forwardWindowState),
    host.onSectionHover(ports.hover.publish),
    diagnostics.subscribe(() => ports.issues.publish(diagnostics.getSnapshot())),
  ];
  const nativeBinding = parentBinding(ports);
  const input: ScreenInput = {
    ...nativeBinding,
    getHoveredSections: ports.hover.getSnapshot,
    subscribeHover: ports.hover.subscribe,
    setStatusLabels: ports.labels.publish,
  };
  window.addEventListener(
    'pagehide',
    () => {
      queueMicrotask(() => {
        void input.settle().finally(() => {
          cleanup.forEach((dispose) => dispose());
          input.dispose();
        });
      });
      void diagnostics.flush();
    },
    { once: true },
  );
  document.title = raw.window.title;
  const catalog = await discoverAreas(
    import.meta.glob(['./**/*.tsx', '!./shared/**', '!./main.tsx', '!./Screen.tsx']),
    diagnostics,
  );
  const initialPlan = validateScreenConfig(bootstrap.config, catalog, diagnostics, input);
  const root = document.getElementById('root');
  if (!root) throw new Error('Screen mount element is missing');
  createRoot(root).render(
    <Screen
      bootstrap={bootstrap}
      initialPlan={initialPlan}
      catalog={catalog}
      diagnostics={diagnostics}
      input={input}
    />,
  );
}

void start().catch((error) => {
  console.error(error);
  void window.shellHost.startupError(errorText(error));
});
