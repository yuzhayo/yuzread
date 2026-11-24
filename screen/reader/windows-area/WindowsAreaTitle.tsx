import Box from '@mui/material/Box';
import { configuredSx } from '@logic/Appearance.ts';
import { acceptCommonConfig, defineChild } from '@logic/AreaDiscovery.ts';
import type { ChildProps } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import { hasStatePort } from '@logic/ParentConnections.ts';
import type { StatePort } from '@logic/ParentConnections.ts';

// CONFIG AND CONTRACT — retained disabled title child.
export const componentId = 'shell.title';
interface WindowsAreaTitlePorts {
  title: StatePort<string>;
}
const acceptsParentPorts = (value: unknown): value is WindowsAreaTitlePorts =>
  hasStatePort(value, 'title', 'native.title');
export const child = defineChild(
  'WindowsArea',
  WindowsAreaTitle,
  acceptCommonConfig,
  { componentId },
  acceptsParentPorts,
  (ports) => ({ title: ports.title.getSnapshot() }),
);

// UI — title presentation only; native title ownership remains outside the child.
export default function WindowsAreaTitle({
  config,
  input,
}: ChildProps<ResolvedConfig, { title: string }>) {
  return (
    <Box
      component="span"
      className="fill"
      aria-label={config.label}
      title={input.title}
      sx={configuredSx(config)}
    >
      {input.title}
    </Box>
  );
}
