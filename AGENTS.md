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

Current reader: Pixi GPU page drawing and worker-owned wheel momentum, with
same-folder CBZ continuation and current + next residency,
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
by default. All six original reader implementation stages are complete; their
finished plan was removed. The newly requested Pixi rendering migration is planned
separately below. Performance targets are not certified by callback measurements.

Pinned foundation: TypeScript 6.0.3, React 19.3.1, MUI 9.5.0, Vite 8.3.8 and Electron
45.3.0. The existing MUI declaration-only compatibility repair is retained.
Historical acceptance/file maps are under `.runtime/modular-restructure-20261122-132705/`
and `.runtime/typescript-migration-20261122-115650/`; do not treat those records as
fresh verification after future changes or rerun every proof by default.

Documentation lifecycle: README is the operator feature map; AGENTS records current
ownership, reasons and working rules; the reader plan records unfinished work.
Transfer lasting decisions/status from completed task plans here, then remove the
completed standalone plans. Do not accumulate redundant planning Markdown files.

### Connected mouse-wheel gesture — current input behavior

The operator approved grouping nearby mouse-wheel ticks to remove the per-notch
bump. BodyReaderPixi sends normalized coarse-wheel distance and a monotonic event
timestamp aligned across window/worker with performance.timeOrigin. The worker/
pure policy own one gesture: same-direction ticks within momentum.tickWindowMs
(default 150, valid 50–300) update a smoothed rate rather than add sharp impulses.
First input responds immediately; the window never batches/delays its start.
Velocity blends over 40 ms, with 20-ms opposing-direction braking. Quiet input uses
the persistent Smooth scroll duration (configured default 250 ms, valid 100–2000).
Changing duration rescales active rate/velocity while bounded signed distance credit preserves the
1.5 gain/about 180 px per 120-unit notch and prevents runaway remaining travel.
Reversal drops old-direction credit while retaining current velocity/position;
speed changes scale velocity/rate/credit together. Tile waits do not spend credit.

Stop/zoom/picker/blur/hidden/boundaries clear gesture state; no idle sensor timer.
Keep precision small-delta/reduced-motion/direct inputs separate to avoid double
touchpad inertia. The duration UI/persistence does not reintroduce an FPS ceiling.
The previous impulse helper remains a pure historical baseline, not the active
worker controller. This supersedes earlier instructions to keep impulse math fixed.

check:code, screen build, seven targeted motion/config tests and both existing
Pixi/speed checks passed. New reference ripple 2.49–2.82% versus old 24.8–26.9%,
same about-179-px isolated/about-3599-px 20-tick travel across 60/120/165 schedules.
Live worker/input: 3.35% ripple, 3599 px travel, precision no-tail and live speed
scaling passed (.runtime/scroll-speed-1795424156769/result.json).
.runtime/reader-pixi-1795424201391/result.json covers pixels, chapter/zoom/resize/
cleanup. These are waveform/functional checks, not universal feel/presented-FPS
certification. reader-plan.md holds the tasklist and pending operator comparison.

### Latest pacing decision — ceiling disabled for operator comparison

The operator reports micro-breaks versus Citadel and explicitly requests disabling
the 60-FPS ceiling. Current reader JSON maxFPS=0 and omission default to uncapped
worker requestAnimationFrame pacing (browser/display VSync still applies). This
supersedes the earlier 60-update preference below; do not restore a cap without an
operator request. Zero bypasses deadline gating; positive 10–240 values remain valid
if the operator later chooses a cap. Keep the current joined-gesture behavior, tile pool, culling, crop,
resource reuse, obsolete-work checks and idle stopping unchanged. No GPU clock or
global VSync override. The 60 cap on a 165-Hz display is a possible pacing cause,
not a proven explanation for all reported micro-breaks. Operator feel comparison
is pending; callback/frame-setting changes do not certify presented FPS.
Fresh check:code, screen build, three focused uncapped/capped/momentum tests and
Pixi interaction smoke passed (.runtime/reader-pixi-1795420618547/result.json).
No new benchmark/full suite, GPU global override, commit or push was performed.

### Resource optimization — 2026-11-23, historical 60-update target

The earlier operator preference was a 60-update ceiling and the lowest practical CPU/GPU/RAM/
VRAM without loss of resolution, colors, geometry or smooth scrolling. That ceiling
is now disabled as recorded above. Do not blindly force WebGL alpha:false. Pass 1 added
deadline-based maxFPS=60, per-tile culling, unchanged-frame skipping and bounded
position publication. Pass 2 keeps single-level lossless 1024-pixel PNG disk tiles
with one-pixel sampling borders and bounded visible/nearby/recent bitmap+texture
residency. Tile mode does not reserve full chapter surfaces. Legacy whole-page PNG
preparation remains supported; Sharp stays CPU/libvips, concurrency 1/cache disabled.

