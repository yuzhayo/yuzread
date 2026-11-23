import { screen } from 'electron';
import type { BrowserWindow } from 'electron';
import { isRecord } from './WindowConfig.cjs';
// This native adapter accepts geometry only; it never imports screen implementation.
interface HoverBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface HoverSection {
  id: string;
  bounds: HoverBounds;
  enabled: true;
  hoverPreset: string;
}
const isId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z][\w.-]*$/.test(value);
const percentage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const validBounds = (value: unknown): value is HoverBounds =>
  isRecord(value) &&
  percentage(value.x) &&
  percentage(value.y) &&
  percentage(value.width) &&
  percentage(value.height) &&
  value.width > 0 &&
  value.height > 0 &&
  value.x + value.width <= 100 &&
  value.y + value.height <= 100;

// LOGIC — one geometry-driven hover sampler for caption and non-draggable overlays.
export function createSectionHover(window: BrowserWindow, sections: unknown) {
  const contents = window.webContents;
  let disposed = false;
  const candidates: unknown[] = Array.isArray(sections) ? sections : [];
  const regions = candidates.filter(
    (section): section is HoverSection =>
      isRecord(section) &&
      section.enabled === true &&
      isId(section.id) &&
      typeof section.hoverPreset === 'string' &&
      validBounds(section.bounds),
  );
  let current: string[] = [];
  const deliver = (next: string[]) => {
    if (disposed || window.isDestroyed() || contents.isDestroyed()) return;
    if (contents.isLoadingMainFrame()) return false;
    contents.send('shell:section-hover', next);
    return true;
  };
  const sample = () => {
    if (disposed || window.isDestroyed() || contents.isDestroyed()) return;
    let next: string[] = [];
    if (window.isVisible() && !window.isMinimized()) {
      const point = screen.getCursorScreenPoint();
      const area = window.getContentBounds();
      const x = ((point.x - area.x) / area.width) * 100;
      const y = ((point.y - area.y) / area.height) * 100;
      next = regions
        .filter(
          ({ bounds }) =>
            x >= bounds.x &&
            x < bounds.x + bounds.width &&
            y >= bounds.y &&
            y < bounds.y + bounds.height,
        )
        .map(({ id }) => id);
    }
    if (next.length === current.length && next.every((id, index) => id === current[index])) return;
    // The delivered state only advances when the screen could receive it, so a
    // pointer that is already inside the area is not lost during page load.
    if (!deliver(next)) return;
    current = next;
  };
  const timer = regions.length ? setInterval(sample, 60) : null;
  const onReady = () => {
    current = [];
    sample();
  };
  contents.on('did-finish-load', onReady);
  return {
    snapshot: () => current,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer) clearInterval(timer);
      // The closed event runs after BrowserWindow's webContents accessor is gone.
      if (!contents.isDestroyed()) contents.removeListener('did-finish-load', onReady);
    },
  };
}
