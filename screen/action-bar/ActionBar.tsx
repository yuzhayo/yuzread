import { AreaChildren } from '@ui/AreaLayout.tsx';
import { bindArea } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
export const areaId = 'actionBar';
export const parentName = 'ActionBar';
export default function ActionBar({ config, ports, report }: AreaProps<Record<string, never>>) {
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(ActionBar, [], () => ({}));
