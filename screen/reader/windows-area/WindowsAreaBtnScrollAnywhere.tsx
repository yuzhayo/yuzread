import { useState } from 'react';
import ActionButton, { hasActionIcon } from '@ui/ActionButton.tsx';
import { errorText } from '@logic/VisualConfig.ts';
import { isNamedRecord } from '@logic/ConfigValidation.ts';
import { defineChild } from '@logic/AreaDiscovery.ts';
import type { ChildProps, ConfigReport } from '@logic/AreaDiscovery.ts';
import type { ResolvedConfig } from '@logic/ConfigValidation.ts';
import type { DiagnosticIssue } from '@logic/Diagnostics.ts';
import { hasRequestPort, hasStatePort } from '@logic/ParentConnections.ts';
import type { RequestPort, StatePort } from '@logic/ParentConnections.ts';
import type { Failure, ReaderScrollAnywhereState } from '../../../ShellHost.js';

// CONFIG AND CONTRACT — the latch is session-only; no preference key is declared or persisted.
export const componentId = 'reader.scrollAnywhere';
export const configKeys = ['icon', 'labels'];
const labelKeys = ['off', 'active', 'paused', 'failed'] as const;
export interface WindowsAreaScrollAnywhereConfig extends ResolvedConfig {
  icon: string;
  labels: Record<(typeof labelKeys)[number], string>;
}
export interface WindowsAreaScrollAnywhereInput {
  state: ReaderScrollAnywhereState;
  requestEnabled(enabled: boolean): Promise<ReaderScrollAnywhereState | Failure>;
  report(issue: DiagnosticIssue): void;
}
export function validateConfig(
  config: ResolvedConfig,
  report: ConfigReport,
): config is WindowsAreaScrollAnywhereConfig {
  let valid = hasActionIcon(config.icon);
  if (!valid) report('icon', 'registered action icon', config.icon);
  if (
    !isNamedRecord(
      config.labels,
      labelKeys,
      (value: unknown): value is string => typeof value === 'string' && !!value.trim(),
    )
  ) {
    valid = false;
    report('labels', 'all Scroll Anywhere labels', config.labels);
  }
  return valid;
}

// CHILD REGISTRATION — this control talks only to the native Scroll Anywhere capability.
interface WindowsAreaScrollAnywherePorts {
  setScrollAnywhere: RequestPort<boolean, ReaderScrollAnywhereState | Failure>;
  scrollAnywhere: StatePort<ReaderScrollAnywhereState>;
}
const acceptsParentPorts = (value: unknown): value is WindowsAreaScrollAnywherePorts =>
  hasRequestPort(
    value,
    'setScrollAnywhere',
    'native.reader.scroll-anywhere.input',
    'native.reader.scroll-anywhere.output',
  ) && hasStatePort(value, 'scrollAnywhere', 'native.reader.scroll-anywhere.state');
export const child = defineChild(
  'WindowsArea',
  WindowsAreaBtnScrollAnywhere,
  validateConfig,
  { componentId, configKeys },
  acceptsParentPorts,
  (ports, report) => ({
    state: ports.scrollAnywhere.getSnapshot(),
    requestEnabled: ports.setScrollAnywhere.request,
    report,
  }),
);

// UI AND LOCAL EVENTS — click toggles the latch; native state remains the visible truth.
export default function WindowsAreaBtnScrollAnywhere({
  config,
  input,
}: ChildProps<WindowsAreaScrollAnywhereConfig, WindowsAreaScrollAnywhereInput>) {
  const [busy, setBusy] = useState(false);
  const { state } = input;
  const label =
    state.reason === 'failed'
      ? config.labels.failed
      : state.enabled
        ? state.active
          ? config.labels.active
          : config.labels.paused
        : config.labels.off;
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await input.requestEnabled(!state.enabled);
      if ('ok' in result && result.ok === false) throw new Error(result.error);
    } catch (error) {
      input.report({
        code: 'SCROLL_ANYWHERE_UNAVAILABLE',
        expected: 'successful Scroll Anywhere update',
        actual: errorText(error),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <ActionButton
      config={config}
      icon={config.icon}
      label={label}
      pressed={state.enabled}
      onClick={() => void toggle()}
    />
  );
}
