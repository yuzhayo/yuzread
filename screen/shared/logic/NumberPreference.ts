import type { NumberPreferenceDefinition } from '../../../ShellHost.js';
import { isObject } from './VisualConfig.ts';

// CONFIG AND CONTRACT — reusable numeric preference schema, independent of any feature.
export function isNumberPreference(value: unknown): value is NumberPreferenceDefinition {
  return (
    isObject(value) &&
    Object.keys(value).length === 6 &&
    typeof value.id === 'string' &&
    /^[a-z][A-Za-z0-9]{0,63}$/.test(value.id) &&
    value.kind === 'number' &&
    typeof value.default === 'number' &&
    Number.isFinite(value.default) &&
    typeof value.min === 'number' &&
    Number.isFinite(value.min) &&
    typeof value.max === 'number' &&
    Number.isFinite(value.max) &&
    typeof value.step === 'number' &&
    Number.isFinite(value.step) &&
    value.min < value.max &&
    value.step > 0 &&
    value.default >= value.min &&
    value.default <= value.max
  );
}

// LOGIC AND CALCULATIONS — clamp and snap around the configured minimum.
export function normalizeNumberPreference(value: number, config: NumberPreferenceDefinition) {
  const clamped = Math.max(
    config.min,
    Math.min(config.max, Number.isFinite(value) ? value : config.default),
  );
  return Math.max(
    config.min,
    Math.min(
      config.max,
      Number(
        (config.min + Math.round((clamped - config.min) / config.step) * config.step).toFixed(9),
      ),
    ),
  );
}