reader JSON tileMemoryMB=128 is a nominal estimate for CPU tile bitmaps plus GPU
textures, not total app RAM/VRAM. Visible tiles are never sacrificed to force it.
The same shared native admission owner reserves pool capacity plus 16 MiB staging
before background native decoding starts, avoiding competition with its exclusive
workspace grant. Actual framebuffer/render-worker overhead is additional in that
same ledger; capacity reservation is not sampled memory. Lookahead starts two
screens ahead/one behind, expands up to four ahead for fast movement, and loads
nearest demand/directional tiles first. At most two full tile uploads per admitted
update; cold-tile waiting preserves momentum instead of decaying it or jumping ahead.

CbzArchive owns catalog-scoped verified manifests/PNG tiles. Catalog/page/width
tokens survive chapter-worker eviction; reload validates/reuses the same disk files.
Retired chapter descriptors may draw nearby tiles through that bounded pool, not a
permanent previous-chapter surface slot. Catalog release revokes authorization,
awaits active and already-closing workers and deletes its owned cache. Source changes
or corrupt files are refused. Full-page .png tokens intentionally return 404 in
tile mode. Preload/parent adapters validate optional tile data; renderer validates
exact URLs, ordered coverage/dimensions and source identity.

Tile-load failures preserve the last complete framebuffer and report non-blocking
status rather than closing the canvas. Explicit input retries; successful drawing
clears the issue. Initial/navigation warming uses the actual destination rectangle.
Fixed page boxes, zoom/speed, current+next policy and short-visible-chapter protection
remain unchanged. No dependency, title/sizing/control placement or Load folder changed.

Functional/static verdict PASS; overall resource/presentation verdict PARTIAL.
The short paired 1× fixture measured draw updates 165.05 → 60.20/sec, renderer working
set 612.21 → 200.32 MB and GPU-process working set 551.42 → 118.28 MB. Working sets
are not unique total RAM/VRAM. Current app-scoped dedicated GPU memory averaged
117.26 MB (130.66 MB peak); old VRAM/CPU baselines were not collected. GPU busiest-
engine average was 13.66% before, 7.75% in Pass 1 and 17.47% with tile streaming;
the upload tradeoff remains unresolved. Final GPU was at 210–217 MHz/P8/about 7 W;
old runs did not capture clock state. Do not claim every resource decreased or
that this reproduces the operator's real-book 50% workload.

check:code, both builds and seven focused math/contract tests passed. Evidence:
.runtime/reader-resource-pass2-final-1795410370169/result.json (1×, idle zero, tile
failure/framebuffer retention/retry), .runtime/reader-resource-pass2-final-fast-
1795410078963/result.json (10× reversal, zero tile-blocked updates),
.runtime/reader-phase2-proof-1795410422444/result.json (legacy plus lossless seams,
worker-eviction reuse, corruption repair and catalog cleanup),
.runtime/reader-pixi-1795410100734/result.json and
.runtime/chapter-navigation-1795410208028/result.json (chapter/zoom/resize/cleanup).
Initial fixture screenshot pixels matched the old screenshot exactly. No full suite,
prolonged benchmark, real-book/presented-FPS or GPU-loss certification. reader-plan.md
retains unfinished acceptance; no commit/push without an operator request.

GPU upload follow-up, same day: BodyReaderPixiWorker reuses an exact-size owned
ImageSource GPU texture only when tile eviction is already required. It closes the
old bitmap, transfers that single slot through existing staging accounting, updates
frame/UVs and uses source.update()/texSubImage2D. Different dimensions are not reused.
Equal rank-5/distant victims prefer matching storage before LRU; visible/nearby
priorities/order do not change. No spare pool, native/dependency/memory-limit/global
GPU-setting change. Failed/cancelled transferred resources are destroyed; ordinary
retirement still destroys owned surfaces. Keep this private to the reader worker.

The read-only real-book Episode 1 of 66,666 Years: Advent of the Dark Mage (168 pages,
initial 800×1000) measured 1× cold/warm GPU averages 6.71%/6.82% with 43 MB/zero
uploads. At 10× reversal, new allocations fell 121 → 21 (about 83%), deletions
104 → 2 and 101 updates reused storage. Zero tile-blocked updates/idle redraws.
Do not claim CPU upload-time savings (177.5 → 193.4 ms) or GPU-percent savings
(7.21% → 1.92%): clocks changed 270 → 915–1980 MHz and device activity varied.
Final dedicated GPU memory averaged 136.25 MB, peak 136.63 MB; resident tile estimate
was about 123.3 MiB. Process/driver memory is not guaranteed by that estimate.

