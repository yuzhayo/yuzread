# Yuzread ownership and working rules

## Operator communication — "explain"

When the operator says "explain", respond briefly and clearly with:

1. **Understanding** — what the operator wants and what stays unchanged.
2. **Approach** — how to achieve it, naming the owning files/sections when useful.
3. **Expected result** — the observable outcome, not just implementation steps.

Avoid long theory, repetitive caveats or unrelated alternatives. "Explain" by
itself requests discussion, not code changes. Execute changes only when the same
request explicitly authorizes them or the operator subsequently approves them.
An explicit instruction to record a rule authorizes that documentation edit only.

## Structure must explain ownership

### Current state and why — 2026-11-22

The TypeScript migration and modular restructure are complete. Do not introduce
another architecture/migration phase before continuing the reader.

- The operator navigates by folders and filenames, not implementation. Named area
  parents and prefixed, self-contained children make each feature easy to find.
- Parents assemble/forward; children own their logic, UI and state. Parent-only
  contracts avoid sibling coupling. Shared UI and non-UI mechanics are separated
  so reusable plumbing does not become a hidden feature controller.
- Schema 2 stores areas, local children and explicit connections in one screen
  config. Generic root discovery supports new-folder + config extension without
  editing the top assembler. Duplicate providers/cycles are rejected.
- Strict TypeScript, Prettier and `npm run check:code` provide independently
  runnable type/format/ownership checks. No suppression/cast/exclusion shortcuts.
  Tooling/structure are now a stable foundation, not an ongoing feature project.
- Native Electron/OS/archive code and test maintenance are agent-owned machinery.
  Show the operator the screen feature map first; omit native/test internals unless
  requested. Do not delete that machinery merely to simplify the visible tree.

Current reader: same-folder CBZ continuation with current + next residency,
first configured 3–5 decoded pages, sequential completion,
fixed opening-time geometry/DPI, right overlay scrollbar and parent-mediated Open.
Phase 3 zoom is complete: Ctrl+wheel coalesces steps per animation frame and Ctrl+0
resets to exactly 100%. Pointer/center anchors account for the actual column origin
and native scroll bounds. Phase 4 continuation, offscreen eviction and on-demand
backward loading are complete. Phase 5 priority scheduling/shared admission is complete:
one native operation at a time, demand preempts preload between pages, and budgets
cover live/staged/retiring chapter estimates rather than one allowance per chapter.
Phase 2 is complete:
preparation requires explicit decode width and uses an authorized maximum, source/
page identities and atomic verified variants. Admission remains an estimate, not a
process-RSS/GPU-VRAM guarantee. Phase 6 opt-in diagnostics is complete and disabled
by default. All reader implementation stages are complete; the finished reader plan
has been removed. Performance targets are not certified by callback measurements.

Pinned foundation: TypeScript 6.0.3, React 19.3.1, MUI 9.5.0, Vite 8.3.8 and Electron
45.3.0. The existing MUI declaration-only compatibility repair is retained.
Historical acceptance/file maps are under `.runtime/modular-restructure-20261122-132705/`
and `.runtime/typescript-migration-20261122-115650/`; do not treat those records as
fresh verification after future changes or rerun every proof by default.

Documentation lifecycle: README is the operator feature map; AGENTS records current
ownership, reasons and working rules; the reader plan records unfinished work.
Transfer lasting decisions/status from completed task plans here, then remove the
completed standalone plans. Do not accumulate redundant planning Markdown files.

The operator navigates by filenames and folder hierarchy. Name each file after
its actual job. Organize by the thing that owns the behavior, not by technical
layers. Prefer named sections inside an owning file to scattering one feature
across many files. Do not create root `logic/`, `view/`, `components/`, `desktop/`
or `reader/` folders again.

