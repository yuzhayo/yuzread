import { contract, createRequest, createState } from '@logic/ParentConnections.ts';
import { isObject, oneOf } from '@logic/VisualConfig.ts';
import type { ActionSource } from '@logic/Diagnostics.ts';
import type {
  Failure,
  ReaderNumberSettingChange,
  ReaderPickerSettings,
  Result,
  WindowActionResult,
  WindowOperation,
  WindowState,
} from '../../../ShellHost.js';

// CONFIG AND CONTRACT — WindowsArea's public relay ports; no control implementation.
export type OpenIntent = ActionSource & { picker?: ReaderPickerSettings };
export interface ReaderInfo {
  readonly phase: '' | 'scanning' | 'preparing';
  readonly total: number;
}
export type OpenOutcome =
  | { ok: true; canceled: true }
  | { ok: true; chapter: { id: string; pages: number } }
  | Failure
  | undefined;
const settingChange = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is ReaderNumberSettingChange =>
  isObject(value) &&
  typeof value.value === 'number' &&
  Number.isFinite(value.value) &&
  value.value >= minimum &&
  value.value <= maximum &&
  (value.reset === undefined || typeof value.reset === 'boolean');

export const createWindowsAreaPorts = () => ({
  setScrollSpeed: createRequest(
    contract('ui.reader.speed.input', (v: unknown): v is ReaderNumberSettingChange =>
      settingChange(v, 1, 100),
    ),
    contract(
      'ui.reader.speed.output',
      (v: unknown): v is Result =>
        isObject(v) && (v.ok === true || (v.ok === false && typeof v.error === 'string')),
    ),
    { ok: false, error: 'Reader speed is unavailable' },
  ),
  scrollSpeed: createState(
    contract(
      'ui.reader.speed.state',
      (v: unknown): v is number | null =>
        v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 100),
    ),
    null,
  ),
  setSmoothScrollDuration: createRequest(
    contract('ui.reader.smooth-duration.input', (v: unknown): v is ReaderNumberSettingChange =>
      settingChange(v, 100, 2000),
    ),
    contract(
      'ui.reader.smooth-duration.output',
      (v: unknown): v is Result =>
        isObject(v) && (v.ok === true || (v.ok === false && typeof v.error === 'string')),
    ),
    { ok: false, error: 'Reader smooth-scroll duration is unavailable' },
  ),
  smoothScrollDuration: createState(
    contract(
      'ui.reader.smooth-duration.state',
      (v: unknown): v is number | null =>
        v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 2000),
    ),
    null,
  ),
  open: createRequest(
    contract(
      'ui.open.input.v2',
      (v: unknown): v is OpenIntent =>
        isObject(v) &&
        (v.picker === undefined ||
          (isObject(v.picker) &&
            (v.picker.folderPath === undefined ||
              (typeof v.picker.folderPath === 'string' &&
                v.picker.folderPath.length <= 4096 &&
                !v.picker.folderPath.includes('\0'))) &&
            (v.picker.rememberFolder === undefined ||
              typeof v.picker.rememberFolder === 'boolean'))),
    ),
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

export type WindowsAreaPorts = ReturnType<typeof createWindowsAreaPorts>;