Final mixed-size fixture: 17 allocations/242 updates, unchanged returned seam/
viewport pixels and successful failure/retry. Real returned pixels matched too.
Fresh check:code, screen build, seven math/contract tests and Pixi smoke passed.
Evidence: .runtime/reader-resource-real-reuse-final-1795412590982/result.json,
.runtime/reader-resource-reuse-final-1795412530884/result.json and
.runtime/reader-pixi-1795412703490/result.json; before/cold references are in the
existing reader-plan.md. The existing resource test supports --archive, --warm-replay
and --verify-reuse; no new proof app, library scan or full suite. Overall presented-
frame/resource acceptance remains partial.

Actual-work follow-up, same day: bridge/worker now crop horizontal empty canvas
margins, not page pixels. Full logical viewport/geometry stays authoritative. The
bridge caches the widest strip (including history) on layout changes; there is no
page-box scan per ordinary scroll. Crop bounds include a physical sampling pixel
and are DPR-grid aligned. Integer CSS dimensions plus a compositor matrix avoid
fractional-DPI layout quantization. Only matching rendered-frame feedback applies
the crop. Serialized resize waits for current required tiles and participates in
graceful disposal; framebuffer admission conservatively covers the larger old/new
size. No new budget or native/config/dependency change.

The worker rechecks current/directional demand between reserve, fetch, bitmap decode
and upload. Current pixels and warm pins stay protected. Obsolete work is not a tile
failure; temporary bitmap/transferred texture cleanup runs in finally. Existing
render feedback carries bounded skip byte estimates, not claimed CPU timing.

The short same-book 1× sample reduced canvas 1320×1320 → 802×1320 while keeping the
viewport/positions unchanged. Cleared pixel area fell 104.81 → 63.62 million/sec
(about 39%); compared viewport pixels were identical. App GPU average was 6.48% →
5.06%, dedicated GPU memory 101.46 → 87.16 MB. These are book-specific observations:
graphics clocks were 270–345 MHz before/270 after, with memory at 7000 MHz/P0. Do not
certify total CPU or universal GPU savings. Held obsolete tile tests performed zero
bitmap decodes and retained pixels at 100%/125% DPI. Ten math/contract checks,
check:code, screen build, Pixi and navigation smoke passed; 10× reversal/failure/retry
had zero tile-blocked updates/idle redraws. New proof details and the earlier QA
outer/content-size correction/coast-timeout limitation are in reader-plan.md.
Evidence: .runtime/reader-resource-work-after-1795417969632/result.json,
.runtime/reader-resource-work-fast-1795418927900/result.json and
.runtime/reader-pixi-1795419639112/result.json. Keep the 60 ceiling, 128 MiB nominal
tile pool, geometry/DPI, colors, zoom/speed and feature ownership unchanged.

### Pixi GPU reader migration — all-page rendering and momentum implemented

The operator's goal is GPU-drawn scrolling with consistently paced 60-class frames
while decode/preload continues, not merely a JavaScript momentum effect. The current
plan is `reader-plan.md`. The operator approved implementation, explicitly rejected
excessive testing/engineering and rejected a first-page-only scrolling test. Every
loaded page must participate in the actual reader. All-page GPU rendering and
momentum are implemented; remaining acceptance/performance work stays in the plan.
Do not steer this task
back to native-only scrolling without investigating the requested Pixi route.

The direction is pinned PixiJS 8.23.0, an OffscreenCanvas rendering worker,
bounded texture upload and one worker-owned camera. Keep native Sharp decode/cache/
priority policies and existing geometry/chapter behavior. Drawing/DOM-dependent
position integration must be adapted; do not describe this as zero existing-code
changes. The four proposed private BodyReader-prefixed files are justified by the
worker runtime/contract/pure-policy boundary, not a general architectural restructure.
The migration plan defines the scoped transition from the current native scroller;
historical native/DOM descriptions below remain accurate for the current runtime.

Historical M1 snapshot, superseded by the all-page path below: M1 installed Pixi and connected the first accepted image through BodyReaderPixi.ts,
BodyReaderPixiWorker.ts and its local contract. `pixiPreview: false` is retained in
reader JSON; true enables this first-page connection after restart. It is part of
the real reader, not a separate demo or full Pixi cutover. The normal reader keeps
its existing path. The preview uses one bounded ImageBitmap/texture, a viewport-sized
WebGL canvas, coalesced draws and no running Pixi ticker/GC loop. Original pixels
remain available for fallback. Full texture admission/tiling and worker-owned camera
are later stages; do not claim this temporary duplicate preview is a complete budget
or 60+ presented-FPS solution.

