import { contract, createRequest, createState } from './ParentConnections.ts';
import { isObject, oneOf } from './VisualConfig.ts';
import type { WindowActionResult, WindowOperation, WindowState } from '../../../ShellHost.js';

// CONFIG AND CONTRACT — reusable native window relay, without application features.
export const createWindowControlPorts = () => ({
  action: createRequest(
    contract('native.window.input', (value: unknown): value is WindowOperation =>
      oneOf(value, ['minimize', 'restoreDefault', 'toggleMaximize', 'close'] as const),
    ),
    contract(
      'native.window.output',
      (value: unknown): value is WindowActionResult =>
        isObject(value) &&
        ((value.ok === false && typeof value.error === 'string') ||
          (value.ok === true &&
            isObject(value.state) &&
            typeof value.state.maximized === 'boolean' &&
            typeof value.state.minimized === 'boolean')),
    ),
    { ok: false, error: 'Window controls are unavailable' },
  ),
  title: createState(
    contract('native.title', (value: unknown): value is string => typeof value === 'string'),
    '',
  ),
  windowState: createState(
    contract(
      'native.window.state',
      (value: unknown): value is WindowState =>
        isObject(value) &&
        typeof value.maximized === 'boolean' &&
        typeof value.minimized === 'boolean',
    ),
    { maximized: false, minimized: false },
  ),
});
