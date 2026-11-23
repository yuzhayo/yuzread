import type { ReaderPreparedPage, ReaderWorkPriority, Result } from '../../../ShellHost.js';
// CONFIG AND CONTRACT — local structured-clone messages, not an application bridge.
export interface PixiView {
  revision: number;
  control: number;
  documentId: string;
  width: number;
  height: number;
  ratio: number;
  x: number;
  y: number;
  maxY: number;
  renderLeft: number;
  renderWidth: number;
}
export interface PixiPageBox {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface PixiPageTiming {
  bitmapMs: number;
  uploadMs: number;
}
export type PixiInput =
  | {
      version: 1;
      kind: 'init';
      canvas: OffscreenCanvas | null;
      view: PixiView;
      speed: number;
      maxFPS: number;
      tileMemoryMB: number;
      tickWindowMs: number;
    }
  | { version: 1; kind: 'layout'; view: PixiView; pages: PixiPageBox[] }
  | { version: 1; kind: 'view'; view: PixiView }
  | {
      version: 1;
      kind: 'prepare';
      request: number;
      page: ReaderPreparedPage;
      priority: ReaderWorkPriority;
      warm?: { top: number; height: number };
    }
  | { version: 1; kind: 'release'; request: number; chapter: string }
  | { version: 1; kind: 'wheel'; control: number; distance: number; time: number; maxY: number }
  | { version: 1; kind: 'stop'; control: number; y: number; maxY: number }
  | { version: 1; kind: 'rebase'; control: number; delta: number; maxY: number }
  | { version: 1; kind: 'speed'; control: number; speed: number; maxY: number }
  | { version: 1; kind: 'ack'; serial: number }
  | { version: 1; kind: 'reservation'; request: number; result: Result }
  | { version: 1; kind: 'dispose' };
export type PixiOutput =
  | { version: 1; kind: 'initialized' }
  | {
      version: 1;
      kind: 'ready';
      backend: 'webgl';
      webGLVersion: 1 | 2;
      maxTextureSize: number;
    }
  | { version: 1; kind: 'prepared'; request: number; result: Result; timing: PixiPageTiming }
  | { version: 1; kind: 'released'; request: number }
  | { version: 1; kind: 'reserve'; request: number; bytes: number }
  | {
      version: 1;
      kind: 'position';
      serial: number;
      control: number;
      y: number;
      moving: boolean;
      speed: number;
      velocity: number;
      gestureActive: boolean;
    }
  | {
      version: 1;
      kind: 'rendered';
      serial: number;
      revision: number;
      pages: number;
      visiblePages: number;
      residentTiles: number;
      residentBytes: number;
      blockedFrames: number;
      skippedTiles: number;
      skippedDecodeBytes: number;
      skippedUploadBytes: number;
      frame: { left: number; width: number; height: number; ratio: number };
    }
  | { version: 1; kind: 'failed'; error: string }
  | { version: 1; kind: 'tile-error'; error: string }
  | { version: 1; kind: 'disposed' };
