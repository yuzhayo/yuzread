import Box from '@mui/material/Box';
import { configuredSx } from '@logic/Appearance.ts';
import type { ChildProps } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import type { DiagnosticRecord } from '../../ShellHost.js';
export const componentId = 'shell.status';
export interface BottomBarStatusInput {
  issues: DiagnosticRecord[];
  labels: { ready: string; issues: string };
}
export default function BottomBarStatus({
  config,
  input,
}: ChildProps<ResolvedConfig, BottomBarStatusInput>) {
  const status = input.issues.length
    ? `${input.labels.issues} (${input.issues.length})`
    : input.labels.ready;
  return (
    <Box
      component="output"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="fill"
      aria-label={config.label}
      title={input.issues.map((issue) => issue.message).join('\n')}
      sx={configuredSx(config, input.issues.length ? 'error' : undefined)}
    >
      {status}
    </Box>
  );
}
