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
├── shared/                             Reusable UI and non-feature mechanics
│
├── reader/                             Complete standalone Reader application
│   ├── windows-area/
│   │   ├── WindowsArea.tsx             Dumb parent: placement and forwarding
│   │   ├── WindowsAreaContract.ts      Parent relay contracts and port creation
│   │   ├── WindowsAreaBtnSettingScreen.tsx Own gear/settings feature + registration
│   │   ├── WindowsAreaBtnLoad.tsx      Own Load feature + registration
│   │   ├── WindowsAreaBtnScrollSpeed.tsx Own speed feature + registration
│   │   ├── WindowsAreaBtnClose.tsx     Own Close feature + registration
│   │   ├── WindowsAreaBtnDefaultSize.tsx Own default-size feature + registration
│   │   └── WindowsAreaTitle.tsx        Retained disabled title child
│   ├── body/
│   │   ├── Body.tsx                    Dumb parent: placement and forwarding
│   │   ├── BodyContract.ts             Reader relay contracts and port creation
│   │   └── reader/
│   │       ├── BodyReader.tsx          Reader state/loading/zoom/UI + registration
│   │       ├── BodyReaderPixi.ts       Canvas/input/worker connection
│   │       ├── BodyReaderPixiWorker.ts GPU tile residency, drawing and momentum
│   │       ├── BodyReaderPixiWorkerContract.d.ts Local worker messages
│   │       └── BodyReaderPixiWorkerPolicy.ts Pure momentum calculations
│   ├── bottom-bar/
│   │   ├── BottomBar.tsx               Dumb parent: placement and forwarding
│   │   ├── BottomBarContract.ts        Navigation/status relay contracts
│   │   ├── BottomBarChapterNavigation.tsx Previous/List/Next + registration
│   │   └── BottomBarStatus.tsx         Retained disabled status child
│   └── action-bar/
│       └── ActionBar.tsx               Retained disabled empty parent
│
├── library/                            Reserved standalone Library owner
└── downloader/                         Reserved standalone Downloader owner
```

Children inherit their parent's filename prefix, not its implementation. A child
owns its own logic, UI and local state. Parents place children, pass narrow inputs,
forward events and dispose connections; they do not own child algorithms.

Reader, Library and Downloader are sibling application owners. Reader is the only
implemented application in this repository today; the Library/Downloader folders
reserve their independent UI/native boundaries for another agent. Their connection
direction is `Downloader --completed filesystem files--> Library --open CBZ--> Reader`,
with Library able to use the configured Windows CBZ opener instead. Shared mechanics
must not become a hidden application controller, and sibling apps never import one
another's implementations.

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
   `bindArea` binding. It does not import or list its children.
3. Each child exports a `defineChild` registration naming its parent, identity,
   validator and narrow required ports. Generic discovery derives its actual path.
4. Add its `areas` entry and children to `screen/config.json`. Declare any needed
   connection in the parent's `connections` data.
5. Run `npm run check:code`, build and a focused check of the new area.

No edit to `main.tsx`, `Screen.tsx` or generic discovery is needed merely to register
an area. Discovery uses a generic build-time scope and admits only declared roots.
Leaves/helpers are not global area registrations. IDs are explicit, not inferred
from filenames. A new native capability still needs its real native implementation.

To add a compatible child, add its prefixed self-registering file and configure it.
The parent, central assembler and existing siblings stay untouched. Types and
validators stay with their owner.

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

### Load button folder

The `readerOpen` child in `screen/config.json` supports:

```json
"folderPath": "",
"rememberFolder": true
```

Empty `folderPath` remembers the last successfully opened CBZ folder across restarts.
Set it to an existing folder such as `D:/Manga` to always start there; the configured
folder takes priority. `rememberFolder: false` disables remembering. Invalid/missing
folders fall back to the remembered folder or Electron's default. Cancel changes
nothing. The small native preference file is `%APPDATA%\Yuzread\load-folder.json`.

### Drag-drop CBZ

Drop **one CBZ file** from Explorer into the reader to load it directly, without a
picker. It uses the same loading/cache/geometry path and same-folder continuation
as Load. A valid replacement preserves zoom and scroll speed; invalid, multiple
or corrupt drops leave the readable book intact and show the existing status.
Windows default-file-opener registration is not installed by this feature.

### Window and pages

The window starts as the largest centered square inside the usable monitor area,
excluding the taskbar. The square button returns to that geometry on the current
monitor, not full-width maximize. The native book/Y icon and app identity remain.

The body fills the window. Hover the transparent top strip to reveal:

```text
[ Setting Screen ][ empty draggable area ][ Scroll speed ][ Open CBZ ][ Default 1:1 ][ Close ]
```

Title/minimize stay hidden; Open/default/Close retain x=85%, 89.75%, 94.5%. Leaving
the strip hides its children without shifting the reader. Alt+F4 closes the app.

### Setting Screen

The far-left gear opens a draggable, modeless **Setting Screen** with a blank header,
right-side X and section cards. Each card has a label with a collapse chevron and a
body; collapsed cards stay mounted so their content keeps its state. Card chrome is a
shared component. Smooth scroll is currently the only visible section; the empty
Display placeholder was removed. A new section supplies only its configured identity
and its own body controls.
Leaving the top hover strip, clicking outside or pressing Escape does not close it.
X hides the screen without unmounting its header/body; reopening keeps the dragged
position and body state. No second native window is created.

The settingScreen child in `screen/config.json` owns placement, popup size, header
order, labels and visuals. `reader/windows-area/WindowsAreaBtnSettingScreen.tsx` owns its
open/close, focus and drag lifecycle. Reader geometry and existing controls remain.

Smooth scroll has Reset, a 100–2000 ms slider and a live millisecond value. Its
configured 250 ms default preserves the previous wheel travel while controlling how
quickly that distance is delivered. It is separate from the 150 ms nearby-tick join
window and from the 1×–10× Scroll speed multiplier.

Smooth scroll and Scroll speed both render
`screen/shared/components/ConfiguredValueSlider.tsx`. That shared component owns MUI
Slider mechanics, accessibility and configured thumb/track geometry; each feature
still owns its value, unit, Reset, persistence and Reader operation.

### Bottom chapter navigation

Hover the bottom 4% strip to reveal **Previous / Chapter List / Next**. It is an
overlay, not a reserved footer; moving away hides the controls without shrinking
the pages. Chapter List opens a draggable, scrollable popup above the strip, using
the current reader's naturally ordered same-folder catalog and highlighting the
current chapter. Selecting a chapter navigates there; outside click/Escape closes.
The popup survives moving away from the bottom hover strip.

Previous/Next disable at the catalog boundaries or while navigating. Loaded pages
are reused; unloaded chapters use the existing authorized loader, with no new
picker. Jumps stop momentum but retain zoom and scroll speed. The controls, row
order, popup geometry and visuals belong to the chapterNavigation child in
`screen/config.json`; logic/UI live in
`reader/bottom-bar/BottomBarChapterNavigation.tsx`.

### Scroll Speed button

Click the speed icon immediately left of Load to open a small in-app panel. Drag
its title to move it; click outside or press Escape to close. Closing keeps the
selected speed. Reset, slider and numeric input share one value and apply immediately,
including to momentum already running. No page reload or worker restart occurs.

The readerScrollSpeed child in `screen/config.json` owns its preference and visuals:

```json
"preference": {
  "id": "scrollSpeed",
  "kind": "number",
  "default": 10,
  "min": 10,
  "max": 100,
  "step": 1
}
```

Speed is **value / 10**: 10=1×, 50=5×, 100=10×. The default step gives 91 values
at 0.1× increments. Numeric drafts can be typed naturally; applied speed is always
clamped/snapped, and Enter/blur commits the displayed value. Reset uses the configured
default.

Scroll speed and Smooth scroll persist across restarts in:

```text
%APPDATA%\Yuzread\reader-preferences.json
```

That file contains only user overrides. Startup validates them against the numeric
schemas in `screen/config.json` before creating the Reader worker. Reset removes an
override, allowing a later configured default to take effect. Popup sizing, part
order, styling and labels remain in their owning JSON entries.

`reader/body/reader/BodyReader.tsx` owns chapters in named sections. The first configured
3–5 pages decode before display; remaining pages prepare sequentially in the native
worker. Fixed page boxes and opening-time DPI/size keep images unchanged on resize.
Narrow pages stay naturally capped/centered in the widest-page chapter column;
narrower windows expose both horizontal edges instead of stretching images.

Its `SCROLLBAR` section owns the right-side overlay's validation, styling,
hover/drag/wheel and cleanup. There is no vertical gutter, permanent reader toolbar
or React scrolling frame loop. Page bytes use authorized chapter/catalog tokens rather than
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
Diagnostics themselves add no toolbar, GPU decoder or frame-limit change.

### Pixi GPU pages and momentum

The reader now uses **PixiJS 8.23.0/WebGL2 in one OffscreenCanvas worker for every
loaded page**, not a first-page preview. The current reader configuration is:

```json
"renderer": "pixi",
"momentum": { "enabled": true, "tickWindowMs": 150 },
"maxFPS": 0,
"tileMemoryMB": 128
```

Normal wheel ticks start immediately; same-direction ticks within 150 ms join one
continuous gesture with a smoothed target rate instead of a new impulse per notch.
Quiet input coasts/stops; opposing input brakes and reverses. Optional tickWindowMs
accepts 50–300 ms. The gain and live 1×–10× controls remain. Ctrl+wheel/Ctrl+0 keep their
zoom behavior and interrupt old momentum. Keyboard/scrollbar positioning, blur,
hidden state, picker and close also stop it. Fine pixel input is left native using
a small-delta heuristic to avoid adding a second device-inertia tail; it is not a
guaranteed mouse/touchpad classifier. `maxFPS: 0` disables the application ceiling;
drawing follows available browser/display refresh slots. Positive values 10–240
can restore a cap. Unchanged content is not redrawn and no idle animation loop runs.

Lossless 1024-pixel tiles with sampling borders stay on disk. Only a bounded working
set of visible/nearby/recent tiles becomes worker bitmaps/textures; DOM elements reserve geometry
and page names, not duplicate image pixels. The canvas is viewport-sized and only
intersecting tiles are drawn. The 128 MiB setting estimates CPU tile bitmaps plus GPU
textures, **not total app RAM or VRAM**. Visible tiles are protected even if they
exceed that nominal pool. Upload/retirement and render/staging capacity reservations
participate in the same native budget. Original
decode/cache, fixed geometry and current + next policies remain. `renderer: "dom"`
is the explicit compatibility choice, not a concurrent second rendering path.

Focused checks passed pixels/seams, cache reuse after chapter eviction, corrupt-cache
refusal/repair, scrolling/reversal at 10×, chapter navigation, zoom, resize and cleanup.
The short generated-fixture comparison reduced renderer working set from about
612 to 200 MB; app-scoped dedicated GPU memory averaged 117 MB (131 MB peak).
GPU activity during new-tile upload was higher than Pass 1, so the overall
lowest-resource goal remains **partial**. **Presented FPS and real-book performance
are not certified.** `reader-plan.md` retains that unfinished work; no full suite ran.

GPU slots now reuse exact-size storage when offscreen tiles must be replaced.
A short real-CBZ 10× reversal reduced new texture allocations **121 → 21** (about
83%), with unchanged returned page pixels and no tile-blocked updates. The 60 cap
and 128 MiB pool stay unchanged. GPU percentage/CPU-time savings are not certified:
device clock/activity varied. Results and scope are in `reader-plan.md`.

The canvas now excludes empty horizontal margins while the reader viewport remains
full size. Obsolete tile work is rechecked before decode/upload, with visible/warm
tiles protected. A short same-book check reduced cleared canvas area about **39%**
with identical pixels; GPU average was about **6.5% → 5.1%** and dedicated GPU memory
**101 → 87 MB**. These are sample results, not guaranteed savings for every book.
100%/125% DPI, zoom, narrow resize/right-edge pixels and 10× reversal checks passed.

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
ownership/reasons/validation limits, with `reader-plan.md` holding the active Pixi
migration only. Completed reader/migration/restructure plans have been removed.
The separate template snapshot at
`C:\Apps\Template\electron` is not updated automatically. Existing taskbar pins and
Chrome profiles are never modified by this work.
