// CONFIG AND CONTRACT — plain sandbox script: type queries emit no module imports.
// The typed require adapter is restricted to Electron's known, sandbox-provided API.
const { contextBridge, ipcRenderer }: typeof import('electron') = require('electron');
type Wire = import('../ShellHost.js').InvokeChannels;
type Events = import('../ShellHost.js').EventChannels;
const preloadRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const preloadStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
const preloadCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const preloadBudget = (v: unknown): v is import('../ShellHost.js').ReaderBudget =>
  preloadRecord(v) &&
  preloadCount(v.limitBytes) &&
  preloadCount(v.residentBytes) &&
  preloadCount(v.inFlightBytes) &&
  v.limitBytes <= 4096 * 1048576 &&
  v.residentBytes + v.inFlightBytes <= v.limitBytes &&
  preloadCount(v.activeJobs) &&
  v.activeJobs <= 1 &&
  preloadCount(v.queuedJobs) &&
  v.queuedJobs <= 64;
const preloadBudgetField = (v: Record<string, unknown>) =>
  v.budget === undefined || preloadBudget(v.budget);
const preloadFailure = (value: unknown): value is import('../ShellHost.js').Failure =>
  preloadRecord(value) &&
  value.ok === false &&
  typeof value.error === 'string' &&
  (value.code === undefined || value.code === 'deferred' || value.code === 'cancelled') &&
  preloadBudgetField(value);
const preloadResult = (value: unknown): value is import('../ShellHost.js').Result =>
  preloadFailure(value) || (preloadRecord(value) && value.ok === true);
const preloadWindowState = (value: unknown): value is import('../ShellHost.js').WindowState =>
  preloadRecord(value) &&
  typeof value.maximized === 'boolean' &&
  typeof value.minimized === 'boolean';
const preloadWindowResult = (
  value: unknown,
): value is import('../ShellHost.js').WindowActionResult =>
  preloadFailure(value) ||
  (preloadRecord(value) && value.ok === true && preloadWindowState(value.state));
const preloadBootstrap = (value: unknown): value is import('../ShellHost.js').BootstrapResult =>
  preloadFailure(value) ||
  (preloadRecord(value) &&
    preloadWindowState(value.windowState) &&
    preloadStrings(value.hoveredSections) &&
    typeof value.logPath === 'string' &&
    typeof value.development === 'boolean' &&
    typeof value.qa === 'boolean' &&
    typeof value.inspectionRequested === 'boolean' &&
    'config' in value);
const preloadPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;
const preloadPage = (value: unknown): value is import('../ShellHost.js').PageMetadata =>
  preloadRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.index === 'number' &&
  Number.isInteger(value.index) &&
  value.index >= 0 &&
  typeof value.name === 'string' &&
  preloadPositive(value.width) &&
  preloadPositive(value.height) &&
  preloadPositive(value.targetWidth) &&
  preloadPositive(value.targetHeight);
const preloadChapter = (chapter: unknown): chapter is import('../ShellHost.js').Chapter =>
  preloadRecord(chapter) &&
  typeof chapter.id === 'string' &&
  typeof chapter.catalogId === 'string' &&
  typeof chapter.entryId === 'string' &&
  typeof chapter.sourceRevision === 'string' &&
  typeof chapter.name === 'string' &&
  typeof chapter.estimatedBytes === 'number' &&
  Array.isArray(chapter.pages) &&
  chapter.pages.every(preloadPage);
const preloadCatalog = (value: unknown): value is import('../ShellHost.js').ReaderCatalog =>
  preloadRecord(value) &&
  typeof value.id === 'string' &&
  Array.isArray(value.chapters) &&
  value.chapters.length > 0 &&
  value.chapters.length <= 10000 &&
  value.chapters.every(
    (entry: unknown) =>
      preloadRecord(entry) && typeof entry.id === 'string' && typeof entry.name === 'string',
  );
const preloadChapterResult = (
  value: unknown,
): value is import('../ShellHost.js').ReaderChapterResult =>
  preloadFailure(value) ||
  (preloadRecord(value) &&
    value.ok === true &&
    preloadChapter(value.chapter) &&
    preloadBudgetField(value));