```text
electron/                    Native app, OS integration and Electron runtime
  config.json                Native title, sizing, startup policy and icon path
  assets/                    Native app icon files
  reader/CbzArchive.cts       Reader's native archive worker and page protocol
screen/                      Everything displayed in the native window
  config.json                Schema-2 areas, local children, connections and presets
  windows-area/              Hover title bar and its controls/commands
    WindowsArea.tsx          Dumb parent: local child assembly and forwarding
    WindowsAreaBtnLoad.tsx   Own Load UI and behavior
    WindowsAreaBtnClose.tsx  Own Close UI and behavior
    WindowsAreaBtnDefaultSize.tsx  Own default-square UI and behavior
    WindowsAreaTitle.tsx     Retained disabled title child
  body/                      Main content owner
    Body.tsx                 Dumb parent: mount and forward to its reader
    reader/BodyReader.tsx    Reader UI, decoded pages, loading and scrolling
  shared/components/         Reusable UI mechanics
  shared/logic/              Reusable non-UI mechanics, no feature algorithms
tests/                       Existing checks, not application runtime code
```

## Native window boundary

All production code that directly uses Electron, Node filesystem access, OS
operations, archive workers or runtime installation belongs under `electron/`.
This includes the preload bridge, native pointer sampling, taskbar identity,
icons, diagnostics on disk and CBZ extraction. Native adapters must not import
React or screen implementation; pass explicit data across the bridge.

`electron/main.cts` composes native services and loads the screen. It combines
native and screen configuration into the existing bootstrap contract. Neither
configuration file duplicates the other owner's settings.

Keep Node integration off, context isolation and sandbox on. Validate IPC sender
and top-frame URL. Expose named capabilities only, never raw IPC or filesystem APIs.
No external navigation or child windows.

Electron is pinned to 45.3.0 from the operator-selected ZIP recorded in
`electron/electron-runtime.json`. Do not modify the shared archive/runtime to
change branding. Stable App ID is `com.yuzread.desktop`; relaunch metadata must
include this app's directory. The book/Y icon is native-only, never screen artwork.

## Screen and feature ownership

Screen presentation, UI state and interaction coordination belong in `screen/`.
Window command requests live with `screen/windows-area/`; native execution lives
in `electron/`. No screen code imports native implementations directly.

The body owns the reader. Keep reader display, state, loading/preloading
coordination and scrolling together in `screen/body/reader/BodyReader.tsx`, using
named sections. Its native counterpart is `electron/reader/CbzArchive.cts`.
Open shows the first 3–5 decoded pages, then silently finishes the whole chapter.
Speculative next prepares after current completion and publishes fully accepted
chapter pixels below it. Demand can instead publish accepted visible pages early,
using fixed boxes for the remaining pages. Resident images stay available until safely offscreen, replacement
or close. Slots reserve original aspect ratios; page insertion never shifts layout.
Loaded chapters keep one opening-time display-size/DPI snapshot. Their column
uses the widest accepted page, with uniform images and physical-pixel-rounded
heights. Window resize adds space or horizontal scrolling; it never stretches
accepted pages or automatically replaces decoded images. Explicit zoom is separate.
The ZOOM section owns one stable wheel/keyboard listener set. Mutable applied/pending
scale avoids stale React closures; rapid wheel steps are normalized/clamped as they
arrive and applied once per requested frame. No frame loop runs during ordinary
scrolling. The step grid is anchored at 1.0 so Ctrl+0 stays exact with custom steps.
Anchor capture happens immediately before scaling, using the strip's real bounding
rectangle; this includes centered margins, both scroll axes and the vertical origin.
Native bounds clamp unattainable anchors (a fitted column cannot scroll horizontally).
Ctrl+0 uses the viewport's center and supersedes pending wheel input. Replacement
retains the applied zoom but cancels queued input; blur/pagehide/unmount also cancel,
and chapter identity/liveness prevents old callbacks changing replacement state.
Zoom never prepares or replaces accepted images. Focused phase-3 evidence:
`.runtime/reader-zoom-1795341343761/result.json` covers 100%/125% DPI, native inputs,
anchors/extents/limits, image identity, zoomed resize and forced stale callbacks.
The BodyReader.tsx SCROLLBAR section owns scrollbar validation, overlay styling,
hover and drag lifecycle. Keep scrollbar-only logic changes inside that section;
colors/dimensions belong to the reader's scrollbar object in screen/config.json.
The vertical scrollbar is an absolute right-hand overlay above a full-width
native scroll viewport; never reserve a right gutter or narrow the body for it.
One native range control projects the viewport's scroll position/extent, rather
than a custom drag engine. No separate scrollbar service, timer or source file.
Native archive extraction/resize runs in a worker in the same CbzArchive.cts owner,
executing its compiled `electron-built/reader/CbzArchive.cjs` through `__filename`.
Image bytes are served only through session/index tokens, never arbitrary paths.
Preparation contract: Open supplies opening `renderWidth`, configured
`maxDecodeWidth` and `maxDecodedMB`; prepare takes `(id, index, decodeWidth, priority?)`.
Replies identify the chapter/source/page, requested width and actual bitmap size.
Parents forward preparation through version-3 contracts; Open output is version 4
and includes the authorized catalog. Chapter input/output are version 2. Parents
forward catalog/entry IDs, settings, optional priority and budget snapshots without
adding reader scheduling policy. Legacy omitted priorities default to visible
preparation/background chapter indexing; the reader sends explicit priorities.
Cache identity combines session directory, file-stat revision, ZIP entry identity
and actual width. Compact hashed filenames avoid Windows imaging path limits.
Temporary PNGs are renamed into place only after encoding/integrity/source checks.
Cache reuse and delivery verify size/SHA-256; delivery reads the verified descriptor
and closes it on completion/cancellation. Untracked, partial or corrupt files are
not accepted. Released generations cannot publish late tokens; equal concurrent
variants coalesce. Reader identity/dimension checks and monotonic accepted widths
prevent stale/equal/lower-quality work replacing accepted images.
Admission reserves chapter surfaces, retained variants, worker estimates and
granted input/decode workspace across the native reader service. It is not a
process-RSS guarantee. Do not add
resize-driven preparation or quality replacement as an implicit side effect.
Library, drawer and auto-scroll are not implemented yet.
Do not scatter reader behavior across technical-layer folders or copy Citadel.

