import ActionButton, { hasActionIcon } from '@ui/ActionButton.tsx';
import type { ActionIcon } from '@ui/ActionButton.tsx';
import { errorText, oneOf } from '@logic/VisualConfig.ts';
import type { ChildProps, ConfigReport } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';
import type { WindowActionResult, WindowOperation, WindowState } from '../../ShellHost.js';

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
