import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';

// CONFIG AND CONTRACT — empty Downloader workspace, ready for local feature children.
export const areaId = 'downloaderBody';
export const parentName = 'DownloaderBody';

// DISCOVERY AND PLACEMENT — the workspace composes children; it does not start downloads.
export default function DownloaderBody({ config, ports, report }: AreaProps<Record<never, never>>) {
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(DownloaderBody, () => ({}));
