import { useSyncExternalStore } from 'react';
import { AreaChildren } from '@ui/AreaLayout.tsx';
import { acceptCommonConfig, bindArea, bindChild } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { contract, createState, createRequest } from '@logic/ParentConnections.ts';
import { isObject } from '@logic/VisualConfig.ts';
import type {
  DiagnosticRecord,
  ReaderNavigationRequest,
  ReaderNavigationState,
  Result,
} from '../../ShellHost.js';
import BottomBarChapterNavigation, {
  componentId as navigationId,
  configKeys,
  partKeys,
  validateConfig,
} from './BottomBarChapterNavigation.tsx';
import BottomBarStatus, { componentId } from './BottomBarStatus.tsx';

export const areaId = 'bottomBar';
export const parentName = 'BottomBar';
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
const createPorts = () => ({
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
    contract(
      'ui.reader.navigation.output',
      (v: unknown): v is Result =>
        isObject(v) && (v.ok === true || (v.ok === false && typeof v.error === 'string')),
    ),
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
  issues: createState(
    contract(
      'native.issues',
      (v: unknown): v is DiagnosticRecord[] => Array.isArray(v) && v.every(diagnostic),
    ),
    [],
  ),
  labels: createState(
    contract(
      'screen.status.labels',
      (v: unknown): v is { ready: string; issues: string } =>
        isObject(v) && typeof v.ready === 'string' && typeof v.issues === 'string',
    ),
    { ready: '', issues: '' },
  ),
});
type Ports = ReturnType<typeof createPorts>;
const children = [
  bindChild(
    BottomBarChapterNavigation,
    validateConfig,
    { componentId: navigationId, fileName: 'BottomBarChapterNavigation.tsx', configKeys, partKeys },
    (ports: Ports, report) => ({
      state: ports.navigation.getSnapshot(),
      requestNavigation: ports.navigateChapter.request,
      report,
    }),
  ),
  bindChild(
    BottomBarStatus,
    acceptCommonConfig,
    { componentId, fileName: 'BottomBarStatus.tsx' },
    (ports: Ports) => ({ issues: ports.issues.getSnapshot(), labels: ports.labels.getSnapshot() }),
  ),
];
export default function BottomBar({ config, ports, report }: AreaProps<Ports>) {
  useSyncExternalStore(ports.issues.subscribe, ports.issues.getSnapshot);
  useSyncExternalStore(ports.labels.subscribe, ports.labels.getSnapshot);
  useSyncExternalStore(ports.navigation.subscribe, ports.navigation.getSnapshot);
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(BottomBar, children, createPorts);
