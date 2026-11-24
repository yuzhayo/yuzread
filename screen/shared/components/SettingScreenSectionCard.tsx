import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { configuredSx } from '@logic/Appearance.ts';
import type { ResolvedPart } from '@logic/ConfigValidation.ts';

// CONFIG AND CONTRACT — shared collapsible chrome; each feature supplies its own body.
export interface SettingScreenSectionCardConfig {
  id: string;
  label: string;
  expanded: boolean;
}
export interface SettingScreenSectionCardParts {
  card: ResolvedPart;
  header: ResolvedPart;
  body: ResolvedPart;
}

// UI AND LOCAL EVENTS — collapse hides the mounted body without discarding feature state.
export default function SettingScreenSectionCard({
  config,
  parts,
  children,
}: {
  config: SettingScreenSectionCardConfig;
  parts: SettingScreenSectionCardParts;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(config.expanded);
  useEffect(() => setExpanded(config.expanded), [config.id, config.expanded]);
  return (
    <Box
      data-setting-section={config.id}
      sx={{
        ...configuredSx(parts.card),
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        width: '100%',
        flexShrink: 0,
      }}
    >
      <Box
        component="button"
        type="button"
        data-setting-section-header
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        sx={{
          ...configuredSx(parts.header),
          width: '100%',
          flexShrink: 0,
          font: 'inherit',
          cursor: 'pointer',
          textAlign: 'inherit',
          justifyContent: 'space-between',
        }}
      >
        <Box
          component="span"
          sx={{ minWidth: 0, flex: '1 1 auto', textAlign: parts.header.visual.content.textAlign }}
        >
          {config.label}
        </Box>
      </Box>
      <Box
        data-setting-section-body
        hidden={!expanded}
        sx={{
          ...configuredSx(parts.body),
          display: expanded ? 'flex' : 'none',
          width: '100%',
          flex: '0 1 auto',
          minHeight: 0,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
