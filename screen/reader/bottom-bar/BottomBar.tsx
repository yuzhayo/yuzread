import { useSyncExternalStore } from 'react';
import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { createBottomBarPorts } from './BottomBarContract.ts';
import type { BottomBarPorts } from './BottomBarContract.ts';

// CONFIG AND CONTRACT — stable bottom-bar identity; relay codecs live in its contract file.
export const areaId = 'bottomBar';
export const parentName = 'BottomBar';

// UI AND PLACEMENT — subscriptions rerender discovered children in configured slots.
export default function BottomBar({ config, ports, report }: AreaProps<BottomBarPorts>) {
  useSyncExternalStore(ports.issues.subscribe, ports.issues.getSnapshot);
  useSyncExternalStore(ports.labels.subscribe, ports.labels.getSnapshot);
  useSyncExternalStore(ports.navigation.subscribe, ports.navigation.getSnapshot);
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}

export const bind = bindArea(BottomBar, createBottomBarPorts);