The completed reader adaptation and its decisions are recorded here. The operator approved zoom,
automatic same-folder next-CBZ continuation and the existing dark background.
After phase 3 the operator selected current + next residency, not a permanent
previous/current/next window. Only next is prepared speculatively; earlier chapters
are re-loaded on demand when reading backward, which may wait for decode. Keep
lightweight geometry/anchor metadata, not all old images. Release the former current
only after it is no longer visible, preserving the reading anchor; never discard
visible content to force a count during short-chapter handoffs. Phase 4 implements
this behavior; the residency target is not a hard two-visible-chapter eviction rule.

### Chapter continuation — phase 4 complete

`BodyReader.tsx` owns chapter roots, current/next decisions, loading, immutable
per-chapter geometry and lifecycle in named sections. Previous chapters have no
permanent pixel/worker slot. Contiguous evicted chapter records collapse into one
height-only spacer per gap; their source/page metadata and opening geometry remain
available for on-demand backward decode. Existing visible image nodes are retained.
The session strip's width only grows to known chapter widths, never shrinks during
eviction. Each chapter keeps its own fixed-width column. Native scrolling signals
chapter crossings; IntersectionObserver detects exposed chapter/history boundaries.
There is no React or animation-frame loop for ordinary scrolling.

Capture the latest retained root origin immediately before layout changes and restore
both axes afterward. Replacing old pixels with equal-height spacers keeps the scroll
extent stable; appending below the viewport does not reset the offset. Detach
offscreen roots and restore layout/anchors before releasing their pixels/workers. Never release
a visible/current surface. Very short chapters may require more than two visible
roots to fill the viewport. Only the next chapter is speculative; previous/history
decode happens when its spacer enters the viewport. Stored source/page/dimension
identity must match before accepting a reload. Resize never re-prepares old records.

Native Open snapshots canonical same-folder regular CBZ files, deterministic natural
filename order and file-stat identities. Renderer receives only opaque catalog/entry
IDs plus display names, never paths. `reader.chapter(catalogId, entryId, options)`
opens an authorized entry without another picker; native caps/budget settings cannot
be raised relative to the catalog. New files require another Open to refresh order;
missing/changed/corrupt entries fail without replacing readable current content.

`reader.release(id)` releases either a chapter worker/token/cache or a whole catalog.
Chapter eviction retains catalog authorization for backward reload. Catalog release
retires authorization before awaiting every resident/in-flight worker/open. Repeated
worker releases share their closing promise. Neighbor metadata opens coalesce by
entry/width and are bounded; phase 5 extends this with shared priority/admission.

