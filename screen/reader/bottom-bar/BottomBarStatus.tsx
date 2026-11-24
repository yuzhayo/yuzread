import Box from '@mui/material/Box';
import { configuredSx } from '@logic/Appearance.ts';
import { acceptCommonConfig, defineChild } from '@logic/AreaDiscovery.ts';
import type { ChildProps } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import { hasStatePort } from '@logic/ParentConnections.ts';
import type { StatePort } from '@logic/ParentConnections.ts';
import type { DiagnosticRecord } from '../../../ShellHost.js';

// CONFIG AND CONTRACT — retained disabled status child.
export const componentId = 'shell.status';
export interface BottomBarStatusInput {
  issues: DiagnosticRecord[];
  labels: { ready: string; issues: string };
}

// CHILD REGISTRATION — status receives only diagnostics and display labels.
interface BottomBarStatusPorts {
  issues: StatePort<DiagnosticRecord[]>;
  labels: StatePort<{ ready: string; issues: string }>;
}
const acceptsParentPorts = (value: unknown): value is BottomBarStatusPorts =>
  hasStatePort(value, 'issues', 'native.issues') &&
  hasStatePort(value, 'labels', 'screen.status.labels');
export const child = defineChild(
  'BottomBar',
  BottomBarStatus,
  acceptCommonConfig,
  { componentId },
  acceptsParentPorts,
  (ports) => ({
    issues: ports.issues.getSnapshot(),
    labels: ports.labels.getSnapshot(),
  }),
);

// UI — present parent-provided status without owning diagnostics collection.
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
