import { useSyncExternalStore } from 'react';
import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { createWindowControlPorts } from '@logic/WindowControlPorts.ts';

// CONFIG AND CONTRACT — Library owns this parent; only native window connections are shared.
export const areaId = 'libraryWindowsBar';
export const parentName = 'LibraryWindowsArea';

// CONNECTIONS AND PLACEMENT — discovered local children, never Reader implementations.
export default function LibraryWindowsArea({
  config,
  ports,
  report,
}: AreaProps<ReturnType<typeof createWindowControlPorts>>) {
  useSyncExternalStore(ports.title.subscribe, ports.title.getSnapshot);
  useSyncExternalStore(ports.windowState.subscribe, ports.windowState.getSnapshot);
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(LibraryWindowsArea, createWindowControlPorts);
