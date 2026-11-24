import { createElement, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import SettingScreenSectionCard from '@ui/SettingScreenSectionCard.tsx';
import ConfiguredRow from '@ui/ConfiguredRow.tsx';
import ConfiguredValueSlider, {
  isConfiguredValueSliderSettings,
} from '@ui/ConfiguredValueSlider.tsx';
import type { ConfiguredValueSliderSettings } from '@ui/ConfiguredValueSlider.tsx';
import { configuredSx } from '@logic/Appearance.ts';
import { errorText, finite, isObject } from '@logic/VisualConfig.ts';
import { isNumberPreference, normalizeNumberPreference } from '@logic/NumberPreference.ts';
import type {
  NumberPreferenceDefinition,
  ReaderNumberSettingChange,
  Result,
} from '../../../../ShellHost.js';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';
import type { ResolvedConfig, ResolvedPart } from '@logic/ConfigValidation.ts';
import type { SettingScreenSectionCardParts } from '@ui/SettingScreenSectionCard.tsx';

// CONFIG AND CONTRACT — JSON owns the header, range, default, order, labels and unit.
const controls = ['reset', 'slider', 'value'] as const;
const labelKeys = ['reset', 'slider', 'value', 'unit'] as const;
type Control = (typeof controls)[number];
interface SmoothScrollSection {
  id: string;
  componentId: string;
  label: string;
  expanded: boolean;
  preference: NumberPreferenceDefinition;
  order: Control[];
  gap: number;
  rowHeight: number;
  slider: ConfiguredValueSliderSettings;
  labels: { reset: string; slider: string; value: string; unit: string };
  [key: string]: unknown;
}
interface SmoothScrollContext {
  owner: ResolvedConfig;
  cardParts: SettingScreenSectionCardParts;
  controlParts: Record<'reset' | 'slider' | 'value', ResolvedPart>;
  smoothDurationMs: number | null;
  requestSmoothDuration(change: ReaderNumberSettingChange): Promise<Result>;
  report(issue: DiagnosticIssue): void;
}
function accepts(config: SmoothScrollSection): config is SmoothScrollSection {
  const labels = config.labels;
  return (
    isNumberPreference(config.preference) &&
    config.preference.id === 'smoothScrollDurationMs' &&
    config.preference.min >= 100 &&
    config.preference.max <= 2000 &&
    Array.isArray(config.order) &&
    config.order.length === controls.length &&
    new Set(config.order).size === controls.length &&
    config.order.every((name) => controls.includes(name)) &&
    finite(config.gap, 0, 20) &&
    finite(config.rowHeight, 28, 80) &&
    isConfiguredValueSliderSettings(config.slider) &&
    isObject(labels) &&
    labelKeys.every((key) => typeof labels[key] === 'string' && Boolean(labels[key].trim())) &&
    Object.keys(config).every((key) =>
      [
        'id',
        'componentId',
        'label',
        'expanded',
        'preference',
        'order',
        'gap',
        'rowHeight',
        'slider',
        'labels',
      ].includes(key),
    )
  );
}
const validate = (
  config: SmoothScrollSection,
  report: (key: string, expected: unknown, actual: unknown) => void,
) => {
  if (accepts(config)) return true;
  report('sections', 'configured Smooth scroll preference and controls', config);
  return false;
};

// STATE AND COORDINATION — optimistic input follows the Reader's accepted persistent state.
function WindowsAreaSettingScreenSmoothScroll({
  config,
  context,
}: {
  config: SmoothScrollSection;
  context: SmoothScrollContext;
}) {
  const initial = normalizeNumberPreference(
    context.smoothDurationMs ?? config.preference.default,
    config.preference,
  );
  const [value, setValue] = useState(initial);
  const current = useRef(initial),
    latest = useRef(context),
    serial = useRef(0);
  latest.current = context;
  const apply = (candidate: number, reset = false) => {
    const next = normalizeNumberPreference(candidate, config.preference);
    if (!reset && next === current.current && next === latest.current.smoothDurationMs) return;
    current.current = next;
    setValue(next);
    const request = ++serial.current;
    void context
      .requestSmoothDuration({ value: next, ...(reset ? { reset: true } : {}) })
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
      })
      .catch((error) => {
        if (request !== serial.current) return;
        const restored = normalizeNumberPreference(
          latest.current.smoothDurationMs ?? config.preference.default,
          config.preference,
        );
        current.current = restored;
        setValue(restored);
        latest.current.report({
          code: 'SMOOTH_SCROLL_UNAVAILABLE',
          expected: 'persistent Reader smooth-scroll duration',
          actual: errorText(error),
        });
      });
  };
  useEffect(() => {
    const next = normalizeNumberPreference(
      context.smoothDurationMs ?? config.preference.default,
      config.preference,
    );
    current.current = next;
    setValue(next);
  }, [context.smoothDurationMs, config.preference]);
  const row = {
    ...context.owner,
    id: config.id,
    label: config.label,
    order: config.order,
    gap: config.gap,
    parts: context.controlParts,
  };

  // UI AND LOCAL EVENTS — Reset, slider and the live millisecond value fill this card's body.
  return (
    <SettingScreenSectionCard config={config} parts={context.cardParts}>
      <Box sx={{ width: '100%', height: `${config.rowHeight}px`, flexShrink: 0 }}>
        <ConfiguredRow
          config={row}
          renderPart={(name, part) => {
            if (name === 'reset')
              return (
                <Button
                  className="fill"
                  aria-label={config.labels.reset}
                  disableRipple
                  onClick={() => apply(config.preference.default, true)}
                  sx={{ ...configuredSx(part), minWidth: 0, textTransform: 'none' }}
                >
                  {config.labels.reset}
                </Button>
              );
            if (name === 'slider')
              return (
                <ConfiguredValueSlider
                  part={part}
                  settings={config.slider}
                  label={config.labels.slider}
                  min={config.preference.min}
                  max={config.preference.max}
                  step={config.preference.step}
                  value={value}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(next) => `${next} ${config.labels.unit}`}
                  getAriaValueText={(next) => `${next} ${config.labels.unit}`}
                  onChange={apply}
                />
              );
            return (
              <Box
                className="fill"
                aria-label={config.labels.value}
                data-smooth-scroll-value={value}
                sx={configuredSx(part)}
              >
                {value} {config.labels.unit}
              </Box>
            );
          }}
        />
      </Box>
    </SettingScreenSectionCard>
  );
}

export const settingSection = {
  componentId: 'reader.smoothScroll',
  validate,
  render: (config: SmoothScrollSection, context: SmoothScrollContext) =>
    accepts(config)
      ? createElement(WindowsAreaSettingScreenSmoothScroll, { config, context })
      : null,
};