Vite emits local ES worker assets. Existing strict screen types cover Pixi and worker
declarations; worker DOM/UI access and untracked worker URLs have explicit checker
guards. CSP adds worker-src self and connects only to yuzread-page; the authorized
page protocol adds opaque-origin CORS. No startup, IPC, sandbox or native decode
policy changed. Pixi 8.23.0 has one incorrect AbstractBitmapFont.distanceField type;
prepare-types applies a backed-up, exact-version declaration correction matching
the runtime's initialized non-null property, without weakening strict checking.

M1 checks: check:code and both builds passed; one reader-pixi-smoke integration passed
real token/worker bitmap/WebGL2 pixels, scroll, fixed resize geometry, GPU compositing
enabled and pagehide cleanup. `.runtime/reader-pixi-m1-1795363046102/result.json` is
the evidence. No full suite, backend benchmark, injected stall or FPS measurement
was performed. Move on through useful implementation slices, not a new proof phase.

Current implementation — 2026-11-23: reader JSON selects `renderer: "pixi"` and
`momentum: { enabled: true, speed: 1 }`; the temporary pixiPreview key is removed.
BodyReader keeps document/geometry/priority/residency policy and passes every
validated prepared page into one persistent rendering worker. DOM image nodes are
geometry/name placeholders without src in the Pixi path. There is no first-page
limit or duplicate normal DOM-image pixel residency. Numeric page-box snapshots
update on layout changes; existing chapter coordination still runs in the UI.

The worker prepares PNG bitmaps, verifies dimensions, uploads bounded 1024-pixel
tiles with sampling borders and draws visible pages. Render-worker/framebuffer,
encoded/staging and tile-border estimates use the same native admission limit via
the narrow renderReserve capability. Native chapter/catalog release waits for
renderer release; active page preparation must settle before release acknowledgement.
Disposal stops work, destroys owned resources and settles GL work before acknowledging.
Timeouts do not recycle uncertain render reservations. These remain estimates,
not measured process-RSS/VRAM caps.

BodyReaderPixiWorkerPolicy owns the pure 12-ms response/250-ms friction/1.5-gain
momentum math. The worker owns vertical movement; the existing scroller projects
its position for scrollbars/chapter events. One outstanding position and one render
feedback message bound UI backlog. Control revisions discard obsolete movement;
layout rebases preserve motion, while zoom, direct inputs, picker, blur/hidden and
close cancel it. Fine pixel deltas use a documented small-delta native-input
heuristic, not a claimed device classifier. Draw/animation work stops when idle.
No React per-frame state is introduced. The later resource decision caps updates at
60/sec; the original uncapped target is superseded. Renderer preparation
timings are not mislabeled as DOM image decode or presented FPS.

Focused evidence: `.runtime/reader-pixi-1795366639173/result.json` passed six GPU pages
across two fixture chapters, second-page pixels, momentum handoff, backward reload,
zoom/reset interruption, fixed geometry/framebuffer resize and pagehide cleanup;
GPU compositing reported enabled. Three focused schema/momentum tests and final
check:code passed (36 production files, 21 type/22 boundary fixtures), and both builds
passed. No full suite or presented-FPS benchmark was run. Low-budget extremes,
GPU-loss recovery and extended real-book performance are not certified by this check.

Worker load/CSP/CORS, GPU backend compatibility, strict source coverage, additional
memory overhead, latest-camera anchors and visibility-safe retirement are explicit
gates. Do not weaken sandbox/IPC/typing, double memory allowances, silently downscale
pages, or count worker/ticker callbacks as presented FPS. Measure the requested GPU
path before claiming the performance goal. Diagnostics stay off by default.

Future owners are Downloader -> Library -> Reader, with standalone Library asking
the independent Reader to open content. Reader, Library and Downloader are sibling
applications with separate screens, logic, processes, identities and state; sharing
an Electron runtime must not turn Library or Downloader into Reader internals.

Current ordering/agent boundary — 2026-11-24: the sibling ownership tree and
parent-local child registration are now established first. The remaining connection
skeleton owns only stable application identities,
launch/role boundaries and explicit handoff contracts: Downloader completes files
into the filesystem contract consumed by Library; Library asks Reader to open a
selected CBZ through the agreed external-open contract, with the normal Windows CBZ
opener as its configured fallback. It must make the attachment points and ownership
visible by folder and filename without implementing Library catalog UI/business logic
or Downloader acquisition logic. The operator will build Library and Downloader
separately with another agent after this skeleton is clear. That agent must consume
the agreed contracts rather than import Reader internals or invent a second connection
path. Exact executable names, role identities, userData locations, handoff payloads
and Library filesystem layout remain design decisions until explicitly approved.

