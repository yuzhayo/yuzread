import { contract, createRequest, createState } from '@logic/ParentConnections.ts';
import { isObject } from '@logic/VisualConfig.ts';
import type {
  DiagnosticRecord,
  ReaderNavigationRequest,
  ReaderNavigationState,
  Result,
} from '../../../ShellHost.js';

// CONFIG AND CONTRACT — BottomBar's relay ports; no navigation or status UI policy.
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

export const createBottomBarPorts = () => ({
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

export type BottomBarPorts = ReturnType<typeof createBottomBarPorts>;
