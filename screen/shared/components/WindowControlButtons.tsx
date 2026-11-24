import ActionButton, { hasActionIcon } from './ActionButton.tsx';
import ConfiguredRow, { validateConfiguredRow } from './ConfiguredRow.tsx';
import { isObject } from '../logic/VisualConfig.ts';
import type { ResolvedConfig } from '../logic/ConfigValidation.ts';
import { hasParts } from '../logic/ConfigValidation.ts';
import type { RowConfig } from './ConfiguredRow.tsx';
import type { ActionIcon } from './ActionButton.tsx';
import type { WindowOperation } from '../../../ShellHost.js';

// CONFIG AND CONTRACT — shared presentation/validation; native actions arrive from the owner.
export const windowControlNames = ['minimize', 'defaultSize', 'close'] as const;
export type WindowControlName = (typeof windowControlNames)[number];
export interface WindowControlConfig extends RowConfig<WindowControlName> {
  labels: Record<WindowControlName, string>;
  icons: Record<WindowControlName, ActionIcon>;
}
export function isWindowControlConfig(config: ResolvedConfig): config is WindowControlConfig {
  const labels = config.labels,
    icons = config.icons;
  return (
    isObject(labels) &&
    isObject(icons) &&
    Object.keys(labels).length === windowControlNames.length &&
    Object.keys(icons).length === windowControlNames.length &&
    windowControlNames.every(
      (name) =>
        typeof labels[name] === 'string' &&
        Boolean(labels[name].trim()) &&
        hasActionIcon(icons[name]),
    ) &&
    hasParts(config, windowControlNames) &&
    validateConfiguredRow(config, windowControlNames, () => {}) &&
    Object.keys(config.parts).length === windowControlNames.length
  );
}

// UI AND LOCAL EVENTS — render configured slots and forward named native commands.
export default function WindowControlButtons({
  config,
  operations,
  onAction,
}: {
  config: WindowControlConfig;
  operations: Record<WindowControlName, WindowOperation>;
  onAction(operation: WindowOperation): void;
}) {
  return (
    <ConfiguredRow
      config={config}
      renderPart={(name, part) => (
        <ActionButton
          config={part}
          label={config.labels[name]}
          icon={config.icons[name]}
          onClick={() => onAction(operations[name])}
        />
      )}
    />
  );
}