The Reader restructuring does not authorize Library/Downloader business features.
Chapter-control UI, auto-scroll/speed UI and Windows CBZ installation are also outside
this ordering unless explicitly included. On completion, transfer lasting connection
decisions/evidence here and remove the finished plan.

The operator navigates by filenames and folder hierarchy. Name each file after
its actual job. Organize by the thing that owns the behavior, not by technical
layers. Prefer named sections inside an owning file to scattering one feature
across many files. Do not create unowned root `logic/`, `view/`, `components/` or
`desktop/` dumping grounds. `screen/reader`, `screen/library` and
`screen/downloader` are explicit sibling application owners, not technical layers.

```text
electron/                         Native app, OS integration and Electron runtime
  config.json                     Native title, sizing, startup policy and icon path
  assets/                         Native app icon files
  reader/CbzArchive.cts            Reader archive worker and page protocol
  library/                        Reserved future Library-native owner
  downloader/                     Reserved future Downloader-native owner
screen/                           Browser/UI boundary
  config.json                     Schema-2 Reader areas/connections/presets
  shared/components/              Reusable UI mechanics
  shared/logic/                   Reusable non-UI mechanics, no feature algorithms
  reader/                         Complete current Reader application
    windows-area/                 Top controls; dumb parent + contract + children
    body/                         Body parent/contract and GPU reader
    bottom-bar/                   Navigation parent/contract and children
    action-bar/                   Retained disabled area
  library/                        Reserved future standalone Library UI owner
  downloader/                     Reserved future standalone Downloader UI owner
tests/                            Existing checks, not application runtime code
```

### Sibling ownership and child self-registration — delivered 2026-11-24

The current Reader moved one file at a time under `screen/reader/`; its old area
folders were removed. `screen/library`, `screen/downloader`, `electron/library` and
`electron/downloader` reserve the separately owned sibling applications without
shipping placeholder business logic. Exact role launch, executable identity,
userData and external-open/filesystem contracts remain the next connection-skeleton
decisions, not hidden assumptions in this structural migration.

The existing generic TSX scope now recognizes explicit `child` registrations.
Discovery derives each real path, matches folder + parentName, supports nested
children, sorts deterministically and reports invalid/unowned registrations. Children
validate only their named request/state ports. WindowsArea, Body, BottomBar and
ActionBar contain no child imports or handwritten child lists; named `*Contract.ts`
files own their relay codecs. `screen/config.json` retains the same IDs, geometry,
appearance, connections and behavior with only Reader folder paths changed.

Canonical sectioning follow-up normalized BodyReader, its Pixi bridge/worker, Setting
Screen, Scroll Speed and chapter navigation one file at a time. Canonical headings
identify contract, registration, calculations, state/coordination, UI/local events
and lifecycle/cleanup; specialized Reader headings remain subsections. Pure speed/
navigation helpers moved only where declaration order was safe. React hook order and
Reader/Pixi/worker algorithm order stayed intact.

Fresh `check:code` passed with 42 production files, 23 type proofs and 23 boundary
proofs; screen build and six focused schema/discovery checks passed. The isolated
runtime proof `.runtime/modular-area-proof-1795510201467/result.json` rendered a new
area with two self-registering children, proved the second child did not edit its
parent, and reported no current Reader diagnostics. The later operator-authorized
single full-suite attempt passed 46/47 unit tests, then identified a stale catalog
ordering assumption in the test (not production discovery). Selecting `windowsBar`
by identity made the targeted rerun pass. The remaining UI phase identified another
stale global close-part selector because Setting Screen also has a close part; scoping
it to `windowControls` made `shell-proof.mjs` pass at
`.runtime/checks/window-controls/result.json`. The complete suite was not repeated.
No Reader benchmark, dependency/native-runtime change, commit or push.

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

### Reader drag-drop — 2026-11-23

BodyReader's viewport owns Files dragenter/dragover/drop listeners and single-CBZ
selection. It prevents browser default navigation, rejects invalid/multiple drops
without replacing readable content and ignores a new load while Open/navigation
is active. Drop reuses openChapter's immutable geometry snapshot, staging/initial
preparation/commit/error-resume/retirement and the same next-folder continuation;
do not make a separate drag-drop decoder or change zoom/speed.

