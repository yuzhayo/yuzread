import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';

// CONFIG AND CONTRACT — empty Library workspace, ready for local feature children.
export const areaId = 'libraryBody';
export const parentName = 'LibraryBody';

// DISCOVERY AND PLACEMENT — the workspace composes children; it does not scan a catalog.
export default function LibraryBody({ config, ports, report }: AreaProps<Record<never, never>>) {
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(LibraryBody, () => ({}));