Open pauses/advances the old neighbor generation while retaining readable current.
Cancel resumes continuation after discarding stale candidates; successful replacement
or close retires the old catalog. Liveness/catalog/entry checks prevent stale pixels,
callbacks, errors or appends landing on another reading context. A failed next uses
the existing pointer-transparent status overlay; no new toolbar or blocking UI.

Fresh focused evidence on 2026-11-22 (not a full suite/FPS/RSS benchmark):
- `.runtime/reader-chapters-1795347611668/result.json`: authorized frozen order/caps,
  source-change and in-flight catalog retirement, early pages/current+next handoff,
  eviction/backward geometry and anchors at 100%/125% DPI, short visible chapters,
  picker cancellation/resume, replacement races and corrupt-neighbor survival.
- `.runtime/reader-zoom-1795347277218/result.json`: focused zoom regression passed.
- `.runtime/reader-phase2-proof-1795347286391/result.json`: native preparation/cache,
  source, budget and release-race regression passed.
- Three focused phase-4/schema tests, build and final `npm run check:code` passed:
  32 production files, 15 type fixtures and 19 ownership/boundary fixtures.
Some geometry/zoom/width-cache/Open-bar code is already present; inspect it before
overwriting or treating it as a skeleton. Its presence is not fresh verification.
Adopt Citadel's sizing/anchor/chapter-lifecycle concepts, not its code or all UI
features. Do not start another implementation plan for already completed slices.
Retain the correction: Citadel updates future render requests on resize
and deliberately keeps existing surfaces; it does not reload all visible pages.

### Scheduling and shared admission — phase 5 complete

The reader's PREPARATION section owns one page pump, not one busy loop per chapter.
Jobs retain opening geometry, remaining page indices, accepted images and priority.
At each accepted page boundary, demand wins over current completion and background
next. Natural DOM order never follows decode priority: offset lookup can request a
visible history tail page first without reordering page slots. Demand publishes
the accepted visible range (plus nearby initial pages) before offscreen pages finish.
Speculative next still publishes only after its chapter is fully accepted. A paused
next reuses completed pages when still in the current + next window; obsolete or
memory-displacing speculative candidates are released, not kept as a previous slot.

`CbzArchive.cts` owns the single native scheduler for every catalog/worker. Header
indexing and preparation enter its bounded priority/FIFO queue (64 waiting jobs,
one active operation). Sharp remains CPU/libvips with concurrency 1/cache disabled;
no GPU decoder, dependency upgrade or machine-wide thread-pool change was added.
Duplicate effective variants and entry/width opens coalesce; higher-priority callers
promote queued work instead of creating another decode. An active operation completes
normally unless its owner is released. IPC rejection alone is not completion: keep
the scheduler slot/grant until worker retirement/exit settles. An uncertain failed
retirement faults the queue instead of starting another decoder. Stopped failed
workers retain accepted cache/surface accounting until normal owner release.

The native service shares `maxDecodedMB`, rather than summing one allowance for each
chapter/catalog. An authorized new Open can raise the limit; it cannot shrink it
under live reservations or an active grant. Estimates include 8 MiB per archive
worker, 8 bytes per display/variant pixel (bitmap/texture allowance, including rounding),
retained variants and an exclusive grant for the active input/decode operation.
Header-only workers reserve their baseline; full chapter surfaces reserve on first
preparation. Worker replies validate/account resident estimates, and each operation
checks available shared space before buffers/decode/publication. Closing reservations
remain held until the worker termination promise actually resolves.

`ReaderBudget` replies expose the estimate/limit, active grant, active and queued job
counts. The grant is an upper allowance, not sampled allocator use. V8/Electron/OS
overhead, delayed GPU reclamation and presented frames are not certified by this
ledger; do not call it an OS process-RSS or GPU-VRAM hard cap. Priority is the typed
`demand | visible | background` contract. Runtime codecs validate optional budget and
`deferred | cancelled` failure tags; budget deferral is retryable, not a corrupt source.

