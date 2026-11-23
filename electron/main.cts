import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorText, isRecord, validateWindowConfig } from './WindowConfig.cjs';
import { appId, createAppWindow, createNativeWindowActions } from './AppWindow.cjs';
import { createDiagnosticLog } from './DiagnosticLog.cjs';
import { createSectionHover } from './SectionHover.cjs';
import { registerReaderScheme, createCbzReader } from './reader/CbzArchive.cjs';
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
  'reader:open-file',
  'reader:chapter',
  'reader:prepare',
  'reader:release',
  'reader:diagnostics',
  'reader:render-reserve',
] as const satisfies readonly (keyof InvokeChannels)[];

// LOGIC — emitted entry remains one level below the original application root.
const root = path.resolve(__dirname, '..');
const qa = process.argv.includes('--qa') && !app.isPackaged;
registerReaderScheme();
app.setName('Yuzread');
if (process.platform === 'win32') app.setAppUserModelId(appId);
const userData = qa
  ? path.join(root, '.runtime', `qa-profile-${process.pid}`)
  : path.join(app.getPath('appData'), 'Yuzread');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
const ownsLock = qa || app.requestSingleInstanceLock();
let window: BrowserWindow | undefined;
let log: ReturnType<typeof createDiagnosticLog> | undefined;
let reader: ReturnType<typeof createCbzReader> | undefined;
let quitting = false;

if (!ownsLock) app.quit();
else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const screenConfig: unknown = JSON.parse(
        fs.readFileSync(path.join(root, 'screen', 'config.json'), 'utf8'),
      );
      const nativeConfig: unknown = JSON.parse(
        fs.readFileSync(path.join(root, 'electron', 'config.json'), 'utf8'),
      );
      if (!isRecord(screenConfig)) throw new Error('Screen configuration must be an object');
      const config = { ...screenConfig, window: validateWindowConfig(nativeConfig) };
      const entry = path.join(root, 'screen-built', 'index.html');
      if (!fs.existsSync(entry))
        throw new Error('UI build is missing. Run npm run build or start.cmd.');
      const currentLog = createDiagnosticLog(app.getPath('userData'));
      log = currentLog;
      const currentWindow = createAppWindow(root, config.window);
      window = currentWindow;
      const archive = createCbzReader(
        currentWindow,
        path.join(userData, 'reader-cache'),
        screenConfig,
      );
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
          config,
          windowState: native.snapshot(),
          hoveredSections: sectionHover.snapshot(),
          logPath: currentLog.filePath,
          development: !app.isPackaged,
          qa,
          inspectionRequested: !app.isPackaged && process.argv.includes('--inspect-layout'),
        }),
        'shell:window-action': (operation: unknown) => native.activate(operation),
        'reader:open': (options: unknown) => archive.open(options),
        'reader:open-file': (filePath: unknown, options: unknown) =>
          typeof filePath === 'string'
            ? archive.open(options, filePath)
            : { ok: false, error: 'Invalid dropped CBZ path' },
        'reader:chapter': (
          catalogId: unknown,
          entryId: unknown,
          options: unknown,
          priority?: unknown,
        ) => archive.chapter(catalogId, entryId, options, priority),
        'reader:prepare': (id: unknown, index: unknown, decodeWidth: unknown, priority?: unknown) =>
          archive.prepare(id, index, decodeWidth, priority),
        'reader:release': (id: unknown) => archive.release(id),
        'reader:diagnostics': (events: unknown) => archive.diagnostics(events),
        'reader:render-reserve': (owner: unknown, bytes: unknown, limit: unknown) =>
          archive.reserveRender(owner, bytes, limit),
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
      dialog.showErrorBox('Yuzread could not start', errorText(error));
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if ((log || reader) && !quitting) {
      event.preventDefault();
      quitting = true;
      void Promise.allSettled([reader?.dispose(), log?.flush()]).finally(() => app.quit());
    }
  });
}