The narrow dropOpen request forwards File+ReaderOpenOptions through Body/Screen.
ShellHost.reader.drop is the only File-backed capability; native IPC still carries
only a path/options. Preload resolves with Electron webUtils.getPathForFile and
rejects fabricated File handles/empty paths. Never expose raw getPathForFile or
trust a renderer-supplied File.path string. reader:open-file retains the top-frame
trusted sender check and path/options validation. CbzArchive.open accepts the
resolved dropped path, skips the dialog only, and reuses normal canonical catalog/
archive/cache/source/budget/folder-memory logic. Invalid path requests must not
fall through to the picker. Sandbox/context isolation remain on, Node off.

Fresh check:code, both builds and schema check passed. The scoped UI/native check
.runtime/reader-drop-1795451850343/result.json passed real disk-backed upper-case
CBZ opening, default prevention/no dialog, actual colors, invalid/multiple/corrupt
old-content survival, fabricated File rejection, next-folder continuation and
zoom/speed-preserving replacement with one GPU canvas. Existing Load/Pixi smoke:
.runtime/reader-pixi-1795451928649/result.json. No Setting Screen/full suite or
installer/version/release changes. The OS opener remains a later explicit step.

### Bottom chapter navigation — 2026-11-23

BottomBar is enabled as a transparent, non-draggable 4%-high bottom overlay at y=96,
zIndex=10 with a hover preset. Previous/List/Next belong to the single self-contained
BottomBarChapterNavigation.tsx child; old BottomBarStatus stays disabled. The reader
still fills the entire body. Popup UI, pointer drag, selection and validation belong
to the child; styles/order/sizes/labels belong to its JSON. Portal/ClickAwayListener
keep the popup alive when the strip hides, with outside-click/Escape dismissal.

ReaderNavigationState/Request are neutral typed data. Body/BottomBar forward state
and commands through Screen; there are no sibling implementation imports or new
native pickers. BodyReader owns navigation, stale catalog checks, current selection,
busy state and disabled endpoints. Cached chapters are reused. Unloaded targets
use existing chapter/prepare priority APIs, immutable known geometry and the frozen
natural-order catalog. A target must have its initial pages before committing;
failures preserve readable content. Zoom/speed remain; old momentum is stopped.

Manual targets retain focus when a short final chapter cannot align at the top;
real scrolling resumes normal primary-chapter selection. A far jump starts a new
rendering segment while retaining native catalog authorization and known geometry.
Its separate sceneId retires old GPU scene pixels safely. Paused old jobs transfer
ownership before header/bitmap completion; old resident retirement settles before
new same-catalog neighbor preload to avoid reusing a closing native chapter worker.

Hover presets are valid independently of native drag regions. The existing native
geometry sampler now observes any enabled hover section, not only draggable ones;
no separate footer polling/controller was added. Top control positions, the configured
D:\[ MANGA ]\Citadel folder, native window and speed panel remain unchanged.

Focused navigation/schema checks and both builds passed. UI evidence at
`.runtime/chapter-navigation-1795374646174/result.json` covers natural 1/2/10 order,
current highlight, hover/overlay/no gutter, drag/outside/Escape, actual destination
pixels, resident/unloaded Previous/Next/list, boundary disables, no extra picker,
preserved zoom/speed and one GPU canvas. Popup screenshot inspected. No full suite
or FPS benchmark. Existing reader-plan.md contains the requested tasklist; do not
create a redundant standalone completed plan.

### Setting Screen and persistent Reader preferences — 2026-11-24

`screen/shared/components/SettingScreenSectionCard.tsx` is reusable collapsible card
chrome. It receives its header label/initial expansion and shared visual parts; each
locally discovered Setting Screen section imports it and supplies only its own body.
Smooth scroll is currently the only visible `WindowsAreaBtnSettingScreenSection*.tsx`
owner; the empty Display placeholder was removed. Adding another compatible section
adds its module plus JSON declaration; the popup does not gain another handwritten
section import. Collapsed bodies stay mounted (hidden, not unmounted).

`screen/shared/components/ConfiguredValueSlider.tsx` owns the reusable controlled
MUI Slider, ARIA value text, configured thumb/track geometry and value-label forwarding.
Smooth scroll and Scroll speed import it. The shared slider contains no Reset,
persistence, unit conversion or Reader behavior; those remain feature-owned.

Smooth scroll owns Reset, a 100–2000 ms slider and live value. Config default is
250 ms, matching the previous fixed coast scale. The setting changes the duration
used to deliver preserved wheel distance; it does not replace the separate 150 ms
tick-join window, speed multiplier, zoom, geometry, tile policy or uncapped maxFPS.
BodyReader forwards accepted changes to the existing Pixi bridge/worker without
rebuilding it. Active gesture rate/velocity rescale with duration while distance
credit remains bounded.

