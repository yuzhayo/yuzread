import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Portal from '@mui/material/Portal';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import ActionButton, { hasActionIcon } from '@ui/ActionButton.tsx';
import ConfiguredRow, { validateConfiguredRow } from '@ui/ConfiguredRow.tsx';
import { configuredSx } from '@logic/Appearance.ts';
import { finite, isObject, errorText } from '@logic/VisualConfig.ts';
import { hasParts, isNamedRecord } from '@logic/ConfigValidation.ts';
import type { ResolvedConfig, ResolvedPart } from '@logic/ConfigValidation.ts';
import type { ChildProps, ConfigReport } from '@logic/AreaDiscovery.ts';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';
import type { Result } from '../../ShellHost.js';

// CONFIG AND CONTRACT — popup, range, draft and dragging belong to this child.
export const componentId = 'reader.scrollSpeed';
export const partKeys = ['panel', 'header', 'reset', 'slider', 'value'] as const;
const controls = ['reset', 'slider', 'value'] as const;
type Control = (typeof controls)[number];
const labelKeys = ['title', 'reset', 'slider', 'value', 'drag', 'unit'] as const;
export const configKeys = [
  'icon',
  'min',
  'max',
  'normal',
  'step',
  'order',
  'gap',
  'popup',
  'labels',
];
export interface WindowsAreaScrollSpeedConfig extends ResolvedConfig {
  icon: string;
  min: number;
  max: number;
  normal: number;
  step: number;
  order: Control[];
  gap: number;
  popup: {
    width: number;
    height: number;
    offset: number;
    gap: number;
    headerHeight: number;
    rowHeight: number;
    zIndex: number;
    thumbSize: number;
    trackSize: number;
  };
  labels: Record<(typeof labelKeys)[number], string>;
  parts: Record<(typeof partKeys)[number], ResolvedPart>;
}
export interface WindowsAreaScrollSpeedInput {
  speed: number;
  requestSpeed(speed: number): Promise<Result>;
  report(issue: DiagnosticIssue): void;
}
export function normalizeScrollSpeed(value: number, min: number, max: number, step: number) {
  const clamped = Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  return Math.max(
    min,
    Math.min(max, Number((min + Math.round((clamped - min) / step) * step).toFixed(6))),
  );
}
export function validateConfig(
  config: ResolvedConfig,
  report: ConfigReport,
): config is WindowsAreaScrollSpeedConfig {
  let valid = hasParts(config, partKeys);
  const reject: ConfigReport = (key, expected, actual) => {
    valid = false;
    report(key, expected, actual);
  };
  if (!hasActionIcon(config.icon)) reject('icon', 'registered action icon', config.icon);
  if (!finite(config.min, 1, 100) || !finite(config.max, 1, 100) || config.min >= config.max)
    reject('min', 'min < max, both 1–100 (value/10 speed)', { min: config.min, max: config.max });
  if (
    !finite(config.normal, 1, 100) ||
    (typeof config.min === 'number' && config.normal < config.min) ||
    (typeof config.max === 'number' && config.normal > config.max)
  )
    reject('normal', 'normal value within range', config.normal);
  if (!finite(config.step, 0.1, 100)) reject('step', '0.1–100 value step', config.step);
  if (
    !isNamedRecord(
      config.labels,
      labelKeys,
      (value: unknown): value is string => typeof value === 'string' && !!value.trim(),
    )
  )
    reject('labels', 'all speed-control labels', config.labels);
  const popup = config.popup;
  if (
    !isObject(popup) ||
    !finite(popup.width, 180, 600) ||
    !finite(popup.height, 80, 400) ||
    !finite(popup.offset, 0, 100) ||
    !finite(popup.gap, 0, 32) ||
    !finite(popup.headerHeight, 20, 60) ||
    !finite(popup.rowHeight, 28, 80) ||
    !finite(popup.zIndex, 11, 2000) ||
    !finite(popup.thumbSize, 8, 32) ||
    !finite(popup.trackSize, 1, 10) ||
    popup.headerHeight + popup.rowHeight + popup.gap > popup.height
  )
    reject('popup', 'bounded popup dimensions, layer and slider geometry', popup);
  if (hasParts(config, partKeys)) valid = validateConfiguredRow(config, controls, report) && valid;
  return valid;
}

