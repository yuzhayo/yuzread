// CONFIG AND CONTRACT — type-only wire/capability declarations. File handles stay in
// the renderer/preload boundary; native IPC receives only a resolved path and options.
export interface Failure {
  ok: false;
  error: string;
  code?: 'deferred' | 'cancelled';
  budget?: ReaderBudget;
}
export type ReaderWorkPriority = 'demand' | 'visible' | 'background';
export interface ReaderBudget {
  limitBytes: number;
  residentBytes: number;
  inFlightBytes: number;
  activeJobs: number;
  queuedJobs: number;
}
export type ReaderMetricValue = string | number | boolean;
export interface ReaderMetricEvent {
  kind: 'image' | 'attach' | 'frame-gap' | 'frame-summary' | 'long-task' | 'scroll-jump' | 'motion';
  clockMs: number;
  values: Record<string, ReaderMetricValue>;
}
export type Result = { ok: true } | Failure;
// Scroll Anywhere is session-only: it is never written to preferences.
export type ReaderScrollAnywhereReason = 'active' | 'off' | 'minimized' | 'not-ready' | 'failed';
export interface ReaderScrollAnywhereState {
  enabled: boolean;
  active: boolean;
  reason: ReaderScrollAnywhereReason;
  error?: string;
}
export interface ReaderExternalWheel {
  /** Browser wheel convention: positive means wheel-toward-user (scroll down). */
  delta: number;
  lines: number;
  timestamp: number;
}
export interface NumberPreferenceDefinition {
  id: string;
  kind: 'number';
  default: number;
  min: number;
  max: number;
  step: number;
}
export interface ReaderPreferenceSnapshot {
  version: 1;
  values: Record<string, number>;
}
export interface ReaderPreferenceUpdate {
  id: string;
  value: number | null;
}
export interface ReaderNumberSettingChange {
  value: number;
  reset?: boolean;
}
export interface WindowState {
  maximized: boolean;
  minimized: boolean;
}
export type WindowOperation = 'minimize' | 'restoreDefault' | 'toggleMaximize' | 'close';
export type WindowActionResult = { ok: true; state: WindowState } | Failure;
export interface PageMetadata {
  id: string;
  index: number;
  name: string;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
}
export interface ChapterManifest {
  sourceRevision: string;
  name: string;
  pages: PageMetadata[];
  estimatedBytes: number;
}
export interface Chapter extends ChapterManifest {
  id: string;
  catalogId: string;
  entryId: string;
}
export interface ReaderCatalog {
  id: string;
  chapters: { id: string; name: string }[];
}
export interface ReaderNavigationState {
  catalogId: string;
  currentId: string;
  chapters: { id: string; name: string }[];
  busy: boolean;
}
export type ReaderNavigationRequest =
  | { catalogId: string; action: 'previous' | 'next' }
  | { catalogId: string; action: 'select'; entryId: string };
export interface ReaderPickerSettings {
  folderPath?: string;
  rememberFolder?: boolean;
}
export interface ReaderOpenOptions {
  renderWidth: number;
  maxDecodeWidth: number;
  maxDecodedMB: number;
  picker?: ReaderPickerSettings;
  tileCache?: boolean;
}
export type ReaderDropRequest = [file: File, options: ReaderOpenOptions];
export type ReaderOpenResult =
  | { ok: true; canceled: true }
  | { ok: true; chapter: Chapter; catalog: ReaderCatalog; budget?: ReaderBudget }
  | Failure;
