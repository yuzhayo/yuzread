import type { ShellHost } from '../ShellHost.js';
import type { ShellDev } from './Screen.tsx';
declare global {
  interface Window {
    shellHost: ShellHost;
    shellDev?: ShellDev;
  }
}
