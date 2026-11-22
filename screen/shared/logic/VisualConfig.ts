// LOGIC — JSON appearance contract. This module has no browser or framework dependency.
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Visual {
  colors: { background: string; foreground: string; border: string; outline: string };
  geometry: {
    paddingX: number;
    paddingY: number;
    radius: number;
    borderWidth: number;
    borderStyle: 'solid' | 'dashed' | 'dotted' | 'none';
    outlineWidth: number;
    outlineStyle: 'solid' | 'dashed' | 'dotted' | 'none';
    outlineOffset: number;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    opacity: number;
    shadow: string;
    transitionMs: number;
    iconWidth: number;
    iconHeight: number;
  };
  typography: { family: string; weight: number };
  content: {
    horizontalAlign: 'flex-start' | 'center' | 'flex-end';
    verticalAlign: 'flex-start' | 'center' | 'flex-end';
    textAlign: 'left' | 'center' | 'right';
    whiteSpace: 'normal' | 'nowrap' | 'pre-wrap';
    overflow: 'hidden' | 'visible' | 'auto';
  };
  states?: Partial<Record<VisualState, VisualPatch>>;
}
export type VisualState = 'hover' | 'active' | 'focusVisible' | 'disabled' | 'error';
export type VisualPatch = {
  [K in 'colors' | 'geometry' | 'typography' | 'content']?: Partial<Visual[K]>;
} & { preset?: string; states?: Partial<Record<VisualState, VisualPatch>> };
export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const isId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z][\w.-]*$/.test(value);
export const isColor = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(transparent|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|(?:rgb|hsl)a?\([\d.,% /-]+\))$/i.test(value);
export const visualKeys = ['preset', 'colors', 'geometry', 'typography', 'content', 'states'];
export const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === 'string' && choices.some((choice) => choice === value);
export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function mergeObjects(base: object, override: object): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw new Error(`Unsupported key: ${key}`);
    const prior = result[key];
    result[key] = isObject(value) && isObject(prior) ? mergeObjects(prior, value) : value;
  }
  return result;
}

const choices =
  (...values: string[]) =>
  (value: unknown) =>
    oneOf(value, values);
const number = (min: number, max: number) => (value: unknown) => finite(value, min, max);
const text = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 300 &&
  !/[;{}]/.test(value);
const fields: Record<string, Record<string, (value: unknown) => boolean>> = {
  colors: { background: isColor, foreground: isColor, border: isColor, outline: isColor },
  geometry: {
    paddingX: number(0, 50),
    paddingY: number(0, 50),
    radius: number(0, 200),
    borderWidth: number(0, 20),
    borderStyle: choices('solid', 'dashed', 'dotted', 'none'),
    outlineWidth: number(0, 20),
    outlineStyle: choices('solid', 'dashed', 'dotted', 'none'),
    outlineOffset: number(-20, 20),
    fontSize: number(8, 96),
    lineHeight: number(1, 4),
    letterSpacing: number(-5, 20),
    opacity: number(0, 1),
    shadow: text,
    transitionMs: number(0, 2000),
    iconWidth: number(1, 100),
    iconHeight: number(1, 100),
  },
  typography: {
    family: text,
    weight: (value) => Number.isInteger(value) && finite(value, 100, 900),
  },
  content: {
    horizontalAlign: choices('flex-start', 'center', 'flex-end'),
    verticalAlign: choices('flex-start', 'center', 'flex-end'),
    textAlign: choices('left', 'center', 'right'),
    whiteSpace: choices('normal', 'nowrap', 'pre-wrap'),
    overflow: choices('hidden', 'visible', 'auto'),
  },
};
const stateNames = ['hover', 'active', 'focusVisible', 'disabled', 'error'];

export function validateVisualPatch(
  value: unknown,
  partial = true,
  path = 'visual',
): asserts value is VisualPatch {
  if (!isObject(value)) throw new Error(`${path}: expected an object`);
  for (const key of Object.keys(value))
    if (!visualKeys.includes(key)) throw new Error(`${path}.${key}: unsupported property`);
  if (value.preset !== undefined && !isId(value.preset))
    throw new Error(`${path}.preset: expected a stable preset ID`);
  for (const [group, validators] of Object.entries(fields)) {
    const part = value[group];
    if (part === undefined && partial) continue;
    if (!isObject(part)) throw new Error(`${path}.${group}: required object`);
    for (const key of Object.keys(part))
      if (!Object.hasOwn(validators, key))
        throw new Error(`${path}.${group}.${key}: unsupported property`);
    for (const [key, validate] of Object.entries(validators)) {
      if (part[key] === undefined && partial) continue;
      if (!validate(part[key]))
        throw new Error(`${path}.${group}.${key}: missing or invalid value`);
    }
  }
  if (value.states !== undefined) {
    if (!isObject(value.states)) throw new Error(`${path}.states: expected an object`);
    for (const [state, patch] of Object.entries(value.states)) {
      if (
        !stateNames.includes(state) ||
        !isObject(patch) ||
        Object.keys(patch).some((key) => !Object.hasOwn(fields, key))
      ) {
        throw new Error(`${path}.states.${state}: unsupported state or property`);
      }
      validateVisualPatch(patch, true, `${path}.states.${state}`);
    }
  }
}

export function resolveVisuals(node: object, presets: unknown): Visual {
  const resolve = (value: unknown, visited: Set<string>): Record<string, unknown> => {
    validateVisualPatch(value);
    let inherited: Record<string, unknown> = {};
    if (value.preset !== undefined) {
      if (!isObject(presets) || !Object.hasOwn(presets, value.preset))
        throw new Error(`Unknown preset: ${value.preset}`);
      if (visited.has(value.preset)) throw new Error(`Circular preset: ${value.preset}`);
      inherited = resolve(presets[value.preset], new Set([...visited, value.preset]));
    }
    const { preset, ...patch } = value;
    return mergeObjects(inherited, patch);
  };
  const data: Record<string, unknown> = { ...node };
  const visual = resolve(
    Object.fromEntries(
      visualKeys.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]),
    ),
    new Set(),
  );
  assertVisual(visual);
  return visual;
}

// The complete field table above validates every required leaf before this narrowing.
function assertVisual(value: unknown): asserts value is Visual {
  validateVisualPatch(value, false);
}
export function mergeVisual(base: Visual, patch: VisualPatch): Visual {
  const visual = mergeObjects(base, patch);
  assertVisual(visual);
  return visual;
}

export function validBounds(bounds: unknown): bounds is Bounds {
  return (
    isObject(bounds) &&
    Object.keys(bounds).length === 4 &&
    finite(bounds.x, 0, 100) &&
    finite(bounds.y, 0, 100) &&
    finite(bounds.width, 0.01, 100) &&
    finite(bounds.height, 0.01, 100) &&
    bounds.x + bounds.width <= 100.000001 &&
    bounds.y + bounds.height <= 100.000001
  );
}
