import { useSyncExternalStore } from 'react';
import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { createWindowControlPorts } from '@logic/WindowControlPorts.ts';

// CONFIG AND CONTRACT — Downloader owns this parent; only native window connections are shared.
export const areaId = 'downloaderWindowsBar';
export const parentName = 'DownloaderWindowsArea';

// CONNECTIONS AND PLACEMENT — discovered local children, never Reader implementations.
export default function DownloaderWindowsArea({
  config,
  ports,
  report,
}: AreaProps<ReturnType<typeof createWindowControlPorts>>) {
  useSyncExternalStore(ports.title.subscribe, ports.title.getSnapshot);
  useSyncExternalStore(ports.windowState.subscribe, ports.windowState.getSnapshot);
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(DownloaderWindowsArea, createWindowControlPorts);
