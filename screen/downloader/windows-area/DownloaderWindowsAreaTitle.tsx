import Box from '@mui/material/Box';
import { configuredSx } from '@logic/Appearance.ts';
import { acceptCommonConfig, defineChild } from '@logic/AreaDiscovery.ts';
import type { ChildProps } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import { hasStatePort } from '@logic/ParentConnections.ts';
import type { StatePort } from '@logic/ParentConnections.ts';

// CONFIG AND CONTRACT — native title is delivered through the Downloader parent.
export const componentId = 'downloader.title';
const accepts = (value: unknown): value is { title: StatePort<string> } =>
  hasStatePort(value, 'title', 'native.title');
export const child = defineChild(
  'DownloaderWindowsArea',
  DownloaderWindowsAreaTitle,
  acceptCommonConfig,
  { componentId },
  accepts,
  (ports) => ({ title: ports.title.getSnapshot() }),
);

// UI AND LOCAL EVENTS — configured title presentation, not application state.
export default function DownloaderWindowsAreaTitle({
  config,
  input,
}: ChildProps<ResolvedConfig, { title: string }>) {
  return (
    <Box component="span" className="fill" aria-label={config.label} sx={configuredSx(config)}>
      {input.title}
    </Box>
  );
}
