import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';

// CONFIG AND CONTRACT — retained disabled area with no ports or feature policy.
export const areaId = 'actionBar';
export const parentName = 'ActionBar';

// UI AND PLACEMENT — future self-registering children would use configured slots.
export default function ActionBar({ config, ports, report }: AreaProps<Record<string, never>>) {
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(ActionBar, () => ({}));
