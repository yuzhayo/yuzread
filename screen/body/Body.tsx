import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea, bindChild } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { contract, createRequest, createState } from '@logic/ParentConnections.ts';
import { isObject, oneOf } from '@logic/VisualConfig.ts';
import type { ActionSource } from '@logic/Diagnostics.ts';
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
} from '../../ShellHost.js';
import BodyReader, {
  componentId,
  configKeys,
  partKeys,
  validateConfig,
} from './reader/BodyReader.tsx';
import type { ScreenOpenResult, ReaderState } from './reader/BodyReader.tsx';

// CONFIG AND CONTRACT — the parent validates connection shapes, not reader algorithms.
export const areaId = 'body';
export const parentName = 'Body';
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
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
  isObject(v) &&
  ((v.ok === false && typeof v.error === 'string') || (v.ok === true && chapter(v.chapter)));
const openResult = (v: unknown): v is ReaderOpenResult => {
  if (!isObject(v)) return false;
  if (v.ok === false) return typeof v.error === 'string';
  if (v.ok !== true) return false;
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
const options = (v: unknown): v is ReaderOpenOptions =>
  isObject(v) &&
  typeof v.renderWidth === 'number' &&
  typeof v.maxDecodeWidth === 'number' &&
  typeof v.maxDecodedMB === 'number';
const result = (v: unknown): v is Result =>
  isObject(v) && (v.ok === true || (v.ok === false && typeof v.error === 'string'));
const createPorts = () => ({
  open: createRequest(
    contract('ui.open.input', (v: unknown): v is ActionSource => isObject(v)),
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
    contract(
      'native.reader.open.input.v2',
      (v: unknown): v is ReaderOpenOptions =>
        isObject(v) &&
        typeof v.renderWidth === 'number' &&
        typeof v.maxDecodeWidth === 'number' &&
        typeof v.maxDecodedMB === 'number',
    ),
    contract('native.reader.open.output.v3', openResult),
    { ok: false, error: 'Capability is unavailable' },
  ),
  chapterOpen: createRequest(
    contract(
      'native.reader.chapter.input',
      (v: unknown): v is ReaderChapterRequest =>
        Array.isArray(v) &&
        v.length === 3 &&
        typeof v[0] === 'string' &&
        typeof v[1] === 'string' &&
        options(v[2]),
    ),
    contract('native.reader.chapter.output', chapterResult),
    { ok: false, error: 'Capability is unavailable' },
  ),
  prepare: createRequest(
    contract(
      'native.reader.prepare.input.v2',
      (v: unknown): v is ReaderPrepareRequest =>
        Array.isArray(v) &&
        v.length === 3 &&
        typeof v[0] === 'string' &&
        typeof v[1] === 'number' &&
        typeof v[2] === 'number',
    ),
    contract(
      'native.reader.prepare.output.v2',
      (v: unknown): v is ReaderPrepareResult =>
        isObject(v) &&
        ((v.ok === false && typeof v.error === 'string') ||
          (v.ok === true &&
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
    }),
  ),
];
export default function Body({ config, ports, report }: AreaProps<Ports>) {
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(Body, children, createPorts);
