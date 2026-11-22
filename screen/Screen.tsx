import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import AreaLayout from '@ui/AreaLayout.tsx';
import { validateScreenConfig } from '@logic/ConfigValidation.ts';
import type { LayoutPlan } from '@logic/ConfigValidation.ts';
import type { AreaCatalogEntry } from '@logic/AreaDiscovery.ts';
import type { Diagnostics } from '@logic/Diagnostics.ts';
import { connectParents, retireParents } from '@logic/ParentConnections.ts';
import type { Cleanup, ParentBinding } from '@logic/ParentConnections.ts';
import type { BootstrapData } from '../ShellHost.js';

// CONFIG AND CONTRACT — screen knows parent bindings, never area implementations.
export interface ScreenInput extends ParentBinding {
  getHoveredSections(): readonly string[];
  subscribeHover(listener: () => void): () => void;
  setStatusLabels(labels: { ready: string; issues: string }): void;
}
export interface ShellDev {
  config: unknown;
  catalog: Pick<AreaCatalogEntry, 'areaId' | 'parentName' | 'filePath' | 'folder' | 'valid'>[];
  records: Diagnostics['getSnapshot'];
  flush: Diagnostics['flush'];
  snapshot(): unknown;
  inspect(enabled: boolean): void;
  reconfigure(raw: unknown): void;
}
export default function Screen({
  bootstrap,
  initialPlan,
  catalog,
  diagnostics,
  input,
}: {
  bootstrap: BootstrapData;
  initialPlan: LayoutPlan;
  catalog: AreaCatalogEntry[];
  diagnostics: Diagnostics;
  input: ScreenInput;
}) {
  const [plan, setPlan] = useState(initialPlan),
    [generation, setGeneration] = useState(0);
  const [inspection, setInspection] = useState(
    Boolean(
      bootstrap.development &&
      (bootstrap.inspectionRequested || initialPlan.development?.inspectionEnabled),
    ),
  );
  const hoveredSections = useSyncExternalStore(input.subscribeHover, input.getHoveredSections);
  const connection = useMemo<{ disconnect: Cleanup | null }>(
    () => ({ disconnect: null }),
    [plan, input],
  );
  useLayoutEffect(() => {
    const parents = new Map<string, ParentBinding>([
      ['native', input],
      ...plan.areas.map((area) => [area.config.id, area] as const),
    ]);
    connection.disconnect = connectParents(plan.connections, parents);
    if (plan.status) input.setStatusLabels(plan.status);
  }, [plan, input, connection]);
  // Child resource cleanup is passive too: do not detach its release path during
  // layout cleanup before the child has had an opportunity to release resources.
  useEffect(
    () => () => {
      if (connection.disconnect) void retireParents(plan.areas, connection.disconnect);
    },
    [plan, connection],
  );
  if (bootstrap.qa)
    window.shellDev = {
      config: structuredClone(bootstrap.config),
      catalog: catalog.map(({ areaId, parentName, filePath, folder, valid }) => ({
        areaId,
        parentName,
        filePath,
        folder,
        valid,
      })),
      records: diagnostics.getSnapshot,
      flush: diagnostics.flush,
      snapshot: () => ({ areas: plan.areas.map((area) => area.config.id), hoveredSections }),
      inspect: (enabled) => setInspection(Boolean(enabled)),
      reconfigure(raw) {
        const next = validateScreenConfig(raw, catalog, diagnostics, input);
        setPlan(next);
        setGeneration((value) => value + 1);
      },
    };
  return (
    <AreaLayout
      plan={plan}
      hoveredSections={hoveredSections}
      inspection={inspection}
      generation={generation}
      diagnostics={diagnostics}
    />
  );
}
