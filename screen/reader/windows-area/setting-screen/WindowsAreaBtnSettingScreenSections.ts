import type { ReactNode } from 'react';
import { isObject } from '@logic/VisualConfig.ts';
import type { ConfigReport } from '@logic/AreaDiscovery.ts';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';
import type { ResolvedConfig, ResolvedPart } from '@logic/ConfigValidation.ts';
import type { ReaderNumberSettingChange, Result } from '../../../../ShellHost.js';
import type { SettingScreenSectionCardParts } from '@ui/SettingScreenSectionCard.tsx';

// CONFIG AND CONTRACT — Setting Screen discovers declarations only inside its local folder.
export interface WindowsAreaSettingSection {
  id: string;
  componentId: string;
  label: string;
  expanded: boolean;
  [key: string]: unknown;
}
export interface WindowsAreaSettingSectionContext {
  owner: ResolvedConfig;
  cardParts: SettingScreenSectionCardParts;
  controlParts: Record<'reset' | 'slider' | 'value', ResolvedPart>;
  smoothDurationMs: number | null;
  requestSmoothDuration(change: ReaderNumberSettingChange): Promise<Result>;
  report(issue: DiagnosticIssue): void;
}
export interface WindowsAreaSettingSectionDefinition {
  componentId: string;
  validate(config: WindowsAreaSettingSection, report: ConfigReport): boolean;
  render(config: WindowsAreaSettingSection, context: WindowsAreaSettingSectionContext): ReactNode;
}
const definition = (value: unknown): value is WindowsAreaSettingSectionDefinition =>
  isObject(value) &&
  typeof value.componentId === 'string' &&
  typeof value.validate === 'function' &&
  typeof value.render === 'function';

// LOGIC AND CALCULATIONS — reject duplicate local identities instead of choosing one.
export function discoverSettingSections(modules: Record<string, unknown>) {
  const result = new Map<string, WindowsAreaSettingSectionDefinition>();
  for (const module of Object.values(modules)) {
    if (!isObject(module) || !definition(module.settingSection)) continue;
    if (result.has(module.settingSection.componentId))
      throw new TypeError(`Duplicate Setting Screen section: ${module.settingSection.componentId}`);
    result.set(module.settingSection.componentId, module.settingSection);
  }
  return result;
}
