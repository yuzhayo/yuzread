import Box from '@mui/material/Box';
import { configuredSx } from '@logic/Appearance.ts';
import type { ChildProps } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
export const componentId = 'shell.title';
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
