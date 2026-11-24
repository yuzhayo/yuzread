import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from './WindowConfig.cjs';

// CONFIG AND CONTRACT — each sibling declares its identity in its own local folder.
export interface SuiteApplication {
  kind: 'yuzread.application.v1';
  id: string;
  processName: string;
  appId: string;
  userDataFolder: string;
  screenConfig: string;
  windowConfig: string;
  iconAccent: string;
  iconGlyph: 'book' | 'shelves' | 'download';
}
export const suiteName = 'Yuzread';
export function isSuiteApplication(value: unknown): value is SuiteApplication {
  return (
    isRecord(value) &&
    Object.keys(value).length === 9 &&
    value.kind === 'yuzread.application.v1' &&
    typeof value.id === 'string' &&
    /^[a-z][a-z0-9-]{0,31}$/.test(value.id) &&
    value.processName === `yuzread-${value.id}` &&
    typeof value.appId === 'string' &&
    /^com\.yuzread\.[a-z][a-z0-9.]{0,63}$/.test(value.appId) &&
    typeof value.userDataFolder === 'string' &&
    /^Yuzread[A-Za-z0-9]*$/.test(value.userDataFolder) &&
    typeof value.screenConfig === 'string' &&
    /^screen\/(?:[a-z][a-z0-9-]*\/)?config\.json$/.test(value.screenConfig) &&
    typeof value.windowConfig === 'string' &&
    /^electron\/(?:[a-z][a-z0-9-]*\/)?config\.json$/.test(value.windowConfig) &&
    typeof value.iconAccent === 'string' &&
    /^#[0-9a-f]{6}$/i.test(value.iconAccent) &&
    ['book', 'shelves', 'download'].includes(String(value.iconGlyph))
  );
}

// DISCOVERY AND VALIDATION — scoped declarations only; no handwritten application list.
export function discoverSuiteApplications(root: string): SuiteApplication[] {
  const directory = path.join(root, 'electron');
  const applications = fs
    .globSync('*/application.json', { cwd: directory })
    .sort()
    .map((file) => {
      const value: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      if (!isSuiteApplication(value) || path.dirname(file) !== value.id)
        throw new Error(`Invalid application declaration: electron/${file}`);
      if (
        value.screenConfig !==
          (value.id === 'reader' ? 'screen/config.json' : `screen/${value.id}/config.json`) ||
        value.windowConfig !==
          (value.id === 'reader' ? 'electron/config.json' : `electron/${value.id}/config.json`)
      )
        throw new Error(`Application configuration crosses ownership: ${value.id}`);
      return value;
    });
  if (!applications.length) throw new Error('No suite applications were declared');
  for (const key of ['id', 'processName', 'appId', 'userDataFolder'] as const) {
    const values = new Set<string>();
    for (const application of applications) {
      if (values.has(application[key]))
        throw new Error(`Duplicate application ${key}: ${application[key]}`);
      values.add(application[key]);
    }
  }
  return applications;
}

// LAUNCH CONNECTION — branded EXEs select their own role; development has an explicit flag.
export function selectSuiteApplication(
  applications: SuiteApplication[],
  executable: string,
  args: readonly string[],
): SuiteApplication {
  const executableName = path.basename(executable, '.exe').toLowerCase();
  const executableRole = applications.find(
    (application) => application.processName === executableName,
  );
  const flags = args.filter((argument) => argument.startsWith('--app='));
  if (flags.length > 1) throw new Error('Only one application role may be selected');
  const requested = flags[0]?.slice('--app='.length);
  if (executableRole && requested !== undefined && requested !== executableRole.id)
    throw new Error('A branded executable cannot launch another application role');
  const role = executableRole?.id ?? requested ?? 'reader';
  const application = applications.find((candidate) => candidate.id === role);
  if (!application) throw new Error(`Unknown suite application: ${role}`);
  return application;
}

// CONFIGURATION CONNECTION — one existing palette, separate application layouts.
export function loadSuiteScreenConfiguration(
  root: string,
  application: SuiteApplication,
): Record<string, unknown> {
  const shared: unknown = JSON.parse(
    fs.readFileSync(path.join(root, 'screen/config.json'), 'utf8'),
  );
  const local: unknown = JSON.parse(
    fs.readFileSync(path.join(root, application.screenConfig), 'utf8'),
  );
  if (
    !isRecord(shared) ||
    !isRecord(shared.presets) ||
    !isRecord(local) ||
    !isRecord(local.presets)
  )
    throw new Error('Screen configuration and shared appearance presets must be objects');
  return { ...local, presets: { ...shared.presets, ...local.presets } };
}