`electron/reader/ReaderPreferences.cts` discovers explicit numeric `preference`
schemas in screen JSON. `%APPDATA%\Yuzread\reader-preferences.json` stores only
validated overrides, never labels/defaults/ranges. Writes are serialized, coalesced
and temp-file-renamed. Startup bootstrap resolves defaults plus overrides before the
Reader worker starts. Reset removes the matching override. Invalid/unknown saved
values fall back to config. Scroll speed now uses this same mechanism.

Latest appearance correction: no visible "Setting Screen" title in the popup header;
keep the screen's accessible name and right-side X. Header height is 28 px, with
panel paddingX=1.8/paddingY=1.5 (about 8/5 px at 440×320). No Setting Screen tests
were run for these operator-requested appearance changes.

WindowsAreaBtnSettingScreen.tsx owns the far-left gear and persistent modeless popup.
WindowsArea and Body only relay typed duration/state and preference capabilities;
BodyReader remains the behavior owner. The settingScreen JSON child is at x=0.75%, with
the existing speed/Load/default/Close placements unchanged. Shared ActionButton
registers the MUI SettingsOutlined icon; there is no new dependency.

One always-mounted Portal contains a draggable header, configured title/X row and
the discovered section cards. Outside click/Escape/top hover exit do not dismiss it.
Gear opens/focuses; only X hides it. Hidden+inert remove the closed popup from focus/
accessibility without destroying body nodes or session state. First opening anchors
below the gear; later openings retain the dragged position. Resize clamps it to
the viewport. Close/blur/unmount release pointer capture; close returns focus when
the previous target is available. The close button never starts header/native drag.

Header/body/close parts, order/gap, sizing, icons/labels and visuals stay in JSON.
The popup uses existing MUI Portal, ActionButton, ConfiguredRow and configuredSx;
the reader, native window and speed panel are not recreated or retuned.
Fresh check:code/build and focused schema, persistence, duration and speed checks
passed. `.runtime/persistent-settings-1795517281962/result.json` verified shared slider
use, config header
labels, startup loading of saved 600 ms/3.7× values before worker creation, live
100–2000 ms updates, override-only disk data and both Reset removals. The native unit
recreated the store from disk and recovered configured defaults plus saved overrides.
No full suite, benchmark, dependency/template/Chrome change or commit/push.

### Scroll-speed panel — 2026-11-23

WindowsAreaBtnScrollSpeed.tsx owns the button/popup, validation, slider/numeric draft,
clamp/step, Reset and pointer dragging. It uses existing MUI controls, Portal,
ClickAwayListener, ActionButton and ConfiguredRow; no new dependency/native window.
The readerScrollSpeed JSON child is at x=80.25%, left of Load. Existing Load/default/
Close positions and the operator's D:\[ MANGA ]\Citadel folder remain unchanged.
Preference min=10/max=100/default=10/step=1 maps value/10 to 1×–10×, with 91 values.
Applied values stay clamped/snapped; the numeric draft is not forcibly rewritten
mid-typing. Enter/blur commits it. Outside click/Escape closes without resetting.

WindowsArea/Body only forward setScrollSpeed requests and scrollSpeed state through
the Screen connections. BodyReader owns live speed; the Pixi bridge sends a typed
speed command, and the worker rescales existing velocity/target immediately without
restarting, decoding or resetting position. Velocity caps/settling thresholds scale
with the multiplier so 10× does not hit the old 1× cap. Precision input also honors
the selected speed without adding another inertia tail. Reader navigation keys are
scoped to its input area so slider keys do not cancel momentum.

Hover areas now stay mounted behind a visibility wrapper; do not revert to
unmount-on-pointer-exit, which destroys a child-owned popup. The transparent native
drag area remains mounted, and portal panels are outside the hidden wrapper.
Popup pointer capture moves only the panel and cleans up on close/unmount. Its
geometry/order/colors/labels come from JSON; no screen-local palette or draggable
library. Runtime speed is persisted as an override by ReaderPreferences; it is never
written back into packaged screen JSON.

Three focused schema/value/scaled-momentum tests and check:code passed (37 production
files, 21 type/22 boundary fixtures). Screen build and the interaction check at
`.runtime/scroll-speed-1795371910355/result.json` passed hover survival, input/clamp,
slider/reset, 100=10× during active momentum, renderer identity, native-window count,
panel-only drag, outside-close retention and keyboard/Escape. Panel screenshot was
inspected. No full suite or FPS benchmark was run. Normalize QA app roots without a
trailing backslash before passing them to the Electron launcher on Windows.

### Load folder preference — 2026-11-23

