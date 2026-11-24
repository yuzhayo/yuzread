import { useSyncExternalStore } from 'react';
import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { createBodyPorts } from './BodyContract.ts';
import type { BodyPorts } from './BodyContract.ts';

// CONFIG AND CONTRACT — stable body identity; relay codecs live in BodyContract.
export const areaId = 'body';
export const parentName = 'Body';

// UI AND PLACEMENT — discovered children render in configured body slots.
export default function Body({ config, ports, report }: AreaProps<BodyPorts>) {
  useSyncExternalStore(ports.readerPreferences.subscribe, ports.readerPreferences.getSnapshot);
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}

export const bind = bindArea(Body, createBodyPorts);
