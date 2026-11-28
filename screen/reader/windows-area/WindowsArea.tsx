import { useSyncExternalStore } from 'react';
import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { createWindowsAreaPorts } from './WindowsAreaContract.ts';
import type { WindowsAreaPorts } from './WindowsAreaContract.ts';

// CONFIG AND CONTRACT — stable area identity; relay contracts live in the named contract file.
export const areaId = 'windowsBar';
export const parentName = 'WindowsArea';

// UI AND PLACEMENT — discovered children render in configured slots; no child policy here.
export default function WindowsArea({ config, ports, report }: AreaProps<WindowsAreaPorts>) {
  useSyncExternalStore(ports.readerState.subscribe, ports.readerState.getSnapshot);
  useSyncExternalStore(ports.windowState.subscribe, ports.windowState.getSnapshot);
  useSyncExternalStore(ports.title.subscribe, ports.title.getSnapshot);
  useSyncExternalStore(ports.scrollSpeed.subscribe, ports.scrollSpeed.getSnapshot);
  useSyncExternalStore(
    ports.smoothScrollDuration.subscribe,
    ports.smoothScrollDuration.getSnapshot,
  );
  useSyncExternalStore(ports.scrollAnywhere.subscribe, ports.scrollAnywhere.getSnapshot);
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(WindowsArea, createWindowsAreaPorts);
