// LOGIC — reject invalid native dimensions instead of silently replacing configuration.
export interface WindowConfig {
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  startup?: 'normal' | 'maximized' | 'vertical' | 'square';
  background: string;
  icon?: string;
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
function assertWindowConfig(config: unknown): asserts config is WindowConfig {
  if (!isRecord(config)) throw new Error('config.window is required');
  const keys = [
    'title',
    'width',
    'height',
    'minWidth',
    'minHeight',
    'startup',
    'background',
    'icon',
  ];
  if (Object.keys(config).some((key) => !keys.includes(key)))
    throw new Error('Unsupported config.window property');
  if (typeof config.title !== 'string' || !config.title.trim() || config.title.length > 200)
    throw new Error('config.window.title must be nonempty text');
  for (const key of ['width', 'height', 'minWidth', 'minHeight']) {
    const value = config[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 320 || value > 16384)
      throw new Error(`config.window.${key} must be an integer between 320 and 16384 DIP`);
  }
  if (
    typeof config.width !== 'number' ||
    typeof config.height !== 'number' ||
    typeof config.minWidth !== 'number' ||
    typeof config.minHeight !== 'number'
  )
    throw new Error('Invalid native dimensions');
  if (config.minWidth > config.width || config.minHeight > config.height)
    throw new Error('Minimum window size cannot exceed initial size');
  if (
    config.startup !== undefined &&
    (typeof config.startup !== 'string' ||
      !['normal', 'maximized', 'vertical', 'square'].includes(config.startup))
  )
    throw new Error('config.window.startup must be normal, maximized, vertical or square');
  if (typeof config.background !== 'string' || !/^#[\da-f]{6}$/i.test(config.background))
    throw new Error('config.window.background must be a six-digit hex color');
  if (
    config.icon !== undefined &&
    (typeof config.icon !== 'string' ||
      !/^electron\/assets\/[A-Za-z0-9][\w.-]*\.(ico|png)$/i.test(config.icon))
  ) {
    throw new Error('window icon must name an ICO/PNG file inside electron/assets/');
  }
}
export function validateWindowConfig(config: unknown): WindowConfig {
  assertWindowConfig(config);
  return config;
}
