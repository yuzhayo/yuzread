import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { errorText, isId, isObject } from './VisualConfig.ts';
import type { Diagnostics, DiagnosticIssue } from './Diagnostics.ts';
import { resolveChildren } from './ConfigValidation.ts';
import type { AcceptedNode, ResolvedArea, ResolvedConfig } from './ConfigValidation.ts';
import { parentBinding } from './ParentConnections.ts';
import type { ParentBinding, ParentPort } from './ParentConnections.ts';

// CONFIG AND CONTRACT — only area roots are globally discovered; child props stay local.
export type ConfigReport = (key: string, expected: unknown, actual: unknown) => void;
export type IssueReport = (issue: DiagnosticIssue) => void;
export interface ChildProps<C extends ResolvedConfig, I> {
  config: C;
  input: I;
}
export type ConfigValidator<C extends ResolvedConfig> = (
  config: ResolvedConfig,
  report: ConfigReport,
) => config is C;
export interface ChildMetadata {
  componentId: string;
  fileName: string;
  configKeys?: readonly string[];
  partKeys?: readonly string[];
}
export interface ChildDefinition<P> extends ChildMetadata {
  bind(
    config: ResolvedConfig,
    report: ConfigReport,
    issues: IssueReport,
  ): ((ports: P) => ReactNode) | null;
}
export interface AreaProps<P> {
  config: ResolvedArea & { nodes: AcceptedNode<P>[] };
  ports: P;
  report: IssueReport;
}
export interface BoundArea extends ParentBinding {
  config: ResolvedArea;
  render(): ReactNode;
}
export interface AreaModule {
  areaId: string;
  parentName: string;
  default: unknown;
  bind(area: ResolvedArea, presets: unknown, diagnostics: Diagnostics): BoundArea;
}
export interface AreaCatalogEntry {
  areaId: string;
  parentName: string;
  filePath: string;
  folder: string;
  valid: boolean;
  bind: AreaModule['bind'] | null;
}

export function bindChild<C extends ResolvedConfig, I, P>(
  Component: ComponentType<ChildProps<C, I>>,
  validate: ConfigValidator<C>,
  metadata: ChildMetadata,
  inputs: (ports: P, report: IssueReport) => I,
): ChildDefinition<P> {
  return {
    ...metadata,
    bind(config, report, issues) {
      if (!validate(config, report)) return null;
      const childReport: IssueReport = (issue) =>
        issues({
          ...issue,
          componentId: config.componentId,
          instanceId: config.id,
          parentId: config.parentId,
          filePath: config.filePath,
          configPath: config.configPath,
        });
      return (ports) => createElement(Component, { config, input: inputs(ports, childReport) });
    },
  };
}
export function bindArea<P extends Record<string, ParentPort>>(
  Component: ComponentType<AreaProps<P>>,
  children: ChildDefinition<P>[],
  createPorts: () => P,
): AreaModule['bind'] {
  return (area, presets, diagnostics) => {
    const ports = createPorts();
    const nodes = resolveChildren(area.children, children, area, presets, diagnostics);
    const binding = parentBinding(ports);
    return {
      ...binding,
      config: area,
      render: () =>
        createElement(Component, {
          config: { ...area, nodes },
          ports,
          report: (issue) => {
            diagnostics.report(issue);
          },
        }),
    };
  };
}
export const acceptCommonConfig: ConfigValidator<ResolvedConfig> = (
  config,
): config is ResolvedConfig => true;
function validModule(value: unknown): value is AreaModule {
  return (
    isObject(value) &&
    isId(value.areaId) &&
    typeof value.parentName === 'string' &&
    /^[A-Z][A-Za-z0-9]*$/.test(value.parentName) &&
    typeof value.default === 'function' &&
    typeof value.bind === 'function'
  );
}
export async function discoverAreas(
  loaders: Record<string, () => Promise<unknown>>,
  diagnostics: Diagnostics,
): Promise<AreaCatalogEntry[]> {
  const entries = await Promise.all(
    Object.entries(loaders).map(async ([source, load]): Promise<AreaCatalogEntry | null> => {
      const filePath = source.replace(/^\.\//, ''),
        folder = filePath.slice(0, filePath.lastIndexOf('/'));
      try {
        const module = await load();
        if (!isObject(module) || module.areaId === undefined) return null;
        if (!isId(module.areaId)) {
          diagnostics.report({
            code: 'INVALID_AREA_ID',
            filePath,
            expected: 'stable area ID',
            actual: module.areaId,
          });
          return null;
        }
        if (!validModule(module) || filePath.split('/').at(-1) !== `${module.parentName}.tsx`) {
          diagnostics.report({
            code: 'INVALID_AREA_EXPORT',
            filePath,
            expected: 'named typed area root',
            actual: module.areaId,
          });
          return {
            areaId: module.areaId,
            parentName: typeof module.parentName === 'string' ? module.parentName : '',
            filePath,
            folder,
            valid: false,
            bind: null,
          };
        }
        return {
          areaId: module.areaId,
          parentName: module.parentName,
          filePath,
          folder,
          valid: true,
          bind: module.bind,
        };
      } catch (error) {
        diagnostics.report({
          code: 'AREA_LOAD_FAILED',
          filePath,
          expected: 'loadable area root',
          actual: errorText(error),
        });
        return null;
      }
    }),
  );
  return entries
    .filter((entry): entry is AreaCatalogEntry => entry !== null)
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}
