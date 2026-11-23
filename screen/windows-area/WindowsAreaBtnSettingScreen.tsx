import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Portal from '@mui/material/Portal';
import ActionButton, { hasActionIcon } from '@ui/ActionButton.tsx';
import ConfiguredRow, { validateConfiguredRow } from '@ui/ConfiguredRow.tsx';
import { configuredSx } from '@logic/Appearance.ts';
import { finite, isObject } from '@logic/VisualConfig.ts';
import { hasParts, isNamedRecord } from '@logic/ConfigValidation.ts';
import type { ResolvedConfig, ResolvedPart } from '@logic/ConfigValidation.ts';
import type { ChildProps, ConfigReport } from '@logic/AreaDiscovery.ts';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';

// CONFIG AND CONTRACT — one local gear/popup owner; no reader/native settings yet.
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
] as const;
const headerParts = ['title', 'close'] as const;
type HeaderPart = (typeof headerParts)[number];
const labelKeys = ['title', 'close', 'drag'] as const;
export const configKeys = ['icon', 'closeIcon', 'order', 'gap', 'popup', 'labels', 'sections'];
export interface SettingScreenSection {
  id: string;
  label: string;
  expanded: boolean;
}
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
  sections: SettingScreenSection[];
}
export interface WindowsAreaSettingScreenInput {
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
    const ids = new Set<string>();
    for (const section of config.sections) {
      if (
        !isObject(section) ||
        typeof section.id !== 'string' ||
        !/^[A-Za-z][\w.-]*$/.test(section.id) ||
        ids.has(section.id) ||
        typeof section.label !== 'string' ||
        !section.label.trim() ||
        typeof section.expanded !== 'boolean'
      ) {
        reject('sections', 'unique id, label and expanded state per section card', section);
        break;
      }
      ids.add(section.id);
    }
  }
  return valid;
}
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

// LOGIC — the visible collapse state, kept in React state so the chevron and body re-render.
export function initialSectionState(sections: readonly SettingScreenSection[]) {
  return Object.fromEntries(sections.map((section) => [section.id, section.expanded]));
}
export function toggleSectionState(current: Record<string, boolean>, id: string) {
  return { ...current, [id]: !(current[id] ?? false) };
}
export function useSectionCards(sections: readonly SettingScreenSection[]) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    initialSectionState(sections),
  );
  const known = useRef(new Set(sections.map((section) => section.id)));
  useEffect(() => {
    const ids = new Set(sections.map((section) => section.id));
    let changed = false;
    for (const section of sections)
      if (!known.current.has(section.id)) {
        known.current.add(section.id);
        changed = true;
      }
    for (const id of [...known.current])
      if (!ids.has(id)) {
        known.current.delete(id);
        changed = true;
      }
    if (!changed) return;
    setExpanded((current) => {
      const next = { ...current };
      for (const section of sections)
        if (next[section.id] === undefined) next[section.id] = section.expanded;
      for (const id of Object.keys(next)) if (!ids.has(id)) delete next[id];
      return next;
    });
  }, [sections]);
  return {
    isExpanded: (id: string) => expanded[id] ?? false,
    toggle: (id: string) => setExpanded((current) => toggleSectionState(current, id)),
  };
}

// UI — shared card chrome: click the configured header to collapse/expand its body.
export function SettingScreenSectionCard({
  section,
  expanded,
  onToggle,
  parts,
  children,
}: {
  section: SettingScreenSection;
  expanded: boolean;
  onToggle: () => void;
  parts: { card: ResolvedPart; header: ResolvedPart; body: ResolvedPart };
  children?: ReactNode;
}) {
  return (
    <Box
      data-setting-section={section.id}
      sx={{
        ...configuredSx(parts.card),
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        width: '100%',
        flexShrink: 0,
      }}
    >
      <Box
        component="button"
        type="button"
        data-setting-section-header
        aria-expanded={expanded}
        onClick={onToggle}
        sx={{
          ...configuredSx(parts.header),
          width: '100%',
          flexShrink: 0,
          font: 'inherit',
          cursor: 'pointer',
          textAlign: 'inherit',
          justifyContent: 'space-between',
        }}
      >
        <Box
          component="span"
          sx={{ minWidth: 0, flex: '1 1 auto', textAlign: parts.header.visual.content.textAlign }}
        >
          {section.label}
        </Box>
      </Box>
      <Box
        data-setting-section-body
        hidden={!expanded}
        sx={{
          ...configuredSx(parts.body),
          display: expanded ? 'flex' : 'none',
          width: '100%',
          flex: '0 1 auto',
          minHeight: 0,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

// LOGIC — close hides the mounted portal; reopening retains position and future body state.
export default function WindowsAreaBtnSettingScreen({
  config,
}: ChildProps<WindowsAreaSettingScreenConfig, WindowsAreaSettingScreenInput>) {
  const anchor = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    header = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const positioned = useRef(false),
    position = useRef({ x: 0, y: 0 });
  const previousFocus = useRef<HTMLElement | null>(null);
  const sections = config.sections;
  const cards = useSectionCards(sections);
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

  // DRAG — only the blank header moves this popup, never the native window.
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

  // UI — always-mounted modeless screen. Outside clicks/header hover/Escape do not dismiss it.
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
                <SettingScreenSectionCard
                  key={section.id}
                  section={section}
                  parts={cardParts}
                  expanded={cards.isExpanded(section.id)}
                  onToggle={() => cards.toggle(section.id)}
                />
              ))}
            </Box>
          </Box>
        </Box>
      </Portal>
    </Box>
  );
}