Deferral keeps accepted visible pixels and reports through the existing non-blocking
status overlay, with no automatic retry loop or downscale. Demand may discard unused
staged next, then retire only completely offscreen roots to free space; immutable
history geometry and latest logical/root anchors prevent jumps even with no retained
root in the viewport. Visible/current pixels are never evicted individually to make
room. Retry follows real reclamation or a newly exposed/promoted demand. Pending
browser images are tracked separately from accepted images and have their sources
cleared during release, so stale acceptance does not retain an unowned image.

Open pauses the old pump, cancels queued native work and drops old speculative jobs;
cancel resumes valid current work. Replacement/close retire jobs, pending images,
catalogs and worker grants. Zoom is guarded by reading-context identity, allowing it
to remain usable while an offscreen-budget handoff displays only history spacers.

Fresh focused evidence (no full suite, RSS sampling or FPS benchmark):
- `.runtime/reader-scheduling-1795352726710/result.json`: actual shared 64-MB admission
  across catalogs, deferred next/readable current, safe budget handoff, tail-page
  priority and cached-next resume, early visible publication and replacement cleanup.
- `.runtime/reader-chapters-1795351831310/result.json`: phase-4 regression at 100%/125% DPI.
- `.runtime/reader-zoom-1795352348201/result.json`: zoom/input/resize/cleanup regression.
- `.runtime/reader-phase2-proof-1795352843716/result.json`: preparation/cache/source,
  budget and release-race regression after the final retirement changes.
- Four focused phase-5/schema tests, build and `npm run check:code` passed with
  32 production files, 18 type fixtures and 19 boundary/ownership fixtures.

Shared screen components belong in `screen/shared/components/` only when reused;
generic non-UI mechanics belong in the sibling `screen/shared/logic/` directory.
Keep entry files small and generic; parents assemble children without owning their
business rules. Use `// UI`, `// LOGIC` and descriptive subsection comments where
applicable. No file-per-method or speculative framework scaffolding.

## Configuration and discovery

### Reader diagnostics — phase 6 complete, development/troubleshooting only

The reader child's `diagnostics` boolean is explicitly false in `screen/config.json`;
restart after changing it. When false, no reader diagnostic log, PerformanceObserver,
diagnostic timers or ordinary-scroll RAF sampler is created. Reader/OS/GPU behavior
does not change. Existing initialPages=5 and maxDecodedMB=1536 are retained.

The BodyReader DIAGNOSTICS section owns activity-limited callback sampling, long-task
observation, image/attach timing and scroll-continuity attribution. Samples stop after
350 ms of quiet and on hidden/blur/cleanup; no React state or drawing runs per sample.
A callback gap >=25 ms is a hitch, not proof of a dropped/presented GPU frame. Long
tasks use the browser's >=50-ms API. Displacement >=2 px outside a 750-ms known-input/
layout window is an unexplained-jump heuristic. Open/zoom/layout/resize and user input
are tagged; overlapping gestures or external mutations are not perfectly attributable.
Pending batches are bounded and sent about once per second through the readerMetrics
parent port, not the generic shell/config diagnostics sink. Cleanup cancels listeners,
observers and callbacks; the final renderer batch is best effort on window shutdown.

CbzArchive owns native timing and the bounded append-only `reader-diagnostics.log` in
the app's userData directory. It distinguishes scheduler queue/work time, ZIP input
time and Sharp decode/resize/encode work from browser image decode and DOM attachment.
Native enablement independently requires literal true in enabled reader config.
Invalid metric envelopes/primitives are rejected; no caller-selected log path or raw
filesystem capability is exposed. Native log buffers are bounded at 256 records and
the existing file is capped at 4 MiB with a cap marker; it is not automatically deleted.
Filesystem failure returns a diagnostic error and never breaks reading.

Environment records include display frequency, runtime/backend and GPU feature status
after gpu-info-update where observed. The measured process RSS is explicitly labeled
main-process-only (including native workers), not total Electron/renderer/GPU memory.
ReaderBudget remains an estimate. RAF summaries are callback cadence, never advertised
as presented FPS; GPU feature enablement is not performance proof. No GPU decoder or
frame-limit override was added, and performance targets/real-book behavior remain
unverified by the fixture self-proof.

