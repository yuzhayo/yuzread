import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { BrowserWindow } from 'electron';
import type {
  ReaderExternalWheel,
  ReaderScrollAnywhereReason,
  ReaderScrollAnywhereState,
} from '../../ShellHost.js';

// CONFIG AND CONTRACT — session-only Scroll Anywhere state; nothing here touches preferences.
const HeartbeatMs = 1000;
const MaxWheelDelta = 120 * 20;
const wheelLine = /^wheel (-?\d{1,6}) (-?\d{1,4}) (\d{1,16}) (\d{1,16}) (\d{1,16})$/;

interface ReaderGlobalWheelOptions {
  window: BrowserWindow;
  helperPath: string;
  onWheel: (event: ReaderExternalWheel) => void;
  onState: (state: ReaderScrollAnywhereState) => void;
}

// STATE AND COORDINATION — one helper process per Reader window, started on first use only.
export function createReaderGlobalWheel(options: ReaderGlobalWheelOptions) {
  const { window, helperPath, onWheel, onState } = options;
  let enabled = false;
  let ready = false;
  let revision = 0;
  let sequence = 0;
  let child: ChildProcessWithoutNullStreams | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let failure: string | undefined;
  let disposed = false;
  let state: ReaderScrollAnywhereState = { enabled: false, active: false, reason: 'off' };

  function currentReason(): ReaderScrollAnywhereReason {
    if (failure) return 'failed';
    if (!enabled) return 'off';
    if (window.isDestroyed() || window.isMinimized() || !window.isVisible()) return 'minimized';
    if (!ready) return 'not-ready';
    return 'active';
  }

  // STATE AND COORDINATION — publish only when the visible meaning actually changed.
  function publish(): void {
    const reason = currentReason();
    const next: ReaderScrollAnywhereState = {
      enabled,
      active: reason === 'active',
      reason,
      ...(failure ? { error: failure } : {}),
    };
    if (
      next.enabled === state.enabled &&
      next.active === state.active &&
      next.reason === state.reason &&
      next.error === state.error
    )
      return;
    state = next;
    onState(next);
  }

  function windowHandle(): string | undefined {
    if (window.isDestroyed()) return undefined;
    const handle = window.getNativeWindowHandle();
    if (handle.length < 8) return undefined;
    const value = handle.readBigUInt64LE(0);
    return value > 0n ? value.toString() : undefined;
  }

  // LOGIC AND CALCULATIONS — the helper is armed only for a live, ready, visible Reader window.
  function configure(): void {
    if (!child || !child.stdin.writable) return;
    const handle = windowHandle();
    if (!handle) return;
    revision += 1;
    sequence = 0;
    child.stdin.write(`configure ${currentReason() === 'active' ? 1 : 0} ${handle} ${revision}\n`);
  }

  function stopHeartbeat(): void {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  }

  function fail(message: string): void {
    failure = message;
    stopHeartbeat();
    publish();
  }

  function handleLine(line: string): void {
    if (line === 'ready 1') {
      failure = undefined;
      configure();
      publish();
      return;
    }
    if (line === 'bye') {
      if (enabled && !disposed) fail('Scroll Anywhere helper stopped');
      return;
    }
    if (line.startsWith('fault ')) {
      const message = line.slice('fault '.length).trim().slice(0, 200);
      fail(message ? `Scroll Anywhere helper: ${message}` : 'Scroll Anywhere helper failed');
      return;
    }
    const parts = wheelLine.exec(line);
    if (!parts) return;
    const delta = Number(parts[1]);
    const lines = Number(parts[2]);
    const timestamp = Number(parts[3]);
    const lineRevision = Number(parts[4]);
    const lineSequence = Number(parts[5]);
    if (
      !Number.isFinite(delta) ||
      delta === 0 ||
      Math.abs(delta) > MaxWheelDelta ||
      !Number.isFinite(lines) ||
      lines < -1 ||
      lines > 100 ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      lineRevision !== revision ||
      lineSequence <= sequence
    )
      return;
    sequence = lineSequence;
    onWheel({ delta, lines, timestamp });
  }

  function start(): void {
    if (child || disposed) return;
    if (!fs.existsSync(helperPath)) {
      fail('Scroll Anywhere helper is missing');
      return;
    }
    failure = undefined;
    const spawned = spawn(helperPath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = spawned;
    spawned.stdout.setEncoding('utf8');
    const reader = createInterface({ input: spawned.stdout });
    reader.on('line', handleLine);
    spawned.stderr.setEncoding('utf8');
    spawned.stderr.on('data', () => {
      // Helper diagnostics are never user-facing state; the exit path reports failure.
    });
    spawned.on('error', () => {
      if (child === spawned) child = undefined;
      fail('Scroll Anywhere helper could not start');
    });
    spawned.on('exit', () => {
      if (child === spawned) child = undefined;
      stopHeartbeat();
      if (disposed) return;
      if (enabled) fail('Scroll Anywhere helper stopped');
      else publish();
    });
    heartbeat = setInterval(() => {
      if (child?.stdin.writable) child.stdin.write('heartbeat\n');
    }, HeartbeatMs);
  }

  function setEnabled(next: boolean): ReaderScrollAnywhereState {
    if (disposed) return state;
    if (next === enabled) return state;
    enabled = next;
    failure = undefined;
    if (next) {
      start();
      configure();
    } else {
      ready = false;
      if (child) {
        const handle = windowHandle();
        if (handle && child.stdin.writable) {
          revision += 1;
          sequence = 0;
          child.stdin.write(`configure 0 ${handle} ${revision}\n`);
        }
        stopHeartbeat();
        child.stdin.end('shutdown\n');
      }
    }
    publish();
    return state;
  }

  // STATE AND COORDINATION — the screen reports whether readable content can accept wheel input.
  function setReady(next: boolean): void {
    if (disposed || ready === next) return;
    ready = next;
    if (enabled) configure();
    publish();
  }

  // LIFECYCLE AND CLEANUP — minimize/hide pause capture; restore re-arms without unlatching.
  const rearm = () => {
    if (!enabled) return;
    configure();
    publish();
  };
  const pause = () => publish();
  window.on('minimize', pause);
  window.on('hide', pause);
  window.on('restore', rearm);
  window.on('show', rearm);

  function dispose(): Promise<void> {
    if (disposed) return Promise.resolve();
    disposed = true;
    enabled = false;
    ready = false;
    stopHeartbeat();
    window.off('minimize', pause);
    window.off('hide', pause);
    window.off('restore', rearm);
    window.off('show', rearm);
    const running = child;
    child = undefined;
    if (!running) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!running.killed) running.kill();
        resolve();
      }, 2000);
      running.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      if (running.stdin.writable) running.stdin.end('shutdown\n');
      else running.kill();
    });
  }

  return {
    snapshot: () => state,
    setEnabled,
    setReady,
    dispose,
  };
}
