import WindowControlButtons, { isWindowControlConfig } from '@ui/WindowControlButtons.tsx';
import type { WindowControlConfig } from '@ui/WindowControlButtons.tsx';
import { defineChild } from '@logic/AreaDiscovery.ts';
import type { ChildProps, ConfigReport, IssueReport } from '@logic/AreaDiscovery.ts';
import { hasRequestPort } from '@logic/ParentConnections.ts';
import type { RequestPort } from '@logic/ParentConnections.ts';
import { errorText } from '@logic/VisualConfig.ts';
import type { WindowOperation, WindowActionResult } from '../../../ShellHost.js';

// CONFIG AND CONTRACT — Library's three native window controls; no catalog behavior.
export const componentId = 'library.windowControls';
export const configKeys = ['order', 'gap', 'labels', 'icons'];
export const partKeys = ['minimize', 'defaultSize', 'close'];
function validate(
  config: Parameters<typeof isWindowControlConfig>[0],
  report: ConfigReport,
): config is WindowControlConfig {
  const valid = isWindowControlConfig(config);
  if (!valid) report('controls', 'configured labels, icons and window-control row', config);
  return valid;
}
interface LibraryWindowsAreaControlPorts {
  action: RequestPort<WindowOperation, WindowActionResult>;
}
interface LibraryWindowsAreaControlInput {
  requestAction(operation: WindowOperation): Promise<WindowActionResult>;
  report: IssueReport;
}
const accepts = (value: unknown): value is LibraryWindowsAreaControlPorts =>
  hasRequestPort(value, 'action', 'native.window.input', 'native.window.output');
export const child = defineChild(
  'LibraryWindowsArea',
  LibraryWindowsAreaControls,
  validate,
  { componentId, configKeys, partKeys },
  accepts,
  (ports, report) => ({ requestAction: ports.action.request, report }),
);

// UI AND LOCAL EVENTS — this owner chooses the operations; native execution is relayed.
export default function LibraryWindowsAreaControls({
  config,
  input,
}: ChildProps<WindowControlConfig, LibraryWindowsAreaControlInput>) {
  const activate = async (operation: WindowOperation) => {
    try {
      const result = await input.requestAction(operation);
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      input.report({
        code: 'WINDOW_ACTION_FAILED',
        expected: 'successful native window operation',
        actual: errorText(error),
      });
    }
  };
  return (
    <WindowControlButtons
      config={config}
      operations={{ minimize: 'minimize', defaultSize: 'restoreDefault', close: 'close' }}
      onAction={(operation) => {
        void activate(operation);
      }}
    />
  );
}
