import Box from '@mui/material/Box';
import { boundsStyle, configuredSx } from '../logic/Appearance.ts';
import type { InspectionSettings } from '../logic/ConfigValidation.ts';

// UI — development-only overlay, with no pointer interception or independent palette.
export default function LayoutInspector({
  node,
  settings,
}: {
  node: { id: string; parentId: string; componentId?: string; filePath?: string; folder?: string };
  settings: InspectionSettings;
}) {
  const outline = settings.outline;
  return (
    <Box
      aria-hidden="true"
      className="layout-inspector"
      data-inspection={node.id}
      sx={{
        outline: `${outline.width}px ${outline.style} ${outline.color}`,
        outlineOffset: `${outline.offset}px`,
      }}
    >
      <Box
        component="span"
        data-inspection-label={node.id}
        sx={{
          position: 'absolute',
          ...boundsStyle(settings.label.bounds),
          ...configuredSx(settings.label),
          ...(settings.label.sizing === 'content' ? { height: 'auto' } : {}),
        }}
      >
        {node.id} · {node.componentId ?? 'section'} · {node.parentId} ·{' '}
        {node.filePath ?? node.folder}
      </Box>
    </Box>
  );
}