// LOGIC — local optimistic controls; Reader remains the actual speed owner.
export default function WindowsAreaBtnScrollSpeed({
  config,
  input,
}: ChildProps<WindowsAreaScrollSpeedConfig, WindowsAreaScrollSpeedInput>) {
  const anchor = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const initial = normalizeScrollSpeed(input.speed * 10, config.min, config.max, config.step);
  const [value, setValue] = useState(initial),
    [draft, setDraft] = useState(String(initial));
  const currentValue = useRef(initial),
    editing = useRef(false),
    latest = useRef(input);
  latest.current = input;
  const position = useRef({ x: 0, y: 0 });
  const dragging = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(
    null,
  );
  const id = `${config.id}-panel`;
  const close = () => {
    dragging.current = null;
    editing.current = false;
    setDraft(String(currentValue.current));
    setOpen(false);
  };
  const apply = (candidate: number) => {
    const next = normalizeScrollSpeed(candidate, config.min, config.max, config.step);
    if (next === currentValue.current && Math.abs(latest.current.speed - next / 10) < 1e-6) return;
    currentValue.current = next;
    setValue(next);
    if (!editing.current) setDraft(String(next));
    void input
      .requestSpeed(next / 10)
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
      })
      .catch((error) => {
        const restored = normalizeScrollSpeed(
          latest.current.speed * 10,
          config.min,
          config.max,
          config.step,
        );
        currentValue.current = restored;
        setValue(restored);
        if (!editing.current) setDraft(String(restored));
        input.report({
          code: 'SCROLL_SPEED_UNAVAILABLE',
          expected: 'reader speed update',
          actual: errorText(error),
        });
      });
  };
  const commit = () => {
    editing.current = false;
    if (draft.trim() && Number.isFinite(Number(draft))) apply(Number(draft));
    setDraft(String(currentValue.current));
  };
  useEffect(() => {
    const next = normalizeScrollSpeed(input.speed * 10, config.min, config.max, config.step);
    currentValue.current = next;
    setValue(next);
    if (!editing.current) setDraft(String(next));
    if (Math.abs(next / 10 - input.speed) > 1e-6) apply(next);
  }, [input.speed, config.min, config.max, config.step]);

  // DRAG — move the panel, never the native window; controls are not drag handles.
  const clampPosition = () => {
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
      x: (box?.right ?? config.popup.width) - config.popup.width,
      y: (box?.bottom ?? 0) + config.popup.offset,
    };
    clampPosition();
    setOpen(true);
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
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
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    dragging.current = null;
  };
  useEffect(() => {
    if (!open) return undefined;
    clampPosition();
    field.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('resize', clampPosition);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', clampPosition);
      dragging.current = null;
    };
  }, [open, config.popup.width, config.popup.height]);

  // UI — existing MUI controls and JSON-owned visuals, one modeless portal.
  return (
    <ClickAwayListener
      onClickAway={() => {
        if (!dragging.current) close();
      }}
    >
      <Box ref={anchor} role="presentation" className="fill">
        <ActionButton
          config={config}
          icon={config.icon}
          label={config.label}
          onClick={toggle}
          expanded={open}
          {...(open ? { controls: id } : {})}
        />
        {open && (
          <Portal>
            <Box
              ref={panel}
              id={id}
              role="dialog"
              aria-modal={false}
              aria-label={config.labels.title}
              data-scroll-speed-panel
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
                  gap: `${config.popup.gap}px`,
                }}
              >
                <Box
                  data-speed-drag-handle
                  aria-label={config.labels.drag}
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
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{config.labels.title}</span>
                  <span>
                    {Number((value / 10).toFixed(2))}
                    {config.labels.unit}
                  </span>
                </Box>
                <Box sx={{ height: `${config.popup.rowHeight}px`, flexShrink: 0 }}>
                  <ConfiguredRow
                    config={config}
                    renderPart={(name, part) => {
                      if (name === 'reset')
                        return (
                          <Button
                            className="fill"
                            aria-label={config.labels.reset}
                            disableRipple
                            onClick={() => {
                              editing.current = false;
                              apply(config.normal);
                              setDraft(String(currentValue.current));
                            }}
                            sx={{ ...configuredSx(part), minWidth: 0, textTransform: 'none' }}
                          >
                            {config.labels.reset}
                          </Button>
                        );
                      if (name === 'slider')
                        return (
                          <Slider
                            aria-label={config.labels.slider}
                            min={config.min}
                            max={config.max}
                            step={config.step}
                            value={value}
                            onChange={(_event, next) => {
                              if (typeof next === 'number') apply(next);
                            }}
                            sx={{
                              ...configuredSx(part),
                              height: '100%',
                              padding: 0,
                              '& .MuiSlider-thumb': {
                                width: config.popup.thumbSize,
                                height: config.popup.thumbSize,
                              },
                              '& .MuiSlider-track, & .MuiSlider-rail': {
                                height: config.popup.trackSize,
                              },
                            }}
                          />
                        );
                      return (
                        <TextField
                          type="number"
                          size="small"
                          className="fill"
                          inputRef={field}
                          value={draft}
                          onFocus={() => {
                            editing.current = true;
                          }}
                          onChange={(event) => {
                            const text = event.target.value;
                            setDraft(text);
                            if (text.trim() && Number.isFinite(Number(text))) apply(Number(text));
                          }}
                          onBlur={commit}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commit();
                            }
                          }}
                          slotProps={{
                            htmlInput: {
                              'aria-label': config.labels.value,
                              min: config.min,
                              max: config.max,
                              step: config.step,
                              inputMode: 'decimal',
                            },
                          }}
                          sx={{
                            ...configuredSx(part),
                            '& .MuiOutlinedInput-root': {
                              height: '100%',
                              color: part.visual.colors.foreground,
                              fontFamily: part.visual.typography.family,
                              fontSize: part.visual.geometry.fontSize,
                              '& fieldset': { borderColor: part.visual.colors.border },
                            },
                          }}
                        />
                      );
                    }}
                  />
                </Box>
              </Box>
            </Box>
          </Portal>
        )}
      </Box>
    </ClickAwayListener>
  );
}
