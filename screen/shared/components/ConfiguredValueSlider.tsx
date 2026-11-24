import type { ReactNode } from 'react';
import Slider from '@mui/material/Slider';
import { configuredSx } from '@logic/Appearance.ts';
import { finite, isObject } from '@logic/VisualConfig.ts';
import type { ResolvedPart } from '@logic/ConfigValidation.ts';

// CONFIG AND CONTRACT — shared Slider geometry; feature ranges and meanings stay outside.
export interface ConfiguredValueSliderSettings {
  thumbSize: number;
  trackSize: number;
}
export function isConfiguredValueSliderSettings(
  value: unknown,
): value is ConfiguredValueSliderSettings {
  return (
    isObject(value) &&
    Object.keys(value).length === 2 &&
    finite(value.thumbSize, 8, 32) &&
    finite(value.trackSize, 1, 10)
  );
}

// UI AND LOCAL EVENTS — one accessible controlled slider used by independent features.
export default function ConfiguredValueSlider({
  part,
  settings,
  label,
  min,
  max,
  step,
  value,
  valueLabelDisplay = 'off',
  valueLabelFormat,
  getAriaValueText,
  onChange,
}: {
  part: ResolvedPart;
  settings: ConfiguredValueSliderSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  valueLabelDisplay?: 'auto' | 'off' | 'on';
  valueLabelFormat?: (value: number, index: number) => ReactNode;
  getAriaValueText?: (value: number, index: number) => string;
  onChange(value: number): void;
}) {
  return (
    <Slider
      data-configured-value-slider
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      valueLabelDisplay={valueLabelDisplay}
      {...(valueLabelFormat ? { valueLabelFormat } : {})}
      {...(getAriaValueText ? { getAriaValueText } : {})}
      onChange={(_event, next) => {
        if (typeof next === 'number') onChange(next);
      }}
      sx={{
        ...configuredSx(part),
        height: '100%',
        padding: 0,
        '& .MuiSlider-thumb': {
          width: settings.thumbSize,
          height: settings.thumbSize,
        },
        '& .MuiSlider-track, & .MuiSlider-rail': { height: settings.trackSize },
      }}
    />
  );
}
