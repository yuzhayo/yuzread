import { contract, createRequest, createState } from '@logic/ParentConnections.ts';
import { isObject, oneOf } from '@logic/VisualConfig.ts';
import type { ActionSource } from '@logic/Diagnostics.ts';
import type {
  Chapter,
  Failure,
  PageMetadata,
  ReaderBudget,
  ReaderCatalog,
  ReaderChapterRequest,
  ReaderChapterResult,
  ReaderDropRequest,
  ReaderMetricEvent,
  ReaderNavigationRequest,
  ReaderNavigationState,
  ReaderNumberSettingChange,
  ReaderOpenOptions,
  ReaderOpenResult,
  ReaderPickerSettings,
  ReaderPrepareRequest,
  ReaderPrepareResult,
  ReaderRenderReserveRequest,
  ReaderPreferenceSnapshot,
  ReaderPreferenceUpdate,
  ReaderWorkPriority,
  ReaderExternalWheel,
  Result,
} from '../../../ShellHost.js';

// CONFIG AND CONTRACT — Body's public relay ports; no reader rendering or scheduling policy.
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
export type ReaderOpenIntent = ActionSource & {
  picker?: ReaderPickerSettings;
  external?: boolean;
};

const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
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
  integer(v.width) &&
  integer(v.height) &&
  integer(v.targetWidth) &&
  integer(v.targetHeight);
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
const catalog = (v: unknown): v is ReaderCatalog =>
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
    catalog(list) &&
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
        integer(tile.width) &&
        tile.width <= 1024 &&
        integer(tile.height) &&
        tile.height <= 1024 &&
        integer(tile.encodedWidth) &&
        tile.encodedWidth <= 1026 &&
        integer(tile.encodedHeight) &&
        tile.encodedHeight <= 1026 &&
        (tile.offsetX === 0 || tile.offsetX === 1) &&
        (tile.offsetY === 0 || tile.offsetY === 1) &&
        integer(tile.bytes) &&
        typeof tile.url === 'string',
    ));
const result = (v: unknown): v is Result =>
  isObject(v) && (v.ok === true || (v.ok === false && typeof v.error === 'string'));
const settingChange = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is ReaderNumberSettingChange =>
  isObject(value) &&
  typeof value.value === 'number' &&
  Number.isFinite(value.value) &&
  value.value >= minimum &&
  value.value <= maximum &&
  (value.reset === undefined || typeof value.reset === 'boolean');
const preferences = (value: unknown): value is ReaderPreferenceSnapshot | null =>
  value === null ||
  (isObject(value) &&
    value.version === 1 &&
    isObject(value.values) &&
    Object.keys(value.values).length <= 64 &&
    Object.entries(value.values).every(
      ([id, item]) =>
        /^[a-z][A-Za-z0-9]{0,63}$/.test(id) && typeof item === 'number' && Number.isFinite(item),
    ));

