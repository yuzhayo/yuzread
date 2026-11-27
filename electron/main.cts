import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorText, isRecord, validateWindowConfig } from './WindowConfig.cjs';
import { createAppWindow, createNativeWindowActions } from './AppWindow.cjs';
import {
  discoverSuiteApplications,
  loadSuiteScreenConfiguration,
  selectSuiteApplication,
  suiteName,
} from './SuiteApplications.cjs';
import { createDiagnosticLog } from './DiagnosticLog.cjs';
import { createSectionHover } from './SectionHover.cjs';
import { registerReaderScheme, createCbzReader } from './reader/CbzArchive.cjs';
import { createReaderPreferences } from './reader/ReaderPreferences.cjs';
import { createReaderExternalOpenQueue } from './reader/ReaderExternalOpen.cjs';
import {
  assertPortableDependencies,
  detectPortableRuntime,
  portablePaths,
  preparePortablePrimaryRuntime,
} from './PortableRuntime.cjs';
import type { DiagnosticRecord, InvokeChannels, NativeHandlers, Result } from '../ShellHost.js';

// CONFIG AND CONTRACT — incoming IPC is unknown; handlers satisfy the wire map.
function diagnosticRecord(value: unknown): value is DiagnosticRecord {
  return (
    isRecord(value) &&
    [
      'code',
      'componentId',
      'instanceId',
      'parentId',
      'filePath',
      'configPath',
      'expected',
      'actual',
      'key',
      'firstTimestamp',
      'lastTimestamp',
      'action',
      'message',
    ].every((key) => typeof value[key] === 'string') &&
    typeof value.count === 'number' &&
    Number.isInteger(value.count) &&
    value.count >= 1 &&
    JSON.stringify(value).length <= 40000
  );
}
const channels = [
  'shell:bootstrap',
  'shell:window-action',
  'shell:diagnostics',
  'shell:startup-error',
  'reader:open',
  'reader:external-open',
  'reader:open-file',
  'reader:chapter',
  'reader:prepare',
  'reader:release',
  'reader:diagnostics',
  'reader:render-reserve',
  'reader:preference',
] as const satisfies readonly (keyof InvokeChannels)[];
const unavailableReader = (): { ok: false; error: string } => ({
  ok: false,
  error: 'Reader capability is unavailable in this application',
});

// LOGIC — emitted entry remains one level below the original application root.
const root = path.resolve(__dirname, '..');
const application = selectSuiteApplication(
  discoverSuiteApplications(root),
  process.execPath,
  process.argv,
);
const development = process.defaultApp === true || !app.isPackaged;
const portable = detectPortableRuntime(process.execPath, app.getVersion());
const qaRequested = process.argv.includes('--qa');
const qa = qaRequested && (development || portable !== null);
const qaProfileArgument = process.argv.find((value) => value.startsWith('--qa-profile='));
const qaProfileName = qaProfileArgument?.slice('--qa-profile='.length);
if (qa && qaProfileName && !/^[A-Za-z0-9-]{1,64}$/.test(qaProfileName))
  throw new Error('Invalid QA profile name');
if (portable && qa && !qaProfileName) throw new Error('Portable QA requires an isolated profile');
const portableStorage = portable
  ? portablePaths(portable, application.id, qa ? qaProfileName : undefined)
  : null;
const externalOpens = createReaderExternalOpenQueue(
  application.id === 'reader' ? process.argv : [],
);
if (application.id === 'reader') registerReaderScheme();
app.setName(application.processName);
if (process.platform === 'win32') app.setAppUserModelId(application.appId);
const userData =
  portableStorage?.userData ??
  path.join(
    root,
    '.runtime',
    qa
      ? `qa-profile-${qaProfileName || process.pid}${application.id === 'reader' ? '' : `-${application.id}`}`
      : path.join('dev-userdata', application.userDataFolder),
  );
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
if (portableStorage) {
  assertPortableDependencies(root);
  for (const directory of [
    portableStorage.sessionData,
    portableStorage.logs,
    portableStorage.crashDumps,
    portableStorage.temp,
  ])
    fs.mkdirSync(directory, { recursive: true });
  app.setPath('sessionData', portableStorage.sessionData);
  app.setPath('crashDumps', portableStorage.crashDumps);
  app.setPath('temp', portableStorage.temp);
  app.setAppLogsPath(portableStorage.logs);
  process.env.TEMP = portableStorage.temp;
  process.env.TMP = portableStorage.temp;
}
const ownsLock = (qa && !process.argv.includes('--qa-lock')) || app.requestSingleInstanceLock();
if (ownsLock && portableStorage) preparePortablePrimaryRuntime(portableStorage);
let window: BrowserWindow | undefined;
let log: ReturnType<typeof createDiagnosticLog> | undefined;
let reader: ReturnType<typeof createCbzReader> | undefined;
let preferences: ReturnType<typeof createReaderPreferences> | undefined;
let quitting = false;

