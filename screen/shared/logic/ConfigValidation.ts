import {
  errorText,
  finite,
  isColor,
  isId,
  isObject,
  resolveVisuals,
  validBounds,
  visualKeys,
} from './VisualConfig.ts';
import type { Bounds, Visual } from './VisualConfig.ts';
import type { AreaCatalogEntry, BoundArea, ChildDefinition } from './AreaDiscovery.ts';
import type { Diagnostics, DiagnosticIssue } from './Diagnostics.ts';
import { compatible, connectionProblems } from './ParentConnections.ts';
import type { Connection, ParentBinding } from './ParentConnections.ts';
import type { ReactNode } from 'react';

// CONFIG AND CONTRACT — common shape only; child-specific options stay in their files.
export interface ResolvedPart {
  visual: Visual;
  size: { width: number; height: number };
  configPath: string;
}
export interface Interaction {
  pointerEvents?: 'auto' | 'none';
  dragRegion?: 'drag' | 'no-drag' | 'inherit';
}
export interface ResolvedConfig extends Record<string, unknown> {
  id: string;
  componentId: string;
  parentId: string;
  label: string;
  enabled: boolean;
  bounds: Bounds;
  visual: Visual;
  parts: Record<string, ResolvedPart>;
  configPath: string;
  filePath: string;
  interaction?: Interaction;
}
export interface ResolvedArea {
  id: string;
  parentId: string;
  folder: string;
  parentName: string;
  filePath: string;
  label: string;
  enabled: boolean;
  draggable: boolean;
  bounds: Bounds;
  overlay: boolean;
  zIndex: number;
  visual: Visual;
  hoverVisual: Visual | null;
  hoverPreset?: string;
  configPath: string;
  children: unknown[];
}
export interface ChildNode<P> {
  kind: 'child';
  config: ResolvedConfig;
  render(ports: P): ReactNode;
}
export interface RowNode<P> {
  kind: 'row';
  config: ResolvedConfig & { gap: number; order: string[] };
  children: ChildNode<P>[];
}
export type AcceptedNode<P> = ChildNode<P> | RowNode<P>;
export interface InspectionSettings {
  inspectionEnabled: boolean;
  outline: { color: string; width: number; style: 'solid' | 'dashed' | 'dotted'; offset: number };
  label: { visual: Visual; bounds: Bounds; sizing: 'content' | 'fixed' };
}
export interface LayoutPlan {
  window: { title: string; background: string } | null;
  status: { ready: string; issues: string } | null;
  areas: BoundArea[];
  connections: Connection[];
  development: InspectionSettings | null;
}
export function hasParts<P extends string>(
  config: ResolvedConfig,
  keys: readonly P[],
): config is ResolvedConfig & { parts: Record<P, ResolvedPart> } {
  return keys.every((key) => config.parts[key] !== undefined);
}
export function isNamedRecord<K extends string, V>(
  value: unknown,
  keys: readonly K[],
  accept: (value: unknown) => value is V,
): value is Record<K, V> {
  return (
    isObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => accept(value[key]))
  );
}
const duplicates = (values: unknown[]) => {
  const counts = new Map<string, number>();
  for (const v of values) if (typeof v === 'string') counts.set(v, (counts.get(v) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
};
const validFolder = (value: unknown): value is string =>
  typeof value === 'string' && value.split('/').every((part) => /^[A-Za-z][\w-]*$/.test(part));
const validInteraction = (value: unknown): value is Interaction =>
  isObject(value) &&
  Object.keys(value).every((key) => ['pointerEvents', 'dragRegion'].includes(key)) &&
  (value.pointerEvents === undefined ||
    value.pointerEvents === 'auto' ||
    value.pointerEvents === 'none') &&
  (value.dragRegion === undefined ||
    value.dragRegion === 'drag' ||
    value.dragRegion === 'no-drag' ||
    value.dragRegion === 'inherit');
const commonKeys = [
  'id',
  'componentId',
  'parentId',
  'label',
  'enabled',
  'bounds',
  'interaction',
  'parts',
  'size',
  ...visualKeys,
];
const size = (value: unknown): value is { width: number; height: number } =>
  isObject(value) &&
  Object.keys(value).length === 2 &&
  finite(value.width, 0.01, 100) &&
  finite(value.height, 0.01, 100);

// LOGIC — validate a parent's local nodes; no global feature registry or sibling policy.
export function resolveChildren<P>(
  raw: unknown[],
  definitions: ChildDefinition<P>[],
  area: ResolvedArea,
  presets: unknown,
  diagnostics: Diagnostics,
): AcceptedNode<P>[] {
  const all: unknown[] = [];
  const collect = (nodes: unknown[]) => {
    for (const node of nodes) {
      all.push(node);
      if (isObject(node) && Array.isArray(node.children)) collect(node.children);
    }
  };
  collect(raw);
  const conflicts = duplicates(all.map((node) => (isObject(node) ? node.id : undefined)));
  const duplicateDefinitions = duplicates(definitions.map((d) => d.componentId));
  const defs = new Map(
    definitions
      .filter((d) => !duplicateDefinitions.has(d.componentId))
      .map((d) => [d.componentId, d]),
  );
  const report = (
    code: string,
    path: string,
    expected: unknown,
    actual: unknown,
    meta: Omit<DiagnosticIssue, 'code'> = {},
  ) => diagnostics.report({ code, configPath: path, expected, actual, ...meta });
  for (const componentId of duplicateDefinitions)
    report(
      'DUPLICATE_CHILD_DEFINITION',
      area.configPath,
      'one discovered child registration per component ID',
      componentId,
      { componentId, parentId: area.id, filePath: area.filePath },
    );
  const resolve = (
    node: unknown,
    parentId: string,
    path: string,
    rowPart = false,
  ): AcceptedNode<P> | null => {
    if (
      !isObject(node) ||
      !isId(node.id) ||
      !isId(node.componentId) ||
      node.parentId !== parentId ||
      typeof node.label !== 'string' ||
      !node.label.trim() ||
      typeof node.enabled !== 'boolean' ||
      (rowPart ? !size(node.size) : !validBounds(node.bounds))
    ) {
      report('INVALID_CHILD', path, 'local child identity, parent and dimensions', node);
      return null;
    }
    if (conflicts.has(node.id)) {
      report('DUPLICATE_CHILD_ID', path, 'unique local child ID', node.id);
      return null;
    }
    if (node.interaction !== undefined && !validInteraction(node.interaction)) {
      report('INVALID_INTERACTION', path, 'supported pointer/drag behavior', node.interaction);
      return null;
    }
    const isRow = node.kind === 'row',
      definition = defs.get(node.componentId);
    const keys = isRow
      ? [...commonKeys, 'kind', 'children', 'order', 'gap']
      : [...commonKeys, ...(definition?.configKeys ?? [])];
    if ((isRow || definition) && Object.keys(node).some((key) => !keys.includes(key))) {
      report('UNKNOWN_CHILD_PROPERTY', path, 'declared child options', Object.keys(node));
      return null;
    }
    const filePath = isRow
      ? area.filePath
      : definition
        ? `${area.folder}/${definition.fileName}`
        : '';
    const meta = { instanceId: node.id, componentId: node.componentId, parentId, filePath };
    if (
      definition &&
      (!definition.fileName.split('/').at(-1)?.startsWith(area.parentName) ||
        definition.fileName.split('/').some((part) => part === '..'))
    ) {
      report('CHILD_NAME_MISMATCH', path, area.parentName, definition.fileName, meta);
      return null;
    }
    let visual: Visual;
    try {
      visual = resolveVisuals(node, presets);
    } catch (error) {
      report('INVALID_VISUALS', path, 'valid visual preset', errorText(error), meta);
      return null;
    }
    const parts: Record<string, ResolvedPart> = {},
      partKeys = definition?.partKeys ?? [];
    if (partKeys.length || node.parts !== undefined) {
      if (
        !isObject(node.parts) ||
        Object.keys(node.parts).length !== partKeys.length ||
        Object.keys(node.parts).some((key) => !partKeys.includes(key))
      ) {
        report('INVALID_PARTS', `${path}.parts`, partKeys, node.parts, meta);
        return null;
      }
      for (const key of partKeys) {
        const part = node.parts[key],
          partPath = `${path}.parts.${key}`;
        try {
          if (
            !isObject(part) ||
            Object.keys(part).some((k) => ![...visualKeys, 'size'].includes(k)) ||
            !size(part.size)
          )
            throw new Error('Invalid part dimensions');
          parts[key] = {
            size: part.size,
            visual: resolveVisuals(part, presets),
            configPath: partPath,
          };
        } catch (error) {
          report('INVALID_PART_SIZE', partPath, 'valid part visuals/size', errorText(error), meta);
          return null;
        }
      }
    }
    const bounds =
      rowPart && size(node.size)
        ? { x: 0, y: 0, width: node.size.width, height: node.size.height }
        : node.bounds;
    if (!validBounds(bounds)) {
      report('INVALID_CHILD_BOUNDS', path, 'valid bounds', bounds, meta);
      return null;
    }
    const config: ResolvedConfig = {
      ...node,
      id: node.id,
      componentId: node.componentId,
      parentId,
      label: node.label,
      enabled: node.enabled,
      bounds,
      visual,
      parts,
      configPath: path,
      filePath,
      ...(node.interaction !== undefined ? { interaction: node.interaction } : {}),
    };
    if (isRow) {
      if (
        rowPart ||
        !Array.isArray(node.children) ||
        !Array.isArray(node.order) ||
        !node.order.every(isId) ||
        !finite(node.gap, 0, 100)
      ) {
        report('INVALID_ROW', path, 'children, exact order and gap', node, meta);
        return null;
      }
      const rowId = node.id,
        rawChildren: unknown[] = node.children;
      const rows = rawChildren.map((child, index) =>
        resolve(child, rowId, `${path}.children[${index}]`, true),
      );
      if (rows.some((child) => !child || child.kind !== 'child')) return null;
      const children = rows.filter(
        (child): child is ChildNode<P> => child !== null && child.kind === 'child',
      );
      const order: string[] = node.order;
      if (
        order.length !== children.length ||
        new Set(order).size !== children.length ||
        order.some((id) => !children.some((child) => child.config.id === id))
      ) {
        report('INVALID_ROW_ORDER', path, 'each child exactly once', order, meta);
        return null;
      }
      const width = children.reduce((total, child) => total + child.config.bounds.width, 0);
      if (width + node.gap * Math.max(0, children.length - 1) > 100.00001) {
        report(
          'ROW_OVERFLOW',
          path,
          'row widths and gaps fit 100%',
          { width, gap: node.gap },
          meta,
        );
        return null;
      }
      for (const child of children)
        parts[child.config.id] = {
          size: { width: child.config.bounds.width, height: child.config.bounds.height },
          visual: child.config.visual,
          configPath: child.config.configPath,
        };
      return node.enabled
        ? {
            kind: 'row',
            config: { ...config, gap: node.gap, order },
            children: children.filter((child) => child.config.enabled),
          }
        : null;
    }
    if (duplicateDefinitions.has(node.componentId)) {
      report(
        'DUPLICATE_CHILD_COMPONENT',
        path,
        'unique child implementation',
        node.componentId,
        meta,
      );
      return null;
    }
    if (!definition) {
      if (node.enabled)
        report('CHILD_UNAVAILABLE', path, 'declared local child', node.componentId, meta);
      return null;
    }
    let accepted = true;
    const reject = (key: string, expected: unknown, actual: unknown) => {
      accepted = false;
      report('INVALID_COMPONENT_CONFIG', `${path}.${key}`, expected, actual, meta);
    };
    let render: ((ports: P) => ReactNode) | null = null;
    try {
      render = definition.bind(config, reject, (issue) => {
        diagnostics.report(issue);
      });
    } catch (error) {
      reject('options', 'valid child configuration', errorText(error));
    }
    if (!accepted || !render) {
      report(
        'COMPONENT_CONFIG_REJECTED',
        path,
        'child validator accepts options',
        node.componentId,
        meta,
      );
      return null;
    }
    return node.enabled || rowPart ? { kind: 'child', config, render } : null;
  };
  return raw
    .map((node, index) => resolve(node, area.id, `${area.configPath}.children[${index}]`))
    .filter((node): node is AcceptedNode<P> => node !== null);
}

export function validateScreenConfig(
  raw: unknown,
  catalog: AreaCatalogEntry[],
  diagnostics: Diagnostics,
  nativeParent: ParentBinding,
): LayoutPlan {
  const native = isObject(raw) && isObject(raw.window) ? raw.window : null;
  const plan: LayoutPlan = {
    window:
      native && typeof native.title === 'string' && typeof native.background === 'string'
        ? { title: native.title, background: native.background }
        : null,
    status: null,
    areas: [],
    connections: [],
    development: null,
  };
  const report = (code: string, path: string, expected: unknown, actual: unknown) =>
    diagnostics.report({ code, configPath: path, expected, actual });
  if (!isObject(raw) || raw.schemaVersion !== 2) {
    report(
      'INVALID_SCHEMA',
      'schemaVersion',
      'schemaVersion 2',
      isObject(raw) ? raw.schemaVersion : undefined,
    );
    return plan;
  }
  for (const key of Object.keys(raw))
    if (
      ![
        'schemaVersion',
        'window',
        'status',
        'presets',
        'areas',
        'connections',
        'development',
      ].includes(key)
    )
      report('UNKNOWN_CONFIG_PROPERTY', key, 'supported root key', key);
  if (
    isObject(raw.status) &&
    Object.keys(raw.status).length === 2 &&
    typeof raw.status.ready === 'string' &&
    raw.status.ready.trim() &&
    typeof raw.status.issues === 'string' &&
    raw.status.issues.trim()
  )
    plan.status = { ready: raw.status.ready, issues: raw.status.issues };
  else report('INVALID_STATUS', 'status', 'ready/issues labels', raw.status);
  if (isObject(raw.presets))
    for (const id of Object.keys(raw.presets)) {
      try {
        if (!isId(id)) throw new Error('Invalid preset ID');
        resolveVisuals({ preset: id }, raw.presets);
      } catch (error) {
        report('INVALID_PRESET', `presets.${id}`, 'valid preset', errorText(error));
      }
    }
  else report('INVALID_PRESETS', 'presets', 'preset object', raw.presets);
  const areas: unknown[] = Array.isArray(raw.areas) ? raw.areas : [];
  if (!Array.isArray(raw.areas)) report('INVALID_AREAS', 'areas', 'area array', raw.areas);
  const ids = duplicates(areas.map((a) => (isObject(a) ? a.id : undefined))),
    folders = duplicates(areas.map((a) => (isObject(a) ? a.folder : undefined))),
    roots = duplicates(catalog.map((entry) => entry.areaId));
  for (const id of roots) report('DUPLICATE_AREA_ROOT', 'areas', 'one root per area ID', id);
  const entries = new Map(
    catalog
      .filter((entry) => entry.valid && !roots.has(entry.areaId))
      .map((entry) => [entry.areaId, entry]),
  );
  areas.forEach((node, index) => {
    const configPath = `areas[${index}]`;
    const keys = [
      'id',
      'parentId',
      'folder',
      'label',
      'enabled',
      'draggable',
      'overlay',
      'zIndex',
      'bounds',
      'hoverPreset',
      'children',
      ...visualKeys,
    ];
    if (
      !isObject(node) ||
      !isId(node.id) ||
      node.id === 'native' ||
      node.parentId !== 'window' ||
      !validFolder(node.folder) ||
      typeof node.enabled !== 'boolean' ||
      typeof node.draggable !== 'boolean' ||
      typeof node.label !== 'string' ||
      !node.label.trim() ||
      !validBounds(node.bounds) ||
      !Array.isArray(node.children) ||
      Object.keys(node).some((key) => !keys.includes(key))
    ) {
      report('INVALID_AREA', configPath, 'area identity, geometry and children', node);
      return;
    }
    if (ids.has(node.id) || folders.has(node.folder)) {
      report('DUPLICATE_AREA', configPath, 'unique area ID/folder', node.id);
      return;
    }
    const overlay = node.overlay ?? false,
      zIndex = node.zIndex ?? 0;
    if (
      typeof overlay !== 'boolean' ||
      !Number.isInteger(zIndex) ||
      !finite(zIndex, 0, 1000) ||
      node.zIndex === null ||
      (overlay && (node.zIndex === undefined || zIndex === 0))
    ) {
      report('INVALID_AREA_LAYER', configPath, 'explicit valid overlay/layer', node);
      return;
    }
    let visual: Visual,
      hoverVisual: Visual | null = null;
    try {
      visual = resolveVisuals(node, raw.presets);
      if (node.hoverPreset !== undefined) {
        if (!isId(node.hoverPreset)) throw new Error('Invalid area hover preset');
        hoverVisual = resolveVisuals({ preset: node.hoverPreset }, raw.presets);
      }
    } catch (error) {
      report('INVALID_AREA_VISUALS', configPath, 'valid area visuals', errorText(error));
      return;
    }
    const entry = entries.get(node.id);
    if (!entry?.bind) {
      if (node.enabled)
        report('AREA_UNAVAILABLE', configPath, 'unique declared area root', node.id);
      return;
    }
    if (entry.folder !== node.folder) {
      report('FOLDER_PARENT_MISMATCH', configPath, node.folder, entry.folder);
      return;
    }
    const area: ResolvedArea = {
      id: node.id,
      parentId: node.parentId,
      folder: node.folder,
      parentName: entry.parentName,
      filePath: entry.filePath,
      label: node.label,
      enabled: node.enabled,
      draggable: node.draggable,
      bounds: node.bounds,
      overlay,
      zIndex,
      visual,
      hoverVisual,
      configPath,
      children: node.children,
      ...(typeof node.hoverPreset === 'string' ? { hoverPreset: node.hoverPreset } : {}),
    };
    try {
      const bound = entry.bind(area, raw.presets, diagnostics);
      if (node.enabled) plan.areas.push(bound);
      else bound.dispose();
    } catch (error) {
      report('AREA_CONFIG_REJECTED', configPath, 'valid area binding', errorText(error));
    }
  });
  const overlaps = new Set<string>();
  for (const [index, a] of plan.areas.entries())
    for (const b of plan.areas.slice(index + 1)) {
      const x = a.config.bounds,
        y = b.config.bounds;
      if (
        Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > 0.000001 &&
        Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) > 0.000001
      ) {
        if (
          (a.config.overlay && a.config.zIndex > b.config.zIndex) ||
          (b.config.overlay && b.config.zIndex > a.config.zIndex)
        )
          continue;
        overlaps.add(a.config.id);
        overlaps.add(b.config.id);
        report(
          'AREA_OVERLAP',
          a.config.configPath,
          'nonoverlap or explicit higher overlay',
          `${a.config.id}/${b.config.id}`,
        );
      }
    }
  plan.areas = plan.areas.filter((area) => {
    if (overlaps.has(area.config.id)) {
      area.dispose();
      return false;
    }
    return true;
  });
  const parents = new Map<string, ParentBinding>([
    ['native', nativeParent],
    ...plan.areas.map((area) => [area.config.id, area] as const),
  ]);
  const disabled = new Set(
    areas
      .filter(isObject)
      .filter((area) => area.enabled === false && typeof area.id === 'string')
      .map((area) => area.id),
  );
  const endpoint = (value: unknown): value is { area: string; port: string } =>
    isObject(value) && Object.keys(value).length === 2 && isId(value.area) && isId(value.port);
  if (!Array.isArray(raw.connections))
    report('INVALID_CONNECTIONS', 'connections', 'connection array', raw.connections);
  else
    raw.connections.forEach((connection, index) => {
      const path = `connections[${index}]`;
      if (
        !isObject(connection) ||
        Object.keys(connection).length !== 2 ||
        !endpoint(connection.from) ||
        !endpoint(connection.to)
      ) {
        report('INVALID_CONNECTION', path, 'from/to parent endpoints', connection);
        return;
      }
      if (disabled.has(connection.from.area) || disabled.has(connection.to.area)) return;
      const from = parents.get(connection.from.area)?.endpoints[connection.from.port],
        to = parents.get(connection.to.area)?.endpoints[connection.to.port];
      if (!from || !to || !compatible(from, to) || connection.from.area === connection.to.area) {
        report('CONNECTION_UNAVAILABLE', path, 'compatible distinct parent endpoints', connection);
        return;
      }
      plan.connections.push({ from: connection.from, to: connection.to });
    });
  const problems = connectionProblems(plan.connections, parents);
  plan.connections = plan.connections.filter((connection, index) => {
    const problem = problems.get(index);
    if (problem) {
      report(problem, 'connections', 'one non-cyclic provider per input', connection);
      return false;
    }
    return true;
  });
  if (raw.development !== undefined) {
    const dev = raw.development;
    try {
      if (
        !isObject(dev) ||
        Object.keys(dev).some((k) => !['inspectionEnabled', 'outline', 'label'].includes(k)) ||
        typeof dev.inspectionEnabled !== 'boolean' ||
        !isObject(dev.outline) ||
        Object.keys(dev.outline).length !== 4 ||
        !isColor(dev.outline.color) ||
        !finite(dev.outline.width, 0.1, 10) ||
        !finite(dev.outline.offset, -10, 10) ||
        (dev.outline.style !== 'solid' &&
          dev.outline.style !== 'dashed' &&
          dev.outline.style !== 'dotted') ||
        !isObject(dev.label) ||
        !validBounds(dev.label.bounds) ||
        (dev.label.sizing !== 'content' && dev.label.sizing !== 'fixed') ||
        Object.keys(dev.label).some((k) => ![...visualKeys, 'bounds', 'sizing'].includes(k))
      )
        throw new Error('Invalid inspection settings');
      plan.development = {
        inspectionEnabled: dev.inspectionEnabled,
        outline: {
          color: dev.outline.color,
          width: dev.outline.width,
          offset: dev.outline.offset,
          style: dev.outline.style,
        },
        label: {
          bounds: dev.label.bounds,
          sizing: dev.label.sizing,
          visual: resolveVisuals(dev.label, raw.presets),
        },
      };
    } catch (error) {
      report('INVALID_DEVELOPMENT_CONFIG', 'development', 'valid inspection', errorText(error));
    }
  }
  return plan;
}