export const createBodyPorts = () => ({
  navigateChapter: createRequest(
    contract(
      'ui.reader.navigation.input',
      (v: unknown): v is ReaderNavigationRequest =>
        isObject(v) &&
        typeof v.catalogId === 'string' &&
        (v.action === 'previous' ||
          v.action === 'next' ||
          (v.action === 'select' && typeof v.entryId === 'string')),
    ),
    contract('ui.reader.navigation.output', result),
    { ok: false, error: 'Reader navigation is unavailable' },
  ),
  navigation: createState(
    contract(
      'ui.reader.navigation.state',
      (v: unknown): v is ReaderNavigationState =>
        isObject(v) &&
        typeof v.catalogId === 'string' &&
        typeof v.currentId === 'string' &&
        typeof v.busy === 'boolean' &&
        Array.isArray(v.chapters) &&
        v.chapters.length <= 10000 &&
        v.chapters.every(
          (entry: unknown) =>
            isObject(entry) && typeof entry.id === 'string' && typeof entry.name === 'string',
        ),
    ),
    { catalogId: '', currentId: '', chapters: [], busy: false },
  ),
  setScrollSpeed: createRequest(
    contract('ui.reader.speed.input', (v: unknown): v is ReaderNumberSettingChange =>
      settingChange(v, 1, 100),
    ),
    contract('ui.reader.speed.output', result),
    { ok: false, error: 'Reader speed is unavailable' },
  ),
  scrollSpeed: createState(
    contract(
      'ui.reader.speed.state',
      (v: unknown): v is number | null =>
        v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 100),
    ),
    null,
  ),
  setSmoothScrollDuration: createRequest(
    contract('ui.reader.smooth-duration.input', (v: unknown): v is ReaderNumberSettingChange =>
      settingChange(v, 100, 2000),
    ),
    contract('ui.reader.smooth-duration.output', result),
    { ok: false, error: 'Reader smooth-scroll duration is unavailable' },
  ),
  smoothScrollDuration: createState(
    contract(
      'ui.reader.smooth-duration.state',
      (v: unknown): v is number | null =>
        v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 2000),
    ),
    null,
  ),
  setMomentumDuration: createRequest(
    contract('ui.reader.momentum-duration.input', (v: unknown): v is ReaderNumberSettingChange =>
      settingChange(v, 100, 2000),
    ),
    contract('ui.reader.momentum-duration.output', result),
    { ok: false, error: 'Reader momentum duration is unavailable' },
  ),
  momentumDuration: createState(
    contract(
      'ui.reader.momentum-duration.state',
      (v: unknown): v is number | null =>
        v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 2000),
    ),
    null,
  ),
  readerPreferences: createState(contract('native.reader.preferences.state', preferences), null),
  saveReaderPreference: createRequest(
    contract(
      'native.reader.preference.input',
      (v: unknown): v is ReaderPreferenceUpdate =>
        isObject(v) &&
        typeof v.id === 'string' &&
        /^[a-z][A-Za-z0-9]{0,63}$/.test(v.id) &&
        (v.value === null || (typeof v.value === 'number' && Number.isFinite(v.value))),
    ),
    contract('native.result', result),
    { ok: false, error: 'Reader preference storage is unavailable' },
  ),
  open: createRequest(
    contract(
      'ui.open.input.v2',
      (v: unknown): v is ReaderOpenIntent => isObject(v) && picker(v.picker),
    ),
    contract(
      'ui.open.output',
      (v: unknown): v is ScreenOpenResult =>
        v === undefined ||
        (isObject(v) &&
          ((v.ok === false && typeof v.error === 'string') ||
            (v.ok === true &&
              (v.canceled === true ||
                (isObject(v.chapter) &&
                  typeof v.chapter.id === 'string' &&
                  typeof v.chapter.pages === 'number'))))),
    ),
    { ok: false, error: 'Capability is unavailable' },
  ),
  externalOpen: createRequest(
    contract('native.reader.external-open.input.v1', options),
    contract('native.reader.open.output.v4', openResult),
    { ok: false, error: 'External CBZ opening is unavailable' },
  ),
  externalOpenRevision: createState(
    contract(
      'native.reader.external-open.revision',
      (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
    ),
    0,
  ),
  readerState: createState<ReaderState>(
    contract(
      'ui.reader.state',
      (v: unknown): v is ReaderState =>
        isObject(v) &&
        oneOf(v.phase, ['', 'scanning', 'preparing'] as const) &&
        typeof v.total === 'number',
    ),
    { phase: '', total: 0 },
  ),
  archiveOpen: createRequest(
    contract('native.reader.open.input.v3', options),
    contract('native.reader.open.output.v4', openResult),
    { ok: false, error: 'Capability is unavailable' },
  ),
  dropOpen: createRequest(
    contract(
      'native.reader.drop.input',
      (v: unknown): v is ReaderDropRequest =>
        Array.isArray(v) && v.length === 2 && v[0] instanceof File && options(v[1]),
    ),
    contract('native.reader.open.output.v4', openResult),
    { ok: false, error: 'Dropped file opening is unavailable' },
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
            integer(v.requestedWidth) &&
            integer(v.width) &&
            integer(v.height) &&
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
      (v: unknown): v is ReaderRenderReserveRequest =>
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
  scrollAnywhereWheel: createState(
    contract(
      'native.reader.scroll-anywhere.wheel',
      (v: unknown): v is ReaderExternalWheel | null =>
        v === null ||
        (isObject(v) &&
          typeof v.delta === 'number' &&
          Number.isInteger(v.delta) &&
          v.delta !== 0 &&
          Math.abs(v.delta) <= 2400 &&
          typeof v.lines === 'number' &&
          Number.isInteger(v.lines) &&
          v.lines >= -1 &&
          v.lines <= 100 &&
          typeof v.timestamp === 'number' &&
          Number.isFinite(v.timestamp) &&
          v.timestamp > 0),
    ),
    null,
  ),
  scrollAnywhereReady: createRequest(
    contract(
      'native.reader.scroll-anywhere-ready.input',
      (v: unknown): v is boolean => typeof v === 'boolean',
    ),
    contract('native.result', result),
    { ok: false, error: 'Capability is unavailable' },
  ),
});

export type BodyPorts = ReturnType<typeof createBodyPorts>;