Fresh focused evidence: `.runtime/reader-diagnostics-1795356485004/result.json` passed:
disabled log/observer/RAF inactivity, native/renderer timing, a controlled hitch/long
task and 37-px unexplained jump, no false jump for known actions, unchanged pixels/
geometry and idle/pagehide cleanup. The display reported 165 Hz; this is not a 165-FPS
presentation claim. The proof accepts `--archive <real.cbz>` for a caller-supplied
read-only follow-up. Four phase-6/schema tests, build and final `check:code` passed
with 32 production files, 21 type fixtures and 19 ownership/boundary fixtures.
`.runtime/reader-scheduling-1795356602542/result.json` passed the phase-5 regression
with diagnostics disabled after the final instrumentation changes.
The reload proof waits for initial native loading/show to finish before reloading;
otherwise a test-created ERR_ABORTED can trigger an app startup-error dialog.

### Hierarchy, placement and naming contract

Ownership chain: app → native window → Screen → named area parent → named children.
The current structure specification is recorded in this file.
Area parents are dumb assemblers: they import/bind direct children, place them,
pass narrow inputs/callbacks, register/dispose connections and forward events.
They never own button decisions, reader algorithms or child business state.
Each child owns its own UI, behavior, state and config validation. Its filename
starts with the owning parent's name. Shared/entry files are explicit exceptions.
No sibling/cross-area implementation imports, including type-only imports.
Children communicate through parent-provided contracts, not globals or a broad
AppSession/ScreenState/ShellHost object. Only the bootstrap boundary reads the
bridge global. Shared modules never import feature/area implementations.

Folders name owners (`windows-area`, `body/reader`); files name jobs
(`WindowsAreaBtnLoad`, `BodyReader`, `CbzArchive`). Use PascalCase for owning UI and
behavior modules; lowercase filenames for configuration/entry documents. Keep
native source `.cts`, pure browser logic `.ts`, UI `.tsx`. Native source compiles
to `.cjs` in `electron-built/`; it is never executed through a TypeScript loader.
`ShellHost.d.ts` is the sole neutral, type-only native/screen wire contract.
Types stay in their owning file's contract section. No redundant `src/`.
Use CONFIG AND CONTRACT, LOGIC, UI AND LOCAL EVENTS, and LIFECYCLE sections as
needed inside an owning file. Do not split every method/button into another file.

WindowsArea imports its prefixed children. The default-size/Close row is shared
layout mechanics, not another feature controller. Adding a child touches its
named file, its owning parent's local binding and JSON; existing siblings remain
untouched. Adding an independent area needs only its folder/typed parent/children
and config entry, not edits to a central area list, Screen or generic discovery.
Local child assembly is intentional; application-wide manual area registries are not.

The parent owns placement of sibling blocks; blocks never position siblings.
Each block's `bounds` is relative to its area. Each internal row part's `size`
and the block's `gap` are percentages of the row's content area. JSON `order`
lists every named part exactly once. Moving/resizing a group moves its parts
together. Shared ConfiguredRow renders order/sizing; the feature supplies behavior.
Keep configuration authority for all internal visuals, not only group appearance.

Area roots export stable `areaId`, their declared parent name, and typed area binding.
Only roots are globally discovered. Children export local identity/validation and
typed props; parents bind their own children through the generic typed adapter.
Accepted config and child inputs remain correlated in a closure, without casts.
Disabled roots/children remain checked; invalid identities still conflict.
Generic validation resolves all declared part visuals before calling the feature
validator; feature-specific option/action checks stay in the feature file. A bad
part invalidates its group, not unrelated screen blocks. Unknown parts and row
overflow are errors. A component may live in an area's subfolder; the nearest
configured folder ancestor owns it. Stable IDs never depend on filenames.

Two configured areas do not need the same business controls to share assembly.
Shared primitives own only mechanics. Icon lookup belongs to the shared icon
renderer; window-native operation policy belongs to its explicit command owner.
Do not hide business logic in shared ParentConnections, layout, or a generic row.
ParentConnections is instantiated per parent scope, never a singleton event bus
or unrestricted broadcast API available to leaf controls.

