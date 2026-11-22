import { useSyncExternalStore } from 'react';
import { AreaChildren } from '@ui/AreaLayout.tsx';
import { acceptCommonConfig, bindArea, bindChild } from '@logic/AreaDiscovery.ts';
import type { AreaProps } from '@logic/AreaDiscovery.ts';
import { contract, createRequest, createState } from '@logic/ParentConnections.ts';
import { isObject, oneOf } from '@logic/VisualConfig.ts';
import type { ActionSource } from '@logic/Diagnostics.ts';
import type { WindowActionResult, WindowOperation, WindowState } from '../../ShellHost.js';
import WindowsAreaBtnLoad, {
  componentId as loadId,
  configKeys as loadKeys,
  validateConfig as validateLoad,
} from './WindowsAreaBtnLoad.tsx';
import type { OpenOutcome, ReaderInfo } from './WindowsAreaBtnLoad.tsx';
import WindowsAreaBtnClose, {
  componentId as closeId,
  configKeys as closeKeys,
  validateConfig as validateClose,
} from './WindowsAreaBtnClose.tsx';
import WindowsAreaBtnDefaultSize, {
  componentId as defaultId,
  configKeys as defaultKeys,
  validateConfig as validateDefault,
} from './WindowsAreaBtnDefaultSize.tsx';
import WindowsAreaTitle, { componentId as titleId } from './WindowsAreaTitle.tsx';

// CONFIG AND CONTRACT — parent's contracts and direct child assembly, no button algorithms.
export const areaId = 'windowsBar';
export const parentName = 'WindowsArea';
const createPorts = () => ({
  open: createRequest(
    contract('ui.open.input', (v: unknown): v is ActionSource => isObject(v)),
    contract(
      'ui.open.output',
      (v: unknown): v is OpenOutcome =>
        v === undefined ||
        (isObject(v) &&
          ((v.ok === false && typeof v.error === 'string') ||
            (v.ok === true &&
              (v.canceled === true ||
                (isObject(v.chapter) &&
                  typeof v.chapter.id === 'string' &&
                  typeof v.chapter.pages === 'number'))))),
    ),
    { ok: false, error: 'Capability is unavailable' },
  ),
  readerState: createState<ReaderInfo>(
    contract(
      'ui.reader.state',
      (v: unknown): v is ReaderInfo =>
        isObject(v) &&
        oneOf(v.phase, ['', 'scanning', 'preparing'] as const) &&
        typeof v.total === 'number',
    ),
    { phase: '', total: 0 },
  ),
  action: createRequest(
    contract('native.window.input', (v: unknown): v is WindowOperation =>
      oneOf(v, ['minimize', 'restoreDefault', 'toggleMaximize', 'close'] as const),
    ),
    contract(
      'native.window.output',
      (v: unknown): v is WindowActionResult =>
        isObject(v) &&
        ((v.ok === false && typeof v.error === 'string') ||
          (v.ok === true &&
            isObject(v.state) &&
            typeof v.state.maximized === 'boolean' &&
            typeof v.state.minimized === 'boolean')),
    ),
    { ok: false, error: 'Capability is unavailable' },
  ),
  windowState: createState(
    contract(
      'native.window.state',
      (v: unknown): v is WindowState =>
        isObject(v) && typeof v.maximized === 'boolean' && typeof v.minimized === 'boolean',
    ),
    { maximized: false, minimized: false },
  ),
  title: createState(
    contract('native.title', (v: unknown): v is string => typeof v === 'string'),
    '',
  ),
});
type Ports = ReturnType<typeof createPorts>;
const children = [
  bindChild(
    WindowsAreaBtnLoad,
    validateLoad,
    { componentId: loadId, fileName: 'WindowsAreaBtnLoad.tsx', configKeys: loadKeys },
    (ports: Ports, report) => ({
      reader: ports.readerState.getSnapshot(),
      requestOpen: ports.open.request,
      report,
    }),
  ),
  bindChild(
    WindowsAreaBtnClose,
    validateClose,
    { componentId: closeId, fileName: 'WindowsAreaBtnClose.tsx', configKeys: closeKeys },
    (ports: Ports, report) => ({
      windowState: ports.windowState.getSnapshot(),
      requestAction: ports.action.request,
      report,
    }),
  ),
  bindChild(
    WindowsAreaBtnDefaultSize,
    validateDefault,
    { componentId: defaultId, fileName: 'WindowsAreaBtnDefaultSize.tsx', configKeys: defaultKeys },
    (ports: Ports, report) => ({
      windowState: ports.windowState.getSnapshot(),
      requestAction: ports.action.request,
      report,
    }),
  ),
  bindChild(
    WindowsAreaTitle,
    acceptCommonConfig,
    { componentId: titleId, fileName: 'WindowsAreaTitle.tsx' },
    (ports: Ports) => ({ title: ports.title.getSnapshot() }),
  ),
];
export default function WindowsArea({ config, ports, report }: AreaProps<Ports>) {
  useSyncExternalStore(ports.readerState.subscribe, ports.readerState.getSnapshot);
  useSyncExternalStore(ports.windowState.subscribe, ports.windowState.getSnapshot);
  useSyncExternalStore(ports.title.subscribe, ports.title.getSnapshot);
  return <AreaChildren nodes={config.nodes} ports={ports} report={report} />;
}
export const bind = bindArea(WindowsArea, children, createPorts);
