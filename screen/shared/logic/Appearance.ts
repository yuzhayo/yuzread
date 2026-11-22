import { mergeVisual } from './VisualConfig.ts';
import type { Bounds, Visual, VisualState } from './VisualConfig.ts';
import type { SystemStyleObject, Theme } from '@mui/system';

// UI — translate validated JSON, never invent a palette or component sizing.
export function appearance(visual: Visual): SystemStyleObject<Theme> {
  const { colors: c, geometry: g, typography: t, content: p } = visual;
  return {
    backgroundColor: c.background,
    color: c.foreground,
    borderColor: c.border,
    borderWidth: `${g.borderWidth}px`,
    borderStyle: g.borderStyle,
    borderRadius: `${g.radius}px`,
    outlineColor: c.outline,
    outlineWidth: `${g.outlineWidth}px`,
    outlineStyle: g.outlineStyle,
    outlineOffset: `${g.outlineOffset}px`,
    paddingInline: `${g.paddingX}cqw`,
    paddingBlock: `${g.paddingY}cqh`,
    fontFamily: t.family,
    fontWeight: t.weight,
    fontSize: `${g.fontSize}px`,
    lineHeight: g.lineHeight,
    letterSpacing: `${g.letterSpacing}px`,
    opacity: g.opacity,
    boxShadow: g.shadow,
    transition: `background-color ${g.transitionMs}ms, color ${g.transitionMs}ms`,
    display: 'flex',
    alignItems: p.verticalAlign,
    justifyContent: p.horizontalAlign,
    textAlign: p.textAlign,
    whiteSpace: p.whiteSpace,
    overflow: p.overflow,
  };
}

export function configuredSx(
  node: { visual: Visual },
  state?: VisualState,
): SystemStyleObject<Theme> {
  const patch = state ? node.visual.states?.[state] : undefined;
  const visual = patch ? mergeVisual(node.visual, patch) : node.visual;
  const states: Record<string, SystemStyleObject<Theme>> = {};
  const selectors: [VisualState, string][] = [
    ['hover', '&:hover'],
    ['active', '&:active'],
    ['focusVisible', '&:focus-visible, &.Mui-focusVisible'],
    ['disabled', '&.Mui-disabled'],
  ];
  for (const [name, selector] of selectors) {
    const patch = visual.states?.[name];
    if (patch) states[selector] = appearance(mergeVisual(visual, patch));
  }
  return { ...appearance(visual), ...states };
}

export function boundsStyle(bounds: Bounds) {
  return {
    left: `${bounds.x}%`,
    top: `${bounds.y}%`,
    width: `${bounds.width}%`,
    height: `${bounds.height}%`,
  };
}