export type ReaderChapterRequest = [
  catalogId: string,
  entryId: string,
  options: ReaderOpenOptions,
  priority?: ReaderWorkPriority,
];
export type ReaderChapterResult = { ok: true; chapter: Chapter; budget?: ReaderBudget } | Failure;
export type ReaderPrepareRequest = [
  id: string,
  index: number,
  decodeWidth: number,
  priority?: ReaderWorkPriority,
];
export interface ReaderPreparedTile {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
  offsetX: number;
  offsetY: number;
  bytes: number;
  url: string;
}
export interface ReaderPreparedPage {
  ok: true;
  id: string;
  catalogId?: string;
  entryId?: string;
  index: number;
  pageId: string;
  sourceRevision: string;
  requestedWidth: number;
  width: number;
  height: number;
  url: string;
  budget?: ReaderBudget;
  tiles?: ReaderPreparedTile[];
}
export type ReaderPrepareResult = ReaderPreparedPage | Failure;
export type ReaderRenderReserveRequest = [owner: string, bytes: number, maxDecodedMB: number];
export interface DiagnosticRecord {
  code: string;
  componentId: string;
  instanceId: string;
  parentId: string;
  filePath: string;
  configPath: string;
  expected: string;
  actual: string;
  key: string;
  count: number;
  firstTimestamp: string;
  lastTimestamp: string;
  action: string;
  message: string;
}
export interface BootstrapData {
  application: {
    suiteName: string;
    version: string;
    id: string;
    processName: string;
    appId: string;
  };
  config: unknown;
  readerPreferences: ReaderPreferenceSnapshot;
  scrollAnywhere: ReaderScrollAnywhereState;
  externalOpenRevision: number;
  windowState: WindowState;
  hoveredSections: string[];
  logPath: string;
  development: boolean;
  qa: boolean;
  inspectionRequested: boolean;
}
export type BootstrapResult = BootstrapData | Failure;
export interface InvokeChannels {
  'shell:bootstrap': { args: []; result: BootstrapResult };
  'shell:window-action': { args: [operation: WindowOperation]; result: WindowActionResult };
  'shell:diagnostics': { args: [records: DiagnosticRecord[]]; result: Result };
  'shell:startup-error': { args: [message: string]; result: Result };
  'reader:open': { args: [options: ReaderOpenOptions]; result: ReaderOpenResult };
  'reader:external-open': { args: [options: ReaderOpenOptions]; result: ReaderOpenResult };
  'reader:open-file': {
    args: [filePath: string, options: ReaderOpenOptions];
    result: ReaderOpenResult;
  };
  'reader:chapter': { args: ReaderChapterRequest; result: ReaderChapterResult };
  'reader:prepare': { args: ReaderPrepareRequest; result: ReaderPrepareResult };
  'reader:release': { args: [id: string]; result: Result };
  'reader:diagnostics': { args: [events: ReaderMetricEvent[]]; result: Result };
  'reader:render-reserve': { args: ReaderRenderReserveRequest; result: Result };
  'reader:preference': { args: [update: ReaderPreferenceUpdate]; result: Result };
  'reader:scroll-anywhere': {
    args: [enabled: boolean];
    result: ReaderScrollAnywhereState | Failure;
  };
  'reader:scroll-anywhere-ready': { args: [ready: boolean]; result: Result };
}
export interface EventChannels {
  'shell:window-state': WindowState;
  'shell:section-hover': string[];
  'reader:external-open-pending': number;
  'reader:scroll-anywhere': ReaderScrollAnywhereState;
  'reader:scroll-anywhere-wheel': ReaderExternalWheel;
}
export type NativeHandlers = {
  [C in keyof InvokeChannels]: (
    ...args: InvokeChannels[C]['args']
  ) => InvokeChannels[C]['result'] | Promise<InvokeChannels[C]['result']>;
};
export interface ShellHost {
  bootstrap(): Promise<BootstrapResult>;
  windowAction(operation: WindowOperation): Promise<WindowActionResult>;
  diagnostics(records: DiagnosticRecord[]): Promise<Result>;
  startupError(message: string): Promise<Result>;
  onWindowState(callback: (state: WindowState) => void): () => void;
  onSectionHover(callback: (sections: string[]) => void): () => void;
  reader: {
    open(options: ReaderOpenOptions): Promise<ReaderOpenResult>;
    openExternal(options: ReaderOpenOptions): Promise<ReaderOpenResult>;
    onExternalOpen(callback: (revision: number) => void): () => void;
    drop(...request: ReaderDropRequest): Promise<ReaderOpenResult>;
    chapter(...request: ReaderChapterRequest): Promise<ReaderChapterResult>;
    prepare(...request: ReaderPrepareRequest): Promise<ReaderPrepareResult>;
    release(id: string): Promise<Result>;
    diagnostics(events: ReaderMetricEvent[]): Promise<Result>;
    reserveRender(...request: ReaderRenderReserveRequest): Promise<Result>;
    setPreference(update: ReaderPreferenceUpdate): Promise<Result>;
    setScrollAnywhere(enabled: boolean): Promise<ReaderScrollAnywhereState | Failure>;
    setScrollAnywhereReady(ready: boolean): Promise<Result>;
    onScrollAnywhere(callback: (state: ReaderScrollAnywhereState) => void): () => void;
    onScrollAnywhereWheel(callback: (event: ReaderExternalWheel) => void): () => void;
  };
}
