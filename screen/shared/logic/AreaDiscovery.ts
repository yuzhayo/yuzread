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
  configKeys?: readonly string[];
  partKeys?: readonly string[];
}
export interface ChildDefinition<P> extends ChildMetadata {
  fileName: string;
  bind(
    config: ResolvedConfig,
    report: ConfigReport,
    issues: IssueReport,
  ): ((ports: P) => ReactNode) | null;
}
export interface ChildRegistration extends ChildMetadata {
  parentName: string;
  bind(
    config: ResolvedConfig,
    report: ConfigReport,
    issues: IssueReport,
  ): ((ports: unknown) => ReactNode) | null;
}
export interface DiscoveredChild extends ChildRegistration {
  fileName: string;
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
  bind(
    area: ResolvedArea,
    presets: unknown,
    diagnostics: Diagnostics,
    children: DiscoveredChild[],
  ): BoundArea;
}
export interface AreaCatalogEntry {
  areaId: string;
  parentName: string;
  filePath: string;
  folder: string;
  valid: boolean;
  bind: ((area: ResolvedArea, presets: unknown, diagnostics: Diagnostics) => BoundArea) | null;
}

export function defineChild<C extends ResolvedConfig, I, P>(
  parentName: string,
  Component: ComponentType<ChildProps<C, I>>,
  validate: ConfigValidator<C>,
  metadata: ChildMetadata,
  acceptPorts: (value: unknown) => value is P,
  inputs: (ports: P, report: IssueReport) => I,
): ChildRegistration {
  return {
    parentName,
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
      return (ports) => {
        if (!acceptPorts(ports)) {
          childReport({
            code: 'CHILD_PORT_MISMATCH',
            expected: `compatible ${parentName} ports`,
            actual: config.componentId,
          });
          return null;
        }
        return createElement(Component, { config, input: inputs(ports, childReport) });
      };
    },
  };
}
export function bindArea<P extends Record<string, ParentPort>>(
  Component: ComponentType<AreaProps<P>>,
  createPorts: () => P,
): AreaModule['bind'] {
  return (area, presets, diagnostics, discovered) => {
    const ports = createPorts();
    const children: ChildDefinition<P>[] = discovered.map((registration) => ({
      componentId: registration.componentId,
      fileName: registration.fileName,
      ...(registration.configKeys ? { configKeys: registration.configKeys } : {}),
      ...(registration.partKeys ? { partKeys: registration.partKeys } : {}),
      bind(config, report, issues) {
        const render = registration.bind(config, report, issues);
        return render ? (parentPorts: P) => render(parentPorts) : null;
      },
    }));
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
function validChild(value: unknown): value is ChildRegistration {
  return (
    isObject(value) &&
    /^[A-Z][A-Za-z0-9]*$/.test(String(value.parentName)) &&
    isId(value.componentId) &&
    (value.configKeys === undefined ||
      (Array.isArray(value.configKeys) &&
        value.configKeys.every((key) => typeof key === 'string'))) &&
    (value.partKeys === undefined ||
      (Array.isArray(value.partKeys) && value.partKeys.every((key) => typeof key === 'string'))) &&
    typeof value.bind === 'function'
  );
}
export async function discoverAreas(
  loaders: Record<string, () => Promise<unknown>>,
  diagnostics: Diagnostics,
): Promise<AreaCatalogEntry[]> {
  const modules = await Promise.all(
    Object.entries(loaders).map(async ([source, load]) => {
      const filePath = source.replace(/^\.\//, ''),
        folder = filePath.slice(0, filePath.lastIndexOf('/'));
      try {
        const module = await load();
        return { filePath, folder, module };
      } catch (error) {
        diagnostics.report({
          code: 'AREA_LOAD_FAILED',
          filePath,
          expected: 'loadable screen module',
          actual: errorText(error),
        });
        return null;
      }
    }),
  );
  const loaded = modules.filter(
    (entry): entry is { filePath: string; folder: string; module: unknown } => entry !== null,
  );
  const registrations: { filePath: string; folder: string; child: ChildRegistration }[] = [];
  for (const entry of loaded)
    if (isObject(entry.module) && entry.module.child !== undefined) {
      if (validChild(entry.module.child))
        registrations.push({ ...entry, child: entry.module.child });
      else
        diagnostics.report({
          code: 'INVALID_CHILD_EXPORT',
          filePath: entry.filePath,
          expected: 'named parent-local child registration',
          actual: entry.module.child,
        });
    }
  const claimed = new Set<string>();
  const entries: AreaCatalogEntry[] = [];
  for (const entry of loaded) {
    const module = entry.module;
    if (!isObject(module) || module.areaId === undefined) continue;
    if (!isId(module.areaId)) {
      diagnostics.report({
        code: 'INVALID_AREA_ID',
        filePath: entry.filePath,
        expected: 'stable area ID',
        actual: module.areaId,
      });
      continue;
    }
    if (!validModule(module) || entry.filePath.split('/').at(-1) !== `${module.parentName}.tsx`) {
      diagnostics.report({
        code: 'INVALID_AREA_EXPORT',
        filePath: entry.filePath,
        expected: 'named typed area root',
        actual: module.areaId,
      });
      entries.push({
        areaId: module.areaId,
        parentName: typeof module.parentName === 'string' ? module.parentName : '',
        filePath: entry.filePath,
        folder: entry.folder,
        valid: false,
        bind: null,
      });
      continue;
    }
    const children: DiscoveredChild[] = [];
    for (const registration of registrations) {
      const inside =
        registration.filePath.startsWith(`${entry.folder}/`) &&
        registration.child.parentName === module.parentName;
      if (!inside) continue;
      const fileName = registration.filePath.slice(entry.folder.length + 1);
      if (!fileName.split('/').at(-1)?.startsWith(module.parentName) || fileName.includes('../')) {
        diagnostics.report({
          code: 'CHILD_NAME_MISMATCH',
          filePath: registration.filePath,
          expected: module.parentName,
          actual: fileName,
        });
        continue;
      }
      claimed.add(registration.filePath);
      children.push({ ...registration.child, fileName });
    }
    children.sort((a, b) => a.fileName.localeCompare(b.fileName));
    entries.push({
      areaId: module.areaId,
      parentName: module.parentName,
      filePath: entry.filePath,
      folder: entry.folder,
      valid: true,
      bind: (area, presets, sink) => module.bind(area, presets, sink, children),
    });
  }
  for (const registration of registrations)
    if (!claimed.has(registration.filePath))
      diagnostics.report({
        code: 'CHILD_OWNER_UNAVAILABLE',
        filePath: registration.filePath,
        expected: registration.child.parentName,
        actual: registration.folder,
      });
  return entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
}
