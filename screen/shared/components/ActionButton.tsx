import IconButton from '@mui/material/IconButton';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import MinimizeIcon from '@mui/icons-material/Remove';
import MaximizeIcon from '@mui/icons-material/CropSquare';
import RestoreIcon from '@mui/icons-material/FilterNone';
import CloseIcon from '@mui/icons-material/Close';
import { configuredSx } from '../logic/Appearance.ts';
import type { MouseEventHandler } from 'react';
import type { Visual } from '../logic/VisualConfig.ts';

const icons = {
  minimize: MinimizeIcon,
  maximize: MaximizeIcon,
  restore: RestoreIcon,
  close: CloseIcon,
  folderOpen: FolderOpenIcon,
  hourglass: HourglassTopIcon,
};
export type ActionIcon = keyof typeof icons;
export const hasActionIcon = (name: unknown): name is ActionIcon =>
  typeof name === 'string' && Object.hasOwn(icons, name);
export interface ActionButtonProps {
  config: { visual: Visual };
  icon: string;
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}

// UI — reusable MUI renderer; icons and every visual/state come from validated config.
export default function ActionButton({
  config,
  icon,
  label,
  onClick,
  disabled,
}: ActionButtonProps) {
  if (!hasActionIcon(icon)) return null;
  const Icon = icons[icon];
  const geometry = config.visual.geometry;
  return (
    <IconButton
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      disableRipple
      className="fill"
      sx={{ minWidth: 0, ...configuredSx(config) }}
    >
      <Icon
        aria-hidden="true"
        sx={{ width: `${geometry.iconWidth}cqw`, height: `${geometry.iconHeight}cqh` }}
      />
    </IconButton>
  );
}
