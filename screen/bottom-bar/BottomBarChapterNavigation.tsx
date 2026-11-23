import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import Box from '@mui/material/Box';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Portal from '@mui/material/Portal';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ActionButton from '@ui/ActionButton.tsx';
import ConfiguredRow, { validateConfiguredRow } from '@ui/ConfiguredRow.tsx';
import { configuredSx } from '@logic/Appearance.ts';
import { finite, isObject, errorText } from '@logic/VisualConfig.ts';
import { hasParts, isNamedRecord } from '@logic/ConfigValidation.ts';
import type { ResolvedConfig, ResolvedPart } from '@logic/ConfigValidation.ts';
import type { ChildProps, ConfigReport } from '@logic/AreaDiscovery.ts';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';
import type { ReaderNavigationRequest, ReaderNavigationState, Result } from '../../ShellHost.js';

// CONFIG AND CONTRACT — one navigation block owns its buttons and chapter popup.
export const componentId = 'reader.chapterNavigation';
export const partKeys = [
  'previous',
  'list',
  'next',
  'panel',
  'header',
  'chapters',
  'item',
] as const;
const controls = ['previous', 'list', 'next'] as const;
type Control = (typeof controls)[number];
const labelKeys = ['previous', 'list', 'next', 'title', 'drag', 'empty'] as const;
export const configKeys = ['order', 'gap', 'popup', 'labels'];
export interface BottomBarNavigationConfig extends ResolvedConfig {
  order: Control[];
  gap: number;
  popup: {
    width: number;
    height: number;
    offset: number;
    headerHeight: number;
    itemHeight: number;
    zIndex: number;
  };
  labels: Record<(typeof labelKeys)[number], string>;
  parts: Record<(typeof partKeys)[number], ResolvedPart>;
}
export interface BottomBarNavigationInput {
  state: ReaderNavigationState;
  requestNavigation(request: ReaderNavigationRequest): Promise<Result>;
  report(issue: DiagnosticIssue): void;
}
export function navigationAvailability(state: ReaderNavigationState) {
  const index = state.chapters.findIndex((entry) => entry.id === state.currentId);
  return {
    previous: !state.busy && index > 0,
    next: !state.busy && index >= 0 && index < state.chapters.length - 1,
    list: !state.busy && !!state.catalogId && state.chapters.length > 0,
  };
}
export function validateConfig(
  config: ResolvedConfig,
  report: ConfigReport,
): config is BottomBarNavigationConfig {
  let valid = hasParts(config, partKeys);
  const reject: ConfigReport = (key, expected, actual) => {
    valid = false;
    report(key, expected, actual);
  };
  if (
    !isNamedRecord(
      config.labels,
      labelKeys,
      (value: unknown): value is string => typeof value === 'string' && !!value.trim(),
    )
  )
    reject('labels', 'all chapter navigation labels', config.labels);
  const popup = config.popup;
  if (
    !isObject(popup) ||
    !finite(popup.width, 180, 800) ||
    !finite(popup.height, 100, 800) ||
    !finite(popup.offset, 0, 100) ||
    !finite(popup.headerHeight, 20, 100) ||
    !finite(popup.itemHeight, 24, 80) ||
    !finite(popup.zIndex, 11, 2000) ||
    popup.headerHeight + popup.itemHeight > popup.height
  )
    reject('popup', 'bounded chapter popup geometry', popup);
  if (hasParts(config, partKeys)) valid = validateConfiguredRow(config, controls, report) && valid;
  return valid;
}

