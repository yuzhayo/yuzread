import { app, BrowserWindow, nativeImage, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { WindowConfig } from './WindowConfig.cjs';
import type { WindowActionResult, WindowState } from '../ShellHost.js';

export const appId = 'com.yuzread.desktop';

// LOGIC — startup and Return to default share this one native geometry owner.
function applyLaunchBounds(
  window: BrowserWindow,
  config: WindowConfig,
  workArea = screen.getDisplayMatching(window.getBounds()).workArea,
) {
  if (config.startup === 'square') {
    const side = Math.min(workArea.width, workArea.height);
    window.setMinimumSize(Math.min(config.minWidth, side), Math.min(config.minHeight, side));
    window.setBounds({
      x: workArea.x + Math.round((workArea.width - side) / 2),
      y: workArea.y + Math.round((workArea.height - side) / 2),
      width: side,
      height: side,
    });
  } else if (config.startup === 'vertical') {
    const width = Math.min(config.width, workArea.width);
    window.setBounds({
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y,
      width,
      height: workArea.height,
    });
  } else if (config.startup === 'maximized') window.maximize();
  else {
    const width = Math.min(config.width, workArea.width),
      height = Math.min(config.height, workArea.height);
    window.setBounds({
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height,
    });
  }
}

// LOGIC — register the same identity/icon with Windows Shell, without touching pins.
function registerWindowsShortcut(root: string, iconPath: string, title: string) {
  if (process.platform !== 'win32' || process.argv.includes('--qa')) return;
  const directory = path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  const shortcut = path.join(directory, 'Yuzread.lnk');
  const options = {
    target: process.execPath,
    args: app.isPackaged ? '' : `"${root}"`,
    cwd: root,
    description: title,
    icon: iconPath,
    iconIndex: 0,
    appUserModelId: appId,
  };
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(shortcut)) {
    const existing = shell.readShortcutLink(shortcut);
    if (existing.appUserModelId !== appId) {
      console.error('Yuzread shortcut belongs to another identity; left unchanged.');
      return;
    }
    if (
      existing.target === options.target &&
      existing.args === options.args &&
      existing.cwd === options.cwd &&
      existing.description === options.description &&
      existing.icon === options.icon &&
      existing.iconIndex === options.iconIndex &&
      existing.appUserModelId === options.appUserModelId
    )
      return;
  }
  if (!shell.writeShortcutLink(shortcut, 'create', options))
    throw new Error('Could not register the Yuzread Windows shortcut');
}

// UI — retain native resizing/snap/shadow, replacing only the visible title bar.
export function createAppWindow(root: string, config: WindowConfig) {
  const iconPath = config.icon === undefined ? undefined : path.join(root, config.icon);
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;
  const windowIcon = process.platform === 'win32' ? iconPath : icon;
  if (icon?.isEmpty()) throw new Error(`App icon could not be loaded: ${config.icon}`);
  if (iconPath) registerWindowsShortcut(root, iconPath, config.title);
  const window = new BrowserWindow({
    title: config.title,
    width: config.width,
    height: config.height,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    // Windows loads the ICO directly to retain its native small/large variants.
    backgroundColor: config.background,
    ...(windowIcon ? { icon: windowIcon } : {}),
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    webPreferences: {
      preload: path.join(root, 'electron-built', 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  if (process.platform === 'win32')
    window.setAppDetails({
      appId,
      ...(iconPath && { appIconPath: iconPath, appIconIndex: 0 }),
      relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${root}"`,
      relaunchDisplayName: config.title,
    });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => {
    applyLaunchBounds(window, config);
    window.show();
  });
  return window;
}

// LOGIC — the only owner of native window operations and state notifications.
export function createNativeWindowActions(window: BrowserWindow, config: WindowConfig) {
  const snapshot = (): WindowState => ({
    maximized: window.isMaximized(),
    minimized: window.isMinimized(),
  });
  const notify = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send('shell:window-state', snapshot());
  };
  window.on('maximize', notify);
  window.on('unmaximize', notify);
  window.on('minimize', notify);
  window.on('restore', notify);
  return {
    snapshot,
    activate(operation: unknown): WindowActionResult {
      if (window.isDestroyed()) return { ok: false, error: 'Window is closed' };
      if (operation === 'minimize') window.minimize();
      else if (operation === 'restoreDefault') {
        const { workArea } = screen.getDisplayMatching(window.getBounds());
        const reset = () => {
          if (window.isDestroyed()) return;
          if (window.isMinimized()) window.restore();
          if (window.isMaximized()) window.unmaximize();
          applyLaunchBounds(window, config, workArea);
          notify();
        };
        if (window.isFullScreen()) {
          window.once('leave-full-screen', reset);
          window.setFullScreen(false);
        } else reset();
      } else if (operation === 'toggleMaximize')
        window.isMaximized() ? window.unmaximize() : window.maximize();
      else if (operation === 'close')
        setImmediate(() => {
          if (!window.isDestroyed()) window.close();
        });
      else return { ok: false, error: 'Unsupported window operation' };
      return { ok: true, state: snapshot() };
    },
    dispose() {
      window.removeListener('maximize', notify);
      window.removeListener('unmaximize', notify);
      window.removeListener('minimize', notify);
      window.removeListener('restore', notify);
    },
  };
}
