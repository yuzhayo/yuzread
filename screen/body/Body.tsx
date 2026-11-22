import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea, bindChild } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { contract, createRequest, createState } from '@logic/ParentConnections.ts';
import { isObject, oneOf } from '@logic/VisualConfig.ts';
import type {
  ReaderOpenOptions,
  ReaderOpenResult,
  ReaderPrepareResult,
  ReaderPrepareRequest,
  ReaderChapterRequest,
  ReaderChapterResult,
  ReaderCatalog,
  Chapter,
  Result,
  PageMetadata,
  ReaderBudget,
  ReaderWorkPriority,
  ReaderMetricEvent,
} from '../../ShellHost.js';
import BodyReader, {
  componentId,
  configKeys,
  partKeys,
  validateConfig,
} from './reader/BodyReader.tsx';
import type { ScreenOpenResult, ReaderState, ReaderOpenIntent } from './reader/BodyReader.tsx';

// CONFIG AND CONTRACT — the parent validates connection shapes, not reader algorithms.
export const areaId = 'body';
export const parentName = 'Body';
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
  picker(v.picker);
const result = (v: unknown): v is Result =>
  isObject(v) && (v.ok === true || (v.ok === false && typeof v.error === 'string'));
const createPorts = () => ({
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
            integer(v.height))),
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
      (v: unknown): v is import('../../ShellHost.js').ReaderRenderReserveRequest =>
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
});
type Ports = ReturnType<typeof createPorts>;
const children = [
  bindChild(
    BodyReader,
    validateConfig,
    { componentId, fileName: 'reader/BodyReader.tsx', configKeys, partKeys },
    (ports: Ports) => ({
      openArchive: ports.archiveOpen.request,
      openChapter: ports.chapterOpen.request,
      preparePage: ports.prepare.request,
      releaseChapter: ports.release.request,
      registerOpenRequest: ports.open.register,
      publishState: ports.readerState.publish,
      submitReaderMetrics: ports.readerMetrics.request,
      reserveRender: ports.renderReserve.request,
    }),
  ),
];
export default function Body({ config, ports, report }: AreaProps<Ports>) {
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(Body, children, createPorts);