// LOGIC — state is provided by Reader through parents; no sibling/native access.
export default function BottomBarChapterNavigation({
  config,
  input,
}: ChildProps<BottomBarNavigationConfig, BottomBarNavigationInput>) {
  const anchor = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false);
  const locked = useRef(false),
    position = useRef({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const id = `${config.id}-chapters`;
  const available = navigationAvailability(input.state);
  const current = input.state.chapters.find((entry) => entry.id === input.state.currentId);
  const close = () => {
    drag.current = null;
    setOpen(false);
  };
  const navigate = async (request: ReaderNavigationRequest) => {
    if (locked.current || input.state.busy) return;
    locked.current = true;
    setPending(true);
    try {
      const result = await input.requestNavigation(request);
      if (!result.ok) throw new Error(result.error);
      close();
    } catch (error) {
      input.report({
        code: 'CHAPTER_NAVIGATION_FAILED',
        expected: 'available authorized chapter',
        actual: errorText(error),
      });
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  const clamp = () => {
    const width = Math.min(config.popup.width, innerWidth),
      height = Math.min(config.popup.height, innerHeight);
    position.current.x = Math.max(0, Math.min(innerWidth - width, position.current.x));
    position.current.y = Math.max(0, Math.min(innerHeight - height, position.current.y));
    if (panel.current)
      Object.assign(panel.current.style, {
        left: `${position.current.x}px`,
        top: `${position.current.y}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
  };
  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const box = anchor.current?.getBoundingClientRect();
    position.current = {
      x: (box?.left ?? 0) + ((box?.width ?? config.popup.width) - config.popup.width) / 2,
      y: (box?.top ?? innerHeight) - config.popup.offset - config.popup.height,
    };
    clamp();
    setOpen(true);
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.current.x,
      top: position.current.y,
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    position.current = {
      x: current.left + event.clientX - current.x,
      y: current.top + event.clientY - current.y,
    };
    clamp();
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  useEffect(() => {
    if (!open) return undefined;
    clamp();
    const selected = panel.current?.querySelector('button[aria-current="page"]');
    if (selected instanceof HTMLElement) {
      selected.scrollIntoView({ block: 'nearest' });
      selected.focus();
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('resize', clamp);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', clamp);
      drag.current = null;
    };
  }, [open, config.popup.width, config.popup.height]);
  useEffect(() => {
    if (!open) return;
    const selected = panel.current?.querySelector('button[aria-current="page"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [input.state.currentId, open]);

  // UI — a hover-strip row and modeless popup; all visuals and sizes are configured.
  return (
    <ClickAwayListener
      onClickAway={() => {
        if (!drag.current) close();
      }}
    >
      <Box ref={anchor} role="presentation" className="fill">
        <ConfiguredRow
          config={config}
          renderPart={(name, part) => {
            const disabled = pending || !available[name];
            return (
              <ActionButton
                config={part}
                icon={name === 'list' ? 'chapters' : name}
                label={config.labels[name]}
                disabled={disabled}
                onClick={() => {
                  if (name === 'list') toggle();
                  else void navigate({ catalogId: input.state.catalogId, action: name });
                }}
                {...(name === 'list' ? { expanded: open, ...(open ? { controls: id } : {}) } : {})}
              />
            );
          }}
        />
        {open && (
          <Portal>
            <Box
              ref={panel}
              id={id}
              role="dialog"
              aria-modal={false}
              aria-label={config.labels.title}
              data-chapter-popup
              data-drag-region="no-drag"
              sx={{
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
                }}
              >
                <Box
                  data-chapter-drag-handle
                  aria-label={config.labels.drag}
                  title={current?.name}
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  sx={{
                    ...configuredSx(config.parts.header),
                    height: `${config.popup.headerHeight}px`,
                    flexShrink: 0,
                    cursor: 'move',
                    userSelect: 'none',
                    touchAction: 'none',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {current?.name ?? config.labels.title}
                  </span>
                </Box>
                <Box
                  sx={{
                    ...configuredSx(config.parts.chapters),
                    flex: '1 1 0',
                    minHeight: 0,
                    overflowY: 'auto',
                    display: 'block',
                  }}
                >
                  <List disablePadding aria-label={config.labels.title}>
                    {input.state.chapters.length ? (
                      input.state.chapters.map((entry) => {
                        const selected = entry.id === input.state.currentId;
                        return (
                          <ListItemButton
                            component="button"
                            key={entry.id}
                            selected={selected}
                            aria-current={selected ? 'page' : undefined}
                            disabled={pending || input.state.busy}
                            onClick={() => {
                              void navigate({
                                catalogId: input.state.catalogId,
                                action: 'select',
                                entryId: entry.id,
                              });
                            }}
                            sx={{
                              ...configuredSx(config.parts.item, selected ? 'active' : undefined),
                              width: '100%',
                              height: `${config.popup.itemHeight}px`,
                              justifyContent: 'flex-start',
                              textTransform: 'none',
                              '&.Mui-selected': configuredSx(config.parts.item, 'active'),
                            }}
                          >
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {entry.name}
                            </span>
                          </ListItemButton>
                        );
                      })
                    ) : (
                      <Box sx={configuredSx(config.parts.item)}>{config.labels.empty}</Box>
                    )}
                  </List>
                </Box>
              </Box>
            </Box>
          </Portal>
        )}
      </Box>
    </ClickAwayListener>
  );
}
