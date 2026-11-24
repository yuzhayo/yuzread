import { Fragment, useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import Box from '@mui/material/Box';
import Portal from '@mui/material/Portal';
import ActionButton, { hasActionIcon } from '@ui/ActionButton.tsx';
import ConfiguredRow, { validateConfiguredRow } from '@ui/ConfiguredRow.tsx';
import { configuredSx } from '@logic/Appearance.ts';
import { finite, isObject } from '@logic/VisualConfig.ts';
import { hasParts, isNamedRecord } from '@logic/ConfigValidation.ts';
import type { ResolvedConfig, ResolvedPart } from '@logic/ConfigValidation.ts';
import { defineChild } from '@logic/AreaDiscovery.ts';
import type { ChildProps, ConfigReport } from '@logic/AreaDiscovery.ts';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';
import { hasRequestPort, hasStatePort } from '@logic/ParentConnections.ts';
import type { RequestPort, StatePort } from '@logic/ParentConnections.ts';
import type { ReaderNumberSettingChange, Result } from '../../../ShellHost.js';
import {
  discoverSettingSections,
  type WindowsAreaSettingSection,
} from './setting-screen/WindowsAreaBtnSettingScreenSections.ts';

const settingSectionModules = import.meta.env
  ? import.meta.glob('./setting-screen/*.tsx', { eager: true })
  : {};
const settingSections = discoverSettingSections(settingSectionModules);
const settingSection = (value: unknown): value is WindowsAreaSettingSection =>
  isObject(value) &&
  typeof value.id === 'string' &&
  /^[A-Za-z][\w.-]*$/.test(value.id) &&
  typeof value.componentId === 'string' &&
  /^[a-z][A-Za-z0-9.-]*$/.test(value.componentId) &&
  typeof value.label === 'string' &&
  Boolean(value.label.trim()) &&
  typeof value.expanded === 'boolean';

// CONFIG AND CONTRACT — one local gear/popup owner with locally discovered section bodies.
export const componentId = 'window.settingScreen';
export const partKeys = [
  'panel',
  'header',
  'title',
  'close',
  'body',
  'card',
  'cardHeader',
  'cardBody',
  'smoothReset',
  'smoothSlider',
  'smoothValue',
] as const;
const headerParts = ['title', 'close'] as const;
type HeaderPart = (typeof headerParts)[number];
const labelKeys = ['title', 'close', 'drag'] as const;
export const configKeys = ['icon', 'closeIcon', 'order', 'gap', 'popup', 'labels', 'sections'];
export interface WindowsAreaSettingScreenConfig extends ResolvedConfig {
  icon: string;
  closeIcon: string;
  order: HeaderPart[];
  gap: number;
  popup: {
    width: number;
    height: number;
    offset: number;
    gap: number;
    headerHeight: number;
    zIndex: number;
  };
  labels: Record<(typeof labelKeys)[number], string>;
  parts: Record<(typeof partKeys)[number], ResolvedPart>;
  sections: WindowsAreaSettingSection[];
}
export interface WindowsAreaSettingScreenInput {
  smoothDurationMs: number | null;
  requestSmoothDuration(change: ReaderNumberSettingChange): Promise<Result>;
  report(issue: DiagnosticIssue): void;
}
export function validateConfig(
  config: ResolvedConfig,
  report: ConfigReport,
): config is WindowsAreaSettingScreenConfig {
  let valid = hasParts(config, partKeys);
  const reject: ConfigReport = (key, expected, actual) => {
    valid = false;
    report(key, expected, actual);
  };
  if (!hasActionIcon(config.icon)) reject('icon', 'registered gear/action icon', config.icon);
  if (!hasActionIcon(config.closeIcon))
    reject('closeIcon', 'registered close/action icon', config.closeIcon);
  if (
    !isNamedRecord(
      config.labels,
      labelKeys,
      (value: unknown): value is string => typeof value === 'string' && !!value.trim(),
    )
  )
    reject('labels', 'title, close and drag labels', config.labels);
  const popup = config.popup;
  if (
    !isObject(popup) ||
    !finite(popup.width, 180, 1000) ||
    !finite(popup.height, 120, 900) ||
    !finite(popup.offset, 0, 100) ||
    !finite(popup.gap, 0, 32) ||
    !finite(popup.headerHeight, 24, 80) ||
    !finite(popup.zIndex, 11, 2000) ||
    popup.headerHeight + popup.gap >= popup.height
  )
    reject('popup', 'bounded popup dimensions, header/body space and layer', popup);
  if (hasParts(config, partKeys))
    valid = validateConfiguredRow(config, headerParts, report) && valid;
  if (!Array.isArray(config.sections) || config.sections.length > 32)
    reject('sections', 'array of section cards', config.sections);
  else {
    const ids = new Set<string>(),
      components = new Set<string>();
    for (const section of config.sections) {
      if (
        !settingSection(section) ||
        ids.has(section.id) ||
        components.has(section.componentId) ||
        !section.label.trim()
      ) {
        reject(
          'sections',
          'unique id/componentId, label and expanded state per section card',
          section,
        );
        break;
      }
      ids.add(section.id);
      components.add(section.componentId);
      const definition = settingSections.get(section.componentId);
      if (settingSections.size && (!definition || !definition.validate(section, report))) {
        valid = false;
        break;
      }
    }
  }
  return valid;
}

// CHILD REGISTRATION — the popup receives only the matching smooth-scroll request/state.
interface WindowsAreaSettingScreenPorts {
  setSmoothScrollDuration: RequestPort<ReaderNumberSettingChange, Result>;
  smoothScrollDuration: StatePort<number | null>;
}
const acceptsParentPorts = (value: unknown): value is WindowsAreaSettingScreenPorts =>
  hasRequestPort(
    value,
    'setSmoothScrollDuration',
    'ui.reader.smooth-duration.input',
    'ui.reader.smooth-duration.output',
  ) && hasStatePort(value, 'smoothScrollDuration', 'ui.reader.smooth-duration.state');
export const child = defineChild(
  'WindowsArea',
  WindowsAreaBtnSettingScreen,
  validateConfig,
  { componentId, configKeys, partKeys },
  acceptsParentPorts,
  (ports, report) => ({
    smoothDurationMs: ports.smoothScrollDuration.getSnapshot(),
    requestSmoothDuration: ports.setSmoothScrollDuration.request,
    report,
  }),
);

// LOGIC AND CALCULATIONS — deterministic position and section-state transformations.
export function clampSettingScreenPosition(
  position: { x: number; y: number },
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
) {
  return {
    x: Math.max(0, Math.min(Math.max(0, viewWidth - width), position.x)),
    y: Math.max(0, Math.min(Math.max(0, viewHeight - height), position.y)),
  };
}

// STATE AND COORDINATION — popup visibility, position, focus and drag state stay local.
export default function WindowsAreaBtnSettingScreen({
  config,
  input,
}: ChildProps<WindowsAreaSettingScreenConfig, WindowsAreaSettingScreenInput>) {
  const anchor = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    header = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const positioned = useRef(false),
    position = useRef({ x: 0, y: 0 });
  const previousFocus = useRef<HTMLElement | null>(null);
  const sections = config.sections;
  const dragging = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(
    null,
  );
  const id = `${config.id}-panel`;
  const finishDrag = () => {
    const drag = dragging.current;
    dragging.current = null;
    if (drag && header.current?.hasPointerCapture(drag.id))
      header.current.releasePointerCapture(drag.id);
  };
  const clampPosition = () => {
    const width = Math.min(config.popup.width, innerWidth),
      height = Math.min(config.popup.height, innerHeight);
    position.current = clampSettingScreenPosition(
      position.current,
      width,
      height,
      innerWidth,
      innerHeight,
    );
    if (panel.current)
      Object.assign(panel.current.style, {
        left: `${position.current.x}px`,
        top: `${position.current.y}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
  };
  const show = () => {
    if (!open)
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!positioned.current) {
      const box = anchor.current?.getBoundingClientRect();
      position.current = { x: box?.left ?? 0, y: (box?.bottom ?? 0) + config.popup.offset };
      positioned.current = true;
    }
    clampPosition();
    if (open) header.current?.focus({ preventScroll: true });
    else setOpen(true);
  };
  const close = () => {
    finishDrag();
    if (
      document.activeElement instanceof HTMLElement &&
      panel.current?.contains(document.activeElement)
    )
      document.activeElement.blur();
    setOpen(false);
    if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
  };

  // UI AND LOCAL EVENTS — DRAG
  // Only the blank header moves this popup, never the native window.
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button')))
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.current.x,
      top: position.current.y,
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    position.current = {
      x: drag.left + event.clientX - drag.x,
      y: drag.top + event.clientY - drag.y,
    };
    clampPosition();
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current?.id === event.pointerId) finishDrag();
  };

  // LIFECYCLE AND CLEANUP — clamp on resize and release pointer/focus resources.
  useEffect(() => {
    clampPosition();
    window.addEventListener('resize', clampPosition);
    window.addEventListener('blur', finishDrag);
    return () => {
      window.removeEventListener('resize', clampPosition);
      window.removeEventListener('blur', finishDrag);
      finishDrag();
    };
  }, [config.popup.width, config.popup.height]);
  useEffect(() => {
    if (open) header.current?.focus({ preventScroll: true });
  }, [open]);

  // LOGIC AND CALCULATIONS — derive configured header/card views without owning layout policy.
  const headerConfig = {
    ...config,
    label: config.labels.title,
    visual: config.parts.header.visual,
  };
  const cardParts = {
    card: config.parts.card,
    header: config.parts.cardHeader,
    body: config.parts.cardBody,
  };
  const controlParts = {
    reset: config.parts.smoothReset,
    slider: config.parts.smoothSlider,
    value: config.parts.smoothValue,
  };
  const sectionContext = {
    owner: config,
    cardParts,
    controlParts,
    smoothDurationMs: input.smoothDurationMs,
    requestSmoothDuration: input.requestSmoothDuration,
    report: input.report,
  };

  // UI AND LOCAL EVENTS — always-mounted modeless screen; only its configured X dismisses it.
  return (
    <Box ref={anchor} role="presentation" className="fill">
      <ActionButton
        config={config}
        icon={config.icon}
        label={config.label}
        onClick={show}
        expanded={open}
        controls={id}
      />
      <Portal>
        <Box
          ref={panel}
          id={id}
          role="dialog"
          aria-modal={false}
          aria-label={config.labels.title}
          hidden={!open}
          inert={!open}
          data-setting-screen
          data-drag-region="no-drag"
          sx={{
            display: open ? 'block' : 'none',
            position: 'fixed',
            left: position.current.x,
            top: position.current.y,
            width: Math.min(config.popup.width, innerWidth),
            height: Math.min(config.popup.height, innerHeight),
            zIndex: config.popup.zIndex,
            containerType: 'size',
          }}
        >
          <Box
            className="fill"
            sx={{
              ...configuredSx(config.parts.panel),
              flexDirection: 'column',
              alignItems: 'stretch',
              justifyContent: 'flex-start',
              gap: `${config.popup.gap}px`,
            }}
          >
            {/* HEADER — blank drag surface and right-side close control. */}
            <Box
              ref={header}
              tabIndex={-1}
              data-setting-screen-header
              aria-label={config.labels.drag}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onLostPointerCapture={up}
              sx={{
                height: `${config.popup.headerHeight}px`,
                flexShrink: 0,
                cursor: 'move',
                userSelect: 'none',
                touchAction: 'none',
              }}
            >
              <ConfiguredRow
                config={headerConfig}
                renderPart={(name, part) =>
                  name === 'title' ? (
                    <Box className="fill" sx={configuredSx(part)} />
                  ) : (
                    <ActionButton
                      config={part}
                      icon={config.closeIcon}
                      label={config.labels.close}
                      onClick={close}
                    />
                  )
                }
              />
            </Box>
            {/* BODY — section cards. Their bodies stay mounted when collapsed. */}
            <Box
              data-setting-screen-body
              sx={{
                ...configuredSx(config.parts.body),
                flex: '1 1 0',
                minHeight: 0,
                flexDirection: 'column',
                alignItems: 'stretch',
                justifyContent: 'flex-start',
                gap: `${config.popup.gap}px`,
                overflow: 'auto',
              }}
            >
              {sections.map((section) => (
                <Fragment key={section.id}>
                  {settingSections.get(section.componentId)?.render(section, sectionContext)}
                </Fragment>
              ))}
            </Box>
          </Box>
        </Box>
      </Portal>
    </Box>
  );
}
