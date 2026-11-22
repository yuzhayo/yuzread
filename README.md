# Yuzread

Standalone Electron + React + MUI CBZ reader. Start with `start.cmd`, or `npm ci`
then `npm start`. Development setup requires Node.js 22.12+ and dev dependencies.

## Feature map — start here

```text
screen/
├── main.tsx                          Bootstrap and native boundary adapters
├── Screen.tsx                        Dumb parent: assemble discovered areas/connections
├── config.json                       Appearance and schema-2 area/child hierarchy
├── environment.d.ts                  Bridge and optional QA declarations
├── index.html
├── styles.css                        Reset, fill and drag mechanics
│
├── windows-area/
│   ├── WindowsArea.tsx                Parent: child layout and forwarding
│   ├── WindowsAreaBtnLoad.tsx         Own Load logic, validation and UI behavior
│   ├── WindowsAreaBtnClose.tsx        Own Close logic, validation and UI behavior
│   ├── WindowsAreaBtnDefaultSize.tsx  Own return-to-default logic and UI behavior
│   └── WindowsAreaTitle.tsx           Retained disabled title child
│
├── body/
│   ├── Body.tsx                       Parent: mount/connect its reader
│   └── reader/
│       └── BodyReader.tsx             Own reader state, loading, zoom, UI and SCROLLBAR
│
├── action-bar/
│   └── ActionBar.tsx                  Disabled empty area parent
└── bottom-bar/
    ├── BottomBar.tsx                  Disabled area parent
    └── BottomBarStatus.tsx            Own status UI behavior
```

Children inherit their parent's filename prefix, not its implementation. A child
owns its own logic, UI and local state. Parents place children, pass narrow inputs,
forward events and dispose connections; they do not own child algorithms.

Siblings never import, call or inspect one another. Open follows:

```text
WindowsAreaBtnLoad → WindowsArea → Screen → Body → BodyReader
```

The reader's native requests return through Body/Screen to the restricted bridge.
Reader phase/count return upward and then downward to Load. Close/default-size
also go through WindowsArea and Screen. Feature files never read bridge/QA globals
or receive a global app session. Native execution remains in `electron/`.

The former `WindowControls` group survives only as configured row layout with its
original slot/part identities. There is no separate group feature controller.

## Shared tools — not feature controllers

```text
screen/shared/
├── components/
│   ├── ActionButton.tsx               Shared icon-button renderer
│   ├── ConfiguredRow.tsx              Shared configured row mechanics
│   ├── AreaLayout.tsx                 Generic area frames, slots and failure isolation
│   └── LayoutInspector.tsx            Development-only visual inspection
└── logic/
    ├── Appearance.ts                  Convert validated appearance to styles
    ├── VisualConfig.ts                Generic visual validation, presets and types
    ├── AreaDiscovery.ts               Automatic root discovery and typed child binding
    ├── ConfigValidation.ts            Hierarchy, layout and connection validation
    ├── Diagnostics.ts                 Structured issue collection/deduplication
    └── ParentConnections.ts           Parent-scoped ports, forwarding and cleanup
```

Shared tools cannot import area implementations or contain reader/button policy.
There is no global event bus or shared child registry. State snapshots and request
handlers belong to each parent's scope. Retiring scopes wait for pending requests;
their release routes remain available through child resource cleanup.

## Add a new area

1. Add its folder with a named parent and prefixed children, for example
   `screen/tools-area/ToolsArea.tsx` and `ToolsAreaFirstControl.tsx`.
2. The parent exports stable `areaId`, `parentName`, default component and typed
   `bindArea` binding. It uses `bindChild` to connect its own children and validators.
3. Add its `areas` entry and children to `screen/config.json`. Declare any needed
   connection in the parent's `connections` data.
4. Run `npm run check:code`, build and a focused check of the new area.

No edit to `main.tsx`, `Screen.tsx` or generic discovery is needed merely to register
an area. Discovery uses a generic build-time scope and admits only declared roots.
Leaves/helpers are not global area registrations. IDs are explicit, not inferred
from filenames. A new native capability still needs its real native implementation.

To add a child, add its prefixed file, bind it in its owning parent and configure
it. Existing siblings stay untouched. Types and validators stay with their owner.

## Configuration

`screen/config.json` uses schema version 2:

- `areas` owns area identity, folder, geometry, layers, hover and local `children`.
- Children own their appearance/options. A `kind: "row"` group owns order/gap and
  child sizes; it is layout, not button behavior.
- `connections` explicitly links named parent ports. Requests have one provider;
  state inputs have one source. Duplicates and cycles are rejected, not first-wins.
- `presets`, `status` and `development` keep their existing appearance authority.
- Disabled areas retain their configuration; their links are inactive. Missing or
  incompatible active endpoints are diagnosed. Invalid groups/areas stay isolated.

