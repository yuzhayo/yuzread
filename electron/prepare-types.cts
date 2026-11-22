import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from './WindowConfig.cjs';

// CONFIG AND CONTRACT — development-only repair of pinned upstream declarations.
// MUI 9.5.0 Fade/Collapse override optional easing with an explicit undefined, but
// inherit the incompatible Partial<EasingProps>. Exclude the overridden property;
// every declared prop type stays unchanged. No JavaScript or runtime asset is edited.
const root = path.resolve(__dirname, '..');
const mui = path.join(root, 'node_modules', '@mui', 'material');
const info: unknown = JSON.parse(fs.readFileSync(path.join(mui, 'package.json'), 'utf8'));
if (!isRecord(info) || info.version !== '9.5.0')
  throw new Error('Review MUI declaration repair before changing pinned 9.5.0');
const repairs = [
  {
    name: 'Fade/Fade',
    before: "extends Omit<TransitionProps, 'children'>",
    after: "extends Omit<TransitionProps, 'children' | 'easing'>",
  },
  {
    name: 'Collapse/Collapse',
    before: "extends StandardProps<TransitionProps, 'timeout'>",
    after: "extends StandardProps<TransitionProps, 'timeout' | 'easing'>",
  },
];
for (const repair of repairs)
  for (const extension of ['d.ts', 'd.mts']) {
    const relative = `${repair.name}.${extension}`,
      file = path.join(mui, relative);
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes(repair.after)) continue;
    if (source.split(repair.before).length !== 2)
      throw new Error(`Unexpected MUI declaration: ${relative}`);
    const backup = path.join(root, '.runtime', 'type-declaration-backup', 'mui-9.5.0', relative);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
    fs.writeFileSync(file, source.replace(repair.before, repair.after));
    console.log(`Repaired MUI declaration ${relative}; original: ${backup}`);
  }