The `screen/shared/` mechanics execute the JSON plan: discovery, validation, assembly,
diagnostics, inspection. Their existence is intentional. JSON is data, not a
replacement for these jobs. Do not merge or remove them solely to reduce file count.

`screen/config.json` owns layout/appearance, including bounds, layers, states,
padding, fonts, icons and hover presets. CSS owns resets, fill and drag mechanics.
Bounds are percentages of the immediate parent. Native dimensions are DIP;
font/border sizes are CSS pixels. Use MUI without a second hardcoded app palette.

Use a generic build-time area-root discovery scope, not a list of four folders.
Area IDs are explicit data, never inferred from filenames. Helper/leaf modules
do not export global area registrations. Config/ports are validated before mount.

Discover the whole catalog, detect all identity conflicts, validate, then mount.
Skip every duplicate conflict. Disabled areas/children do not mount or diagnose absent
modules, but malformed common fields/appearance and duplicate IDs remain invalid.
Reject duplicate connection providers and cycles, never silently choose the first.
Root connections are established before paint but retired in passive cleanup so
child resource releases can still traverse their parent ports. Drain in-flight
requests before detaching release paths; old cleanup must not clear new handlers.
Isolate invalid subtrees/render failures. Move controls with their file and JSON
parent/placement; update the configured folder when renaming an area.

Explicit `overlay: true` permits overlap only above lower `zIndex` layers. Sort
mounting by layer. Ordinary accidental overlaps remain invalid. Reader inherits
its body's drag region; a full-window `no-drag` exclusion cancels the top strip.

## Preserve current behavior

Startup is the largest centered square inside the work area, excluding taskbar.
The maximize-position button invokes `restoreDefault`: return to launch geometry
on the current monitor, not full-width maximize or a restore-size toggle. Native
startup and this action share the same sizing function in AppWindow.cts.
The body fills 100%. The Windows area is a transparent overlay whose configured
background/buttons reveal on hover and hide on exit without shifting body.
The title text and minimize button are hidden. Open CBZ occupies the old minimize
slot at x=85%; default-size and Close keep x=89.75% and x=94.5% respectively.
Native app title/icon/taskbar metadata remain intact; empty space stays draggable.
Read the actual strip size from screen config; do not overwrite operator edits.
Action/bottom bars and inspection remain off in normal use. Open CBZ now belongs
to the hover Windows area and requests the body-owned reader's public capability.
Reader status is a non-layout-blocking body overlay, not a permanent Open/status
row. Native scrolling has no React frame loop. Preserve current JSON placement.

## Scope and completion

The completed TypeScript/modular foundation is retained. Follow the ownership
rules in this file and preserve completed reader behavior and documented limits.
Strict checking must cover all production source, including preload, installer,
worker and disabled blocks. Do not hide errors with suppressions, `any`, false
module declarations, unchecked casts, compiler exclusions or weakened contracts.
Keep runtime JSON/IPC validation. Shared bridge declarations must check both
preload implementation and native handlers, not merely declare Window.shellHost.

Preserve unrelated work. Change only what the user requested; do not initialize
Git, add features/dependencies, update the template, or alter existing taskbar pins
without authorization. `C:\Apps\Template\electron` is a separate snapshot.

The operator explicitly rejects full-suite runs for routine shell changes. Run
`npm run check:code` for independent non-emitting type, format and ownership checks;
it never launches UI tests or rewrites files. `npm run check` retains its existing
test-suite meaning. Build and perform only focused behavior checks for the actual
change. Do not repeatedly run unrelated proofs. Report actual observations and
unverified limits honestly. TypeScript/Prettier are pinned development tooling.

`electron/prepare-types.cts` is a version-guarded, declaration-only MUI 9.5.0
compatibility repair for Fade/Collapse easing inheritance. It preserves their
declared prop types and all runtime files, backs up originals in `.runtime/`, and
runs during setup/runtime preparation. Do not replace it with `skipLibCheck` or
general-purpose dependency edits. Review it before changing the MUI version.

After runtime changes, normally close only positively identified Yuzread instances,
launch the updated app and leave it running. Never kill unrelated apps or modify
Chrome profiles. Generated native code is `electron-built/`, generated UI is
`screen-built/`, and runtime artifacts are `.runtime/`. Do not edit generated code.