WindowsAreaBtnLoad owns optional folderPath/rememberFolder validation and Open
intent. Reader JSON's readerOpen child defaults to folderPath="" and rememberFolder=true.
A configured existing folder takes priority; otherwise the last opened folder is
read from the native userData/load-folder.json. A successful native archive open
saves its folder; cancellation leaves it unchanged, and rememberFolder=false disables
reading/writing that memory. Invalid/missing directories fall back without breaking
reading. Electron 43+ defaults dialogs to Downloads unless defaultPath is supplied.

Parents only forward typed picker settings through ui.open.input.v2 and
native.reader.open.input.v3. BodyReader forwards them with the existing Open request;
CbzArchive performs native directory validation/dialog/persistence. Picker settings
are stripped before archive/catalog/worker preparation. No paths are returned from
native folder memory and no raw filesystem capability is exposed.

Two focused Load tests, check:code and both builds passed. The scoped native/UI
integration at `.runtime/load-folder-1795368669933/result.json` checked selected-folder
save, read-from-disk, disabling memory, fixed-folder override and cancellation.
No full reader suite or performance benchmark was run for this small feature.

Screen presentation, UI state and interaction coordination belong in `screen/`.
Window command requests live with `screen/reader/windows-area/`; native execution lives
in `electron/`. No screen code imports native implementations directly.

The body owns the reader. Keep reader display, state, loading/preloading
coordination and scrolling together in `screen/reader/body/reader/BodyReader.tsx`, using
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
Area parents are dumb assemblers: they own relay ports, placement, subscriptions,
connection cleanup and event forwarding. They do not import or list direct children.
They never own button decisions, reader algorithms or child business state.
Each child exports a parent-local `defineChild` registration and owns its own UI,
behavior, state and config validation. Its filename starts with the owning parent's
name. Shared/entry/explicit owner-contract files are exceptions.
No sibling/cross-area implementation imports, including type-only imports.
Children communicate through parent-provided contracts, not globals or a broad
AppSession/ScreenState/ShellHost object. Only the bootstrap boundary reads the
bridge global. Shared modules never import feature/area implementations.

Folders name owners (`reader/windows-area`, `reader/body/reader`); files name jobs
(`WindowsAreaBtnLoad`, `BodyReader`, `CbzArchive`). Use PascalCase for owning UI and
behavior modules; lowercase filenames for configuration/entry documents. Keep
native source `.cts`, pure browser logic `.ts`, UI `.tsx`. Native source compiles
to `.cjs` in `electron-built/`; it is never executed through a TypeScript loader.
`ShellHost.d.ts` is the sole neutral, type-only native/screen wire contract.
Types stay in their owning file's contract section. No redundant `src/`.
Use CONFIG AND CONTRACT, CHILD REGISTRATION, LOGIC AND CALCULATIONS, STATE AND
COORDINATION, UI AND LOCAL EVENTS, and LIFECYCLE AND CLEANUP sections as applicable.
Do not create empty sections or split every method/button into another file.

WindowsArea discovers its prefixed, self-registering children. The default-size/Close
row is shared layout mechanics, not another feature controller. Adding a compatible
child touches its named file and JSON; its parent, central assembler and existing
siblings remain untouched. Adding an independent area needs only its folder/typed
parent/self-registering children and config entry, not edits to a central area list,
Screen or generic discovery. Registrations are parent-local, never a singleton bus.

The parent owns placement of sibling blocks; blocks never position siblings.
Each block's `bounds` is relative to its area. Each internal row part's `size`
and the block's `gap` are percentages of the row's content area. JSON `order`
lists every named part exactly once. Moving/resizing a group moves its parts
together. Shared ConfiguredRow renders order/sizing; the feature supplies behavior.
Keep configuration authority for all internal visuals, not only group appearance.

Area roots export stable `areaId`, their declared parent name, and typed area binding.
The generic build-time scope discovers roots and explicit `child` registrations.
Children declare parent identity, local identity/validation, typed props and only
their required named ports. Discovery derives the actual file path, groups children
under the matching folder/parent and rejects duplicate/incompatible registrations.
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
Action bar and inspection remain off; the requested bottom chapter overlay is on.
Open CBZ belongs
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
It also corrects the pinned Pixi 8.23.0 bitmap-font declaration as recorded above;
review that exact-version correction before upgrading Pixi. Runtime assets are never
modified by declaration repair.

After runtime changes, normally close only positively identified Yuzread instances,
launch the updated app and leave it running. Never kill unrelated apps or modify
Chrome profiles. Generated native code is `electron-built/`, generated UI is
`screen-built/`, and runtime artifacts are `.runtime/`. Do not edit generated code.