const preloadOpenResult = (value: unknown): value is import('../ShellHost.js').ReaderOpenResult => {
  if (preloadFailure(value)) return true;
  if (!preloadRecord(value) || value.ok !== true || !preloadBudgetField(value)) return false;
  if (value.canceled === true) return true;
  const chapter = value.chapter,
    catalog = value.catalog;
  return (
    preloadChapter(chapter) &&
    preloadCatalog(catalog) &&
    chapter.catalogId === catalog.id &&
    catalog.chapters.some((entry) => entry.id === chapter.entryId)
  );
};
const preloadPrepareResult = (
  value: unknown,
): value is import('../ShellHost.js').ReaderPrepareResult =>
  preloadFailure(value) ||
  (preloadRecord(value) &&
    value.ok === true &&
    preloadBudgetField(value) &&
    typeof value.url === 'string' &&
    typeof value.id === 'string' &&
    typeof value.pageId === 'string' &&
    typeof value.sourceRevision === 'string' &&
    typeof value.index === 'number' &&
    Number.isInteger(value.index) &&
    value.index >= 0 &&
    preloadPositive(value.requestedWidth) &&
    preloadPositive(value.width) &&
    preloadPositive(value.height) &&
    (value.tiles === undefined ||
      (Array.isArray(value.tiles) &&
        typeof value.catalogId === 'string' &&
        typeof value.entryId === 'string' &&
        value.tiles.length > 0 &&
        value.tiles.length <= 10000 &&
        value.tiles.every(
          (tile: unknown) =>
            preloadRecord(tile) &&
            typeof tile.index === 'number' &&
            Number.isSafeInteger(tile.index) &&
            tile.index >= 0 &&
            typeof tile.left === 'number' &&
            Number.isSafeInteger(tile.left) &&
            tile.left >= 0 &&
            typeof tile.top === 'number' &&
            Number.isSafeInteger(tile.top) &&
            tile.top >= 0 &&
            preloadPositive(tile.width) &&
            tile.width <= 1024 &&
            preloadPositive(tile.height) &&
            tile.height <= 1024 &&
            preloadPositive(tile.encodedWidth) &&
            tile.encodedWidth <= 1026 &&
            preloadPositive(tile.encodedHeight) &&
            tile.encodedHeight <= 1026 &&
            (tile.offsetX === 0 || tile.offsetX === 1) &&
            (tile.offsetY === 0 || tile.offsetY === 1) &&
            preloadPositive(tile.bytes) &&
            typeof tile.url === 'string',
        ))));

// LOGIC — bind each channel's arguments and decoded result to the same declaration.
async function preloadInvoke<C extends keyof Wire>(
  channel: C,
  args: Wire[C]['args'],
  accept: (value: unknown) => value is Wire[C]['result'],
): Promise<Wire[C]['result']> {
  const result: unknown = await ipcRenderer.invoke(channel, ...args);
  if (!accept(result)) throw new TypeError(`Invalid native reply: ${channel}`);
  return result;
}
function preloadSubscribe<C extends keyof Events>(
  channel: C,
  callback: (state: Events[C]) => void,
  accept: (value: unknown) => value is Events[C],
): () => void {
  if (typeof callback !== 'function') throw new TypeError('Expected a callback');
  const listener = (_event: import('electron').IpcRendererEvent, state: unknown) => {
    if (accept(state)) callback(state);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

// LOGIC — named capabilities only; no Node, raw IPC, native object or file access.
const shellHost = {
  bootstrap: () => preloadInvoke('shell:bootstrap', [], preloadBootstrap),
  windowAction: (operation) =>
    preloadInvoke('shell:window-action', [operation], preloadWindowResult),
  diagnostics: (records) => preloadInvoke('shell:diagnostics', [records], preloadResult),
  startupError: (message) => preloadInvoke('shell:startup-error', [message], preloadResult),
  onWindowState: (callback) => preloadSubscribe('shell:window-state', callback, preloadWindowState),
  onSectionHover: (callback) => preloadSubscribe('shell:section-hover', callback, preloadStrings),
  reader: {
    open: (options) => preloadInvoke('reader:open', [options], preloadOpenResult),
    chapter: (catalogId, entryId, options, priority = 'background') =>
      preloadInvoke(
        'reader:chapter',
        [catalogId, entryId, options, priority],
        preloadChapterResult,
      ),
    prepare: (id, index, decodeWidth, priority = 'visible') =>
      preloadInvoke('reader:prepare', [id, index, decodeWidth, priority], preloadPrepareResult),
    release: (id) => preloadInvoke('reader:release', [id], preloadResult),
    diagnostics: (events) => preloadInvoke('reader:diagnostics', [events], preloadResult),
    reserveRender: (owner, bytes, limit) =>
      preloadInvoke('reader:render-reserve', [owner, bytes, limit], preloadResult),
  },
} satisfies import('../ShellHost.js').ShellHost;
contextBridge.exposeInMainWorld('shellHost', shellHost);
