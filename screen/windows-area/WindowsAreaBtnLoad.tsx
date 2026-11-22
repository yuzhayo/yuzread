import ActionButton from '@ui/ActionButton.tsx';
import { errorText, isObject } from '@logic/VisualConfig.ts';
import type { ChildProps, ConfigReport } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import type { ActionSource, DiagnosticIssue } from '@logic/Diagnostics.ts';
import type { Failure } from '../../ShellHost.js';

// CONFIG AND CONTRACT — leaf owns its label/busy behavior and Open intent.
export const componentId = 'reader.open';
export const configKeys = ['replaceLabel', 'icons'];
export interface WindowsAreaLoadConfig extends ResolvedConfig {
  replaceLabel: string;
  icons: { open: string; busy: string };
}
export interface ReaderInfo {
  readonly phase: '' | 'scanning' | 'preparing';
  readonly total: number;
}
export type OpenOutcome =
  | { ok: true; canceled: true }
  | { ok: true; chapter: { id: string; pages: number } }
  | Failure
  | undefined;
export interface WindowsAreaLoadInput {
  reader: ReaderInfo;
  requestOpen(source: ActionSource): Promise<OpenOutcome>;
  report(issue: DiagnosticIssue): void;
}
export function validateConfig(
  config: ResolvedConfig,
  report: ConfigReport,
): config is WindowsAreaLoadConfig {
  let valid = true;
  const reject: ConfigReport = (key, expected, actual) => {
    valid = false;
    report(key, expected, actual);
  };
  if (typeof config.replaceLabel !== 'string' || !config.replaceLabel.trim())
    reject('replaceLabel', 'nonempty label', config.replaceLabel);
  if (
    !isObject(config.icons) ||
    typeof config.icons.open !== 'string' ||
    !config.icons.open.trim() ||
    typeof config.icons.busy !== 'string' ||
    !config.icons.busy.trim()
  )
    reject('icons', 'open/busy icons', config.icons);
  return valid;
}
// UI AND LOCAL EVENTS — no sibling/bridge/session reference.
export default function WindowsAreaBtnLoad({
  config,
  input,
}: ChildProps<WindowsAreaLoadConfig, WindowsAreaLoadInput>) {
  const busy = Boolean(input.reader.phase),
    label = input.reader.total ? config.replaceLabel : config.label;
  const activate = async () => {
    try {
      const result = await input.requestOpen({
        componentId: config.componentId,
        instanceId: config.id,
        parentId: config.parentId,
        filePath: config.filePath,
        configPath: config.configPath,
      });
      if (result && !result.ok)
        input.report({
          code: 'READER_UNAVAILABLE',
          expected: 'available reader',
          actual: result.error,
        });
    } catch (error) {
      input.report({
        code: 'READER_OPEN_FAILED',
        expected: 'successful reader request',
        actual: errorText(error),
      });
    }
  };
  return (
    <ActionButton
      config={config}
      label={label}
      icon={busy ? config.icons.busy : config.icons.open}
      onClick={activate}
      disabled={busy}
    />
  );
}