if (!ownsLock) app.quit();
else {
  app.on('second-instance', (_event, commandLine) => {
    const previousRevision = externalOpens.revision();
    if (application.id === 'reader') externalOpens.enqueue(commandLine);
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      if (
        externalOpens.revision() !== previousRevision &&
        !window.webContents.isDestroyed() &&
        !window.webContents.isLoadingMainFrame()
      )
        window.webContents.send('reader:external-open-pending', externalOpens.revision());
    }
  });
  app
    .whenReady()
    .then(async () => {
      const screenConfig = loadSuiteScreenConfiguration(root, application);
      const nativeConfig: unknown = JSON.parse(
        fs.readFileSync(path.join(root, application.windowConfig), 'utf8'),
      );
      if (!isRecord(screenConfig)) throw new Error('Screen configuration must be an object');
      const config = { ...screenConfig, window: validateWindowConfig(nativeConfig) };
      const entry = path.join(root, 'screen-built', 'index.html');
      if (!fs.existsSync(entry))
        throw new Error('UI build is missing. Run npm run build or start.cmd.');
      const currentLog = portableStorage
        ? createDiagnosticLog(portableStorage.logs, 'shell.ndjson')
        : createDiagnosticLog(app.getPath('userData'));
      log = currentLog;
      const currentPreferences =
        application.id === 'reader'
          ? createReaderPreferences(app.getPath('userData'), screenConfig)
          : undefined;
      preferences = currentPreferences;
      const currentWindow = createAppWindow(root, config.window, application, portable === null);
      window = currentWindow;
      const archive =
        application.id === 'reader'
          ? createCbzReader(
              currentWindow,
              portableStorage?.readerCache ?? path.join(userData, 'reader-cache'),
              screenConfig,
              portableStorage
                ? {
                    stateDirectory: portableStorage.userData,
                    diagnosticDirectory: portableStorage.logs,
                  }
                : undefined,
            )
          : undefined;
      reader = archive;
      const native = createNativeWindowActions(currentWindow, config.window);
      const sectionHover = createSectionHover(currentWindow, screenConfig.areas);
      const trusted = (event: IpcMainInvokeEvent) =>
        !currentWindow.isDestroyed() &&
        event.sender === currentWindow.webContents &&
        event.senderFrame === currentWindow.webContents.mainFrame &&
        event.senderFrame?.url === pathToFileURL(entry).href;
      const handlers = {
        'shell:bootstrap': () => ({
          application: {
            suiteName,
            version: app.getVersion(),
            id: application.id,
            processName: application.processName,
            appId: application.appId,
          },
          config,
          readerPreferences: currentPreferences?.snapshot() ?? { version: 1, values: {} },
          externalOpenRevision: externalOpens.revision(),
          windowState: native.snapshot(),
          hoveredSections: sectionHover.snapshot(),
          logPath: currentLog.filePath,
          development,
          qa,
          inspectionRequested: development && process.argv.includes('--inspect-layout'),
        }),
        'shell:window-action': (operation: unknown) => native.activate(operation),
        'reader:open': (options: unknown) => archive?.open(options) ?? unavailableReader(),
        'reader:external-open': (options: unknown) => {
          const file = externalOpens.take();
          return file
            ? (archive?.open(options, file) ?? unavailableReader())
            : { ok: false, error: 'No external CBZ is pending' };
        },
        'reader:open-file': (filePath: unknown, options: unknown) =>
          typeof filePath === 'string'
            ? (archive?.open(options, filePath) ?? unavailableReader())
            : { ok: false, error: 'Invalid dropped CBZ path' },
        'reader:chapter': (
          catalogId: unknown,
          entryId: unknown,
          options: unknown,
          priority?: unknown,
        ) => archive?.chapter(catalogId, entryId, options, priority) ?? unavailableReader(),
        'reader:prepare': (id: unknown, index: unknown, decodeWidth: unknown, priority?: unknown) =>
          archive?.prepare(id, index, decodeWidth, priority) ?? unavailableReader(),
        'reader:release': (id: unknown) => archive?.release(id) ?? unavailableReader(),
        'reader:diagnostics': (events: unknown) =>
          archive?.diagnostics(events) ?? unavailableReader(),
        'reader:render-reserve': (owner: unknown, bytes: unknown, limit: unknown) =>
          archive?.reserveRender(owner, bytes, limit) ?? unavailableReader(),
        'reader:preference': (update: unknown) =>
          currentPreferences?.update(update) ?? unavailableReader(),
        'shell:diagnostics': (records: unknown): Result | Promise<Result> => {
          if (!Array.isArray(records) || records.length > 200 || !records.every(diagnosticRecord))
            return { ok: false, error: 'Invalid diagnostic batch' };
          return records.length ? currentLog.write(records) : { ok: true };
        },
        'shell:startup-error': (message: unknown): Result => {
          dialog.showErrorBox(config.window.title, String(message).slice(0, 2000));
          return { ok: true };
        },
      } satisfies NativeHandlers;
      const handle = (channel: keyof InvokeChannels, handler: (...args: unknown[]) => unknown) =>
        ipcMain.handle(channel, (event, ...args: unknown[]) =>
          trusted(event) ? handler(...args) : { ok: false, error: 'Untrusted sender' },
        );
      for (const channel of channels) handle(channel, handlers[channel]);
      currentWindow.once('closed', () => {
        native.dispose();
        sectionHover.dispose();
        channels.forEach((channel) => ipcMain.removeHandler(channel));
      });
      await currentWindow.loadFile(entry);
    })
    .catch((error: unknown) => {
      console.error(error);
      dialog.showErrorBox(`${application.processName} could not start`, errorText(error));
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if ((log || reader || preferences) && !quitting) {
      event.preventDefault();
      quitting = true;
      void Promise.allSettled([reader?.dispose(), log?.flush(), preferences?.flush()]).finally(() =>
        app.quit(),
      );
    }
  });
}
