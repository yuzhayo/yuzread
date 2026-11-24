import ActionButton, { hasActionIcon } from '@ui/ActionButton.tsx';
import type { ActionIcon } from '@ui/ActionButton.tsx';
import { errorText, oneOf } from '@logic/VisualConfig.ts';
import { defineChild } from '@logic/AreaDiscovery.ts';
import type { ChildProps, ConfigReport } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';
import { hasRequestPort, hasStatePort } from '@logic/ParentConnections.ts';
import type { RequestPort, StatePort } from '@logic/ParentConnections.ts';
import type { WindowActionResult, WindowOperation, WindowState } from '../../../ShellHost.js';

// CONFIG AND CONTRACT — default-size owns its action choice, label and icon validation.
export const componentId = 'window.defaultSize';
export const configKeys = ['icon', 'action', 'restoreLabel', 'restoredIcon'];
export interface WindowsAreaDefaultConfig extends ResolvedConfig {
  icon: ActionIcon;
  action: WindowOperation;
  restoreLabel: string;
  restoredIcon: ActionIcon;
}
export interface WindowsAreaDefaultInput {
  windowState: WindowState;
  requestAction(operation: WindowOperation): Promise<WindowActionResult>;
  report(issue: DiagnosticIssue): void;
}
export function validateConfig(
  config: ResolvedConfig,
  report: ConfigReport,
): config is WindowsAreaDefaultConfig {
  const valid =
    hasActionIcon(config.icon) &&
    hasActionIcon(config.restoredIcon) &&
    typeof config.restoreLabel === 'string' &&
    Boolean(config.restoreLabel.trim()) &&
    oneOf(config.action, ['minimize', 'restoreDefault', 'toggleMaximize', 'close'] as const);
  if (!valid) report('action', 'registered icons, window action and restore label', config);
  return valid;
}

// CHILD REGISTRATION — default-size control shares only native action/state ports.
interface WindowsAreaDefaultPorts {
  action: RequestPort<WindowOperation, WindowActionResult>;
  windowState: StatePort<WindowState>;
}
const acceptsParentPorts = (value: unknown): value is WindowsAreaDefaultPorts =>
  hasRequestPort(value, 'action', 'native.window.input', 'native.window.output') &&
  hasStatePort(value, 'windowState', 'native.window.state');
export const child = defineChild(
  'WindowsArea',
  WindowsAreaBtnDefaultSize,
  validateConfig,
  { componentId, configKeys },
  acceptsParentPorts,
  (ports, report) => ({
    windowState: ports.windowState.getSnapshot(),
    requestAction: ports.action.request,
    report,
  }),
);

// UI AND LOCAL EVENTS — invoke the configured sizing action through the parent.
export default function WindowsAreaBtnDefaultSize({
  config,
  input,
}: ChildProps<WindowsAreaDefaultConfig, WindowsAreaDefaultInput>) {
  const restored = config.action === 'toggleMaximize' && input.windowState.maximized;
  const activate = async () => {
    try {
      const result = await input.requestAction(config.action);
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      input.report({
        code: 'WINDOW_ACTION_FAILED',
        expected: 'successful native operation',
        actual: errorText(error),
      });
    }
  };
  return (
    <ActionButton
      config={config}
      label={restored ? config.restoreLabel : config.label}
      icon={restored ? config.restoredIcon : config.icon}
      onClick={activate}
    />
  );
}
