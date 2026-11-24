import fs from 'node:fs';
import path from 'node:path';
import type {
  NumberPreferenceDefinition,
  ReaderPreferenceSnapshot,
  Result,
} from '../../ShellHost.js';

// CONFIG AND CONTRACT — config declares schemas; the disk file contains overrides only.
const preferenceId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][A-Za-z0-9]{0,63}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
function numberPreference(value: unknown): value is NumberPreferenceDefinition {
  return (
    record(value) &&
    Object.keys(value).length === 6 &&
    preferenceId(value.id) &&
    value.kind === 'number' &&
    finite(value.default) &&
    finite(value.min) &&
    finite(value.max) &&
    finite(value.step) &&
    value.min < value.max &&
    value.step > 0 &&
    value.default >= value.min &&
    value.default <= value.max
  );
}

// LOGIC AND CALCULATIONS — discover explicit declarations and normalize on their step grid.
export function collectNumberPreferences(raw: unknown): Map<string, NumberPreferenceDefinition> {
  const found = new Map<string, NumberPreferenceDefinition>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!record(value)) return;
    if (value.preference !== undefined) {
      if (!numberPreference(value.preference)) throw new Error('Invalid number preference schema');
      if (found.has(value.preference.id))
        throw new Error(`Duplicate preference schema: ${value.preference.id}`);
      found.set(value.preference.id, value.preference);
    }
    for (const [key, child] of Object.entries(value)) if (key !== 'preference') visit(child);
  };
  visit(raw);
  return found;
}
export function normalizeNumberPreference(value: number, schema: NumberPreferenceDefinition) {
  const clamped = Math.max(schema.min, Math.min(schema.max, value));
  return Math.max(
    schema.min,
    Math.min(
      schema.max,
      Number(
        (schema.min + Math.round((clamped - schema.min) / schema.step) * schema.step).toFixed(9),
      ),
    ),
  );
}

// STATE AND COORDINATION — one serialized writer coalesces rapid slider updates.
export function createReaderPreferences(directory: string, config: unknown) {
  const schemas = collectNumberPreferences(config);
  const filePath = path.join(directory, 'reader-preferences.json');
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const overrides = new Map<string, number>();
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (record(parsed) && parsed.version === 1 && record(parsed.values))
      for (const [id, value] of Object.entries(parsed.values)) {
        const schema = schemas.get(id);
        if (schema && finite(value)) overrides.set(id, normalizeNumberPreference(value, schema));
      }
  } catch (error) {
    if (!record(error) || error.code !== 'ENOENT')
      console.warn('Ignoring invalid Reader preferences');
  }
  let dirty = false;
  let writing: Promise<void> | null = null;
  const overrideRecord = () =>
    Object.fromEntries([...overrides.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const write = async () => {
    dirty = true;
    if (!writing)
      writing = (async () => {
        while (dirty) {
          dirty = false;
          const text = `${JSON.stringify({ version: 1, values: overrideRecord() }, null, 2)}\n`;
          await fs.promises.mkdir(directory, { recursive: true });
          try {
            await fs.promises.writeFile(temporaryPath, text, { encoding: 'utf8', flag: 'w' });
            await fs.promises.rename(temporaryPath, filePath);
          } catch (error) {
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
            throw error;
          }
        }
      })().finally(() => {
        writing = null;
      });
    await writing;
  };
  const snapshot = (): ReaderPreferenceSnapshot => ({
    version: 1,
    values: Object.fromEntries(
      [...schemas.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, schema]) => [id, overrides.get(id) ?? schema.default]),
    ),
  });
  const update = async (request: unknown): Promise<Result> => {
    if (!record(request) || !preferenceId(request.id) || !('value' in request))
      return { ok: false, error: 'Invalid Reader preference update' };
    const schema = schemas.get(request.id);
    if (!schema) return { ok: false, error: 'Unknown Reader preference' };
    if (request.value === null) overrides.delete(request.id);
    else if (finite(request.value))
      overrides.set(request.id, normalizeNumberPreference(request.value, schema));
    else return { ok: false, error: 'Invalid Reader preference value' };
    try {
      await write();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Reader preference could not be saved',
      };
    }
  };
  return {
    filePath,
    snapshot,
    update,
    async flush() {
      if (dirty) await write();
      else if (writing) await writing;
    },
  };
}