Bounds are percentages of the immediate parent. Row sizes/gaps are percentages of
the row. Native dimensions are DIP; fonts/borders are CSS pixels. Runtime JSON
validation remains necessary even with TypeScript. Restart after changing JSON;
rebuild after changing or adding modules. Native settings remain in
`electron/config.json`, not duplicated in screen config.

## Current window and reader behavior

The window starts as the largest centered square inside the usable monitor area,
excluding the taskbar. The square button returns to that geometry on the current
monitor, not full-width maximize. The native book/Y icon and app identity remain.

The body fills the window. Hover the transparent top strip to reveal:

```text
[ empty draggable area ][ Open CBZ ][ Default 1:1 ][ Close ]
```

Title/minimize stay hidden; Open/default/Close retain x=85%, 89.75%, 94.5%. Leaving
the strip hides its children without shifting the reader. Alt+F4 closes the app.

`body/reader/BodyReader.tsx` owns chapters in named sections. The first configured
3–5 pages decode before display; remaining pages prepare sequentially in the native
worker. Fixed page boxes and opening-time DPI/size keep images unchanged on resize.
Narrow pages stay naturally capped/centered in the widest-page chapter column;
narrower windows expose both horizontal edges instead of stretching images.

Its `SCROLLBAR` section owns the right-side overlay's validation, styling,
hover/drag/wheel and cleanup. There is no vertical gutter, permanent reader toolbar
or React scrolling frame loop. Page bytes use session/index tokens rather than
arbitrary paths. Cancel/failed initial replacement keeps the current chapter.

Phase 2 is complete: bitmap decode width is explicit and separate from the fixed
page box. Native preparation validates widths/identities and budgets, publishes
complete verified cache variants, and rejects stale work. Equal/lower-quality
completions do not replace accepted images. There is no resize-triggered decode.

Phase 3 is complete: Ctrl+wheel zooms around the pointer with coalesced input;
Ctrl+0 resets to 100% around the viewport center. Configured defaults are 0.5–3.0
with 0.1 steps. Native scroll bounds still apply, and accepted images stay unchanged.

Phase 4 is complete: continue automatically through CBZ files in the opened folder
in natural filename order (chapter 2 before chapter 10), without another picker.
Current finishes first, then next prepares silently and is appended below.
Old images/workers release only after leaving the viewport; lightweight size records
preserve scrolling and allow on-demand reload when reading backward. There is no
permanent previous slot. Visible short chapters are never dropped to force a count.
Failed next/replacement leaves the readable chapter intact.

Phase 5 is complete: one priority queue lets visible/backward demand interrupt
speculative next between pages. Still-needed preload resumes without decoding
accepted pages again. A shared native memory budget covers resident/staged/retiring
chapter estimates; insufficient space defers preload instead of stretching images
or throwing away visible pages. These are admission estimates, not a process-RSS
or GPU-VRAM guarantee. Decode remains Sharp/CPU, not a new GPU backend.

Phase 6 is complete: development/troubleshooting diagnostics are **off by default**.
To collect a trace, set the reader child's `diagnostics` to `true` in
`screen/config.json`, then restart. The log is:

```text
%APPDATA%\Yuzread\reader-diagnostics.log
```

It records queue/image/attachment timing, main-process RSS, callback hitches and
unexplained scroll movement. Batches/file size are bounded; idle sampling stops.
Return the flag to `false` for normal reading. RAF cadence is not presented FPS,
main-process RSS is not total app/VRAM usage, and real-book performance is not certified.
No toolbar, GPU decoder or frame-limit change was added.

## Agent-owned machinery

`electron/` handles native execution; `tests/` handles verification. You normally
work from the screen feature map above. Native/tooling details, current decisions
and their reasons live in `AGENTS.md`, not another standalone completed plan.

`electron-built/` and `screen-built/` are generated output; do not edit them.
`.runtime/` holds local backups and evidence, not editable application source.

## Independent checks

From `C:\Apps\yuzread`:

```text
npm run check:code
```

This checks strict screen/native/tools types, read-only Prettier formatting, full
production coverage, parent naming/import directions, shared/leaf boundaries,
known global access and suppression/cast bypasses. Positive/negative fixtures
verify the intended contracts. It does not launch the app or rewrite files.

Separate commands: `typecheck`, `format:check`, `check:contracts`. `npm run format`
is the explicit write command. `npm run build` checks types/boundaries and builds
both owners. `npm run check` retains its original full test/UI-suite meaning;
do not use it as the routine static code check.

Checks cannot certify all prose rules or all behavior. Review the few parent files
for accidental business logic and use focused runtime evidence for changed behavior.

Documentation is kept to `README.md` for the feature map and `AGENTS.md` for current
ownership/reasons/validation limits. Completed reader/migration/restructure plans
have been removed. The separate template snapshot at
`C:\Apps\Template\electron` is not updated automatically. Existing taskbar pins and
Chrome profiles are never modified by this work.
