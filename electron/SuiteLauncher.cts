import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { discoverSuiteApplications, suiteName } from './SuiteApplications.cjs';
import { errorText, isRecord } from './WindowConfig.cjs';

// CONFIG AND CONTRACT — a short-lived suite entry, not another Electron application.
export interface SuiteLaunchPlan {
  applicationId: string;
  processName: string;
  executable: string;
  args: string[];
  cwd: string;
}
export interface SuiteLaunchResult {
  applicationId: string;
  processName: string;
  pid: number;
}

// DISCOVERY AND CONNECTIONS — the configured default and CLI select one declared app.
export function planSuiteLaunch(root: string, args: readonly string[]): SuiteLaunchPlan {
  const applications = discoverSuiteApplications(root);
  const config: unknown = JSON.parse(
    fs.readFileSync(path.join(root, 'electron/suite.json'), 'utf8'),
  );
  if (
    !isRecord(config) ||
    Object.keys(config).length !== 2 ||
    config.schemaVersion !== 1 ||
    typeof config.defaultApplicationId !== 'string' ||
    !applications.some(({ id }) => id === config.defaultApplicationId)
  )
    throw new Error('Suite default must identify one declared application');
  const flags = args.filter((argument) => argument.startsWith('--app='));
  const positional = args[0] && !args[0].startsWith('-') ? args[0] : undefined;
  if (flags.length > 1 || (flags.length && positional !== undefined))
    throw new Error('Select only one suite application');
  if (args.includes('--app')) throw new Error('Use --app=<application> to select an application');
  const selected = positional ?? flags[0]?.slice('--app='.length) ?? config.defaultApplicationId;
  const application = applications.find(({ id }) => id === selected);
  if (!application) throw new Error(`Unknown suite application: ${selected}`);
  const forwarded = (positional === undefined ? args : args.slice(1)).filter(
    (argument) => !argument.startsWith('--app='),
  );
  return {
    applicationId: application.id,
    processName: application.processName,
    executable: path.join(root, '.runtime/suite-runtime', `${application.processName}.exe`),
    args: [root, ...forwarded],
    cwd: root,
  };
}

// FORWARDING AND CLEANUP — no window, app state, IPC host or child-lifetime supervision.
export function launchSuiteApplication(plan: SuiteLaunchPlan): Promise<SuiteLaunchResult> {
  if (!fs.existsSync(plan.executable))
    return Promise.reject(
      new Error(
        'Suite runtime is missing. Run npm run build:suite-runtime after building the native code.',
      ),
    );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(plan.executable, plan.args, {
      cwd: plan.cwd,
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      if (child.pid === undefined) {
        reject(new Error('Started application did not return a process ID'));
        return;
      }
      resolve({ applicationId: plan.applicationId, processName: plan.processName, pid: child.pid });
    });
  });
}

// LIFECYCLE — dispatch once and exit; only the selected application stays alive.
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  Promise.resolve()
    .then(() => launchSuiteApplication(planSuiteLaunch(root, process.argv.slice(2))))
    .then((result) =>
      console.log(JSON.stringify({ suiteName, launcherPid: process.pid, ...result })),
    )
    .catch((error: unknown) => {
      console.error(errorText(error));
      process.exitCode = 1;
    });
}
