import { useSyncExternalStore } from 'react';
import { AreaChildren } from '@ui/AreaLayout.tsx';
import { acceptCommonConfig, bindArea, bindChild } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { contract, createState } from '@logic/ParentConnections.ts';
import { isObject } from '@logic/VisualConfig.ts';
import type { DiagnosticRecord } from '../../ShellHost.js';
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
    BottomBarStatus,
    acceptCommonConfig,
    { componentId, fileName: 'BottomBarStatus.tsx' },
    (ports: Ports) => ({ issues: ports.issues.getSnapshot(), labels: ports.labels.getSnapshot() }),
  ),
];
export default function BottomBar({ config, ports, report }: AreaProps<Ports>) {
  useSyncExternalStore(ports.issues.subscribe, ports.issues.getSnapshot);
  useSyncExternalStore(ports.labels.subscribe, ports.labels.getSnapshot);
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(BottomBar, children, createPorts);
