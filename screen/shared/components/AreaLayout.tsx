import { Component } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { boundsStyle, configuredSx } from '../logic/Appearance.ts';
import type { AcceptedNode, LayoutPlan, ResolvedConfig } from '../logic/ConfigValidation.ts';
import type { Diagnostics } from '../logic/Diagnostics.ts';
import type { IssueReport } from '../logic/AreaDiscovery.ts';
import ConfiguredRow from './ConfiguredRow.tsx';
import LayoutInspector from './LayoutInspector.tsx';

// LOGIC — shared frame/slot mechanics only, no feature imports or action selection.
class ChildBoundary extends Component<
  { node: ResolvedConfig; report: IssueReport; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    const node = this.props.node;
    this.props.report({
      code: 'COMPONENT_RENDER_FAILED',
      componentId: node.componentId,
      instanceId: node.id,
      parentId: node.parentId,
      filePath: node.filePath,
      configPath: node.configPath,
      expected: 'renderable child',
      actual: error.message,
    });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
export function AreaChildren<P>({
  nodes,
  ports,
  report,
}: {
  nodes: AcceptedNode<P>[];
  ports: P;
  report: IssueReport;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div
          className="shell-slot"
          key={node.config.id}
          data-instance={node.config.id}
          data-component={node.config.componentId}
          data-parent={node.config.parentId}
          data-source={node.config.filePath}
          data-drag-region={node.config.interaction?.dragRegion ?? 'no-drag'}
          style={{
            ...boundsStyle(node.config.bounds),
            pointerEvents: node.config.interaction?.pointerEvents ?? 'auto',
          }}
        >
          <ChildBoundary node={node.config} report={report}>
            {node.kind === 'child' ? (
              node.render(ports)
            ) : (
              <ConfiguredRow
                config={node.config}
                renderPart={(name) => {
                  const child = node.children.find((c) => c.config.id === name);
                  return child ? (
                    <ChildBoundary node={child.config} report={report}>
                      {child.render(ports)}
                    </ChildBoundary>
                  ) : null;
                }}
              />
            )}
          </ChildBoundary>
        </div>
      ))}
    </>
  );
}
class AreaBoundary extends Component<
  { id: string; diagnostics: Diagnostics; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.diagnostics.report({
      code: 'AREA_RENDER_FAILED',
      instanceId: this.props.id,
      expected: 'renderable area',
      actual: error.message,
    });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
// UI — generic screen frame; lower layers mount first, preserving native drag regions.
export default function AreaLayout({
  plan,
  hoveredSections,
  inspection,
  generation,
  diagnostics,
}: {
  plan: LayoutPlan;
  hoveredSections: readonly string[];
  inspection: boolean;
  generation: number;
  diagnostics: Diagnostics;
}) {
  const inspect = inspection ? plan.development : null;
  return (
    <main
      className="shell-root"
      data-ready="true"
      style={{ backgroundColor: plan.window?.background }}
    >
      {[...plan.areas]
        .sort((a, b) => a.config.zIndex - b.config.zIndex)
        .map((area) => {
          const section = area.config,
            revealed = Boolean(section.hoverVisual && hoveredSections.includes(section.id));
          const presentation =
            revealed && section.hoverVisual ? { visual: section.hoverVisual } : section;
          return (
            <Box
              component="section"
              key={`${section.id}-${generation}`}
              id={section.id}
              aria-label={section.label}
              className={`shell-section${section.draggable ? ' shell-drag' : ''}`}
              data-overlay={section.overlay}
              data-layer={section.zIndex}
              sx={{
                ...boundsStyle(section.bounds),
                ...configuredSx(presentation),
                zIndex: section.zIndex,
              }}
            >
              {inspect && <LayoutInspector node={section} settings={inspect} />}
              <AreaBoundary id={section.id} diagnostics={diagnostics}>
                {section.hoverPreset !== undefined && !revealed ? null : area.render()}
              </AreaBoundary>
            </Box>
          );
        })}
    </main>
  );
}
