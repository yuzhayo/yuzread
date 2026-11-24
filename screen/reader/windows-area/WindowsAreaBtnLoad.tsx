import ActionButton from '@ui/ActionButton.tsx';
import { errorText, isObject } from '@logic/VisualConfig.ts';
import { defineChild } from '@logic/AreaDiscovery.ts';
import type { ChildProps, ConfigReport } from '@logic/AreaDiscovery.ts';
import { hasRequestPort, hasStatePort } from '@logic/ParentConnections.ts';
import type { RequestPort, StatePort } from '@logic/ParentConnections.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';
import type { OpenIntent, OpenOutcome, ReaderInfo } from './WindowsAreaContract.ts';

// CONFIG AND CONTRACT — leaf owns its label/busy behavior and Open intent.
export const componentId = 'reader.open';
export const configKeys = ['replaceLabel', 'icons', 'folderPath', 'rememberFolder'];
export interface WindowsAreaLoadConfig extends ResolvedConfig {
  replaceLabel: string;
  icons: { open: string; busy: string };
  folderPath?: string;
  rememberFolder?: boolean;
}
export interface WindowsAreaLoadInput {
  reader: ReaderInfo;
  requestOpen(source: OpenIntent): Promise<OpenOutcome>;
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
    config.folderPath !== undefined &&
    (typeof config.folderPath !== 'string' ||
      config.folderPath.length > 4096 ||
      config.folderPath.includes('\0'))
  )
    reject(
      'folderPath',
      'folder path string, or empty to use the remembered folder',
      config.folderPath,
    );
  if (config.rememberFolder !== undefined && typeof config.rememberFolder !== 'boolean')
    reject('rememberFolder', 'boolean, default true', config.rememberFolder);
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

// CHILD REGISTRATION — declare only the two WindowsArea capabilities Load consumes.
interface WindowsAreaLoadPorts {
  open: RequestPort<OpenIntent, OpenOutcome>;
  readerState: StatePort<ReaderInfo>;
}
const acceptsParentPorts = (value: unknown): value is WindowsAreaLoadPorts =>
  hasRequestPort(value, 'open', 'ui.open.input.v2', 'ui.open.output') &&
  hasStatePort(value, 'readerState', 'ui.reader.state');
export const child = defineChild(
  'WindowsArea',
  WindowsAreaBtnLoad,
  validateConfig,
  { componentId, configKeys },
  acceptsParentPorts,
  (ports, report) => ({
    reader: ports.readerState.getSnapshot(),
    requestOpen: ports.open.request,
    report,
  }),
);

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
        picker: {
          folderPath: config.folderPath?.trim() ?? '',
          rememberFolder: config.rememberFolder !== false,
        },
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
