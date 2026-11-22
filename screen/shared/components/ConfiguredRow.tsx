import Box from '@mui/material/Box';
import { configuredSx } from '../logic/Appearance.ts';
import { finite } from '../logic/VisualConfig.ts';
import type { ReactNode } from 'react';
import type { ResolvedConfig, ResolvedPart } from '../logic/ConfigValidation.ts';
import type { ConfigReport } from '../logic/AreaDiscovery.ts';
export interface RowConfig<P extends string> extends ResolvedConfig {
  order: P[];
  gap: number;
  parts: Record<P, ResolvedPart>;
}

// LOGIC — common row contract. Feature owners supply their named parts and behavior.
export function validateConfiguredRow(
  config: ResolvedConfig,
  partKeys: readonly string[],
  report: ConfigReport,
): boolean {
  let valid = true;
  if (
    !Array.isArray(config.order) ||
    config.order.length !== partKeys.length ||
    new Set(config.order).size !== partKeys.length ||
    config.order.some((name) => !partKeys.includes(name))
  ) {
    report('order', 'each named part exactly once', config.order);
    valid = false;
  }
  const width = partKeys.reduce((total, name) => total + (config.parts[name]?.size.width ?? 0), 0);
  if (
    !finite(config.gap, 0, 100) ||
    width + config.gap * Math.max(0, partKeys.length - 1) > 100.00001
  ) {
    report('gap', 'part widths plus parent-relative gaps fit within 100%', {
      width,
      gap: config.gap,
    });
    valid = false;
  }
  return valid;
}

// UI — JSON order, internal dimensions, appearance and gap. No native operations.
export default function ConfiguredRow<P extends string>({
  config,
  renderPart,
}: {
  config: RowConfig<P>;
  renderPart: (name: P, part: ResolvedPart) => ReactNode;
}) {
  return (
    <Box role="group" aria-label={config.label} className="fill" sx={configuredSx(config)}>
      <Box
        className="fill"
        sx={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'nowrap',
          alignItems: config.visual.content.verticalAlign,
          justifyContent: config.visual.content.horizontalAlign,
          columnGap: `${config.gap}%`,
          position: 'relative',
          containerType: 'size',
        }}
      >
        {config.order.map((name) => {
          const part = config.parts[name];
          return (
            <Box
              key={name}
              data-part={name}
              sx={{
                position: 'relative',
                flexShrink: 0,
                minWidth: 0,
                width: `${part.size.width}%`,
                height: `${part.size.height}%`,
                containerType: 'size',
              }}
            >
              {renderPart(name, part)}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
