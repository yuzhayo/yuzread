import Box from '@mui/material/Box';
import { configuredSx } from '@logic/Appearance.ts';
import { acceptCommonConfig, defineChild } from '@logic/AreaDiscovery.ts';
import type { ChildProps } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import { hasStatePort } from '@logic/ParentConnections.ts';
import type { StatePort } from '@logic/ParentConnections.ts';

// CONFIG AND CONTRACT — native title is delivered through the Library parent.
export const componentId = 'library.title';
const accepts = (value: unknown): value is { title: StatePort<string> } =>
  hasStatePort(value, 'title', 'native.title');
export const child = defineChild(
  'LibraryWindowsArea',
  LibraryWindowsAreaTitle,
  acceptCommonConfig,
  { componentId },
  accepts,
  (ports) => ({ title: ports.title.getSnapshot() }),
);

// UI AND LOCAL EVENTS — configured title presentation, not application state.
export default function LibraryWindowsAreaTitle({
  config,
  input,
}: ChildProps<ResolvedConfig, { title: string }>) {
  return (
    <Box component="span" className="fill" aria-label={config.label} sx={configuredSx(config)}>
      {input.title}
    </Box>
  );
}
