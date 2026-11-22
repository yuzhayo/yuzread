# Yuzread — Pixi GPU reader migration

Status: **All-page Pixi rendering and momentum implemented; remaining acceptance/performance work pending.**

The operator requested this plan on 2026-11-22, then approved implementation without
overtesting/overengineering and explicitly rejected limiting scroll testing to one
page. The actual reader now draws all loaded pages through Pixi and has worker-owned
momentum. Treat subsequent work as bounded slices;
do not introduce a separate proof project or run every historical test.
The six original reader stages are complete;
this is a new, specifically requested rendering migration, not another general
architecture or TypeScript migration.

## 1. Goal and scope

Move page drawing and smooth scrolling to **PixiJS in a dedicated rendering
worker**, using OffscreenCanvas and GPU-backed WebGL/WebGPU rendering. Target
consistently paced **60+ presented FPS while scrolling**, including preparation of
the next chapter, without an artificial 60-FPS ceiling. Validate this on the
operator's actual PC; a ticker setting or callback counter is not the acceptance
proof. Idle content does not need continuous redraws.

CPU workers still unpack, decode and resize pages through Sharp/libvips. The GPU
draws prepared page textures. Momentum calculations run on a CPU rendering worker;
calling that worker a GPU decoder would be incorrect.

This replaces the page-drawing backend and its position integration. It is not
simply a library layered above the existing HTML images. Preserve the existing
reader's policies and native archive service, while adapting the DOM-dependent
geometry/visibility/scrolling code that cannot remain unchanged.

## Current delivered slice — 2026-11-23

- Removed the first-page preview limit and pixiPreview option. Current configuration
  enables renderer=pixi and momentum enabled/speed=1 for operator testing.
- Every prepared page is validated/decoded/uploaded by the worker; DOM nodes reserve
  the original geometry and labels without duplicate image pixels. One canvas/worker
  survives chapter changes. Only visible pages are drawn; page textures are tiled
  with bounded uploads and sampling borders.
- Added supplemental render/staging/padding estimates to the existing native budget,
  not another full allowance. Native chapter/catalog release follows renderer release
  and active preparation retirement.
- Added refresh-independent momentum, bounded feedback, old-control rejection,
  layout rebasing and interruptions for zoom/reset/direct inputs/picker/blur/hidden/
  close. Fine pixel input uses a small-delta heuristic to preserve existing device
  inertia; this is not a perfect hardware classifier.
- A viewport resize race was corrected: scroll/layout revisions do not discard a
  valid framebuffer resize, and mismatched framebuffer dimensions are not published
  as a ready scene. Disposal waits for pending work and settles GL work.
- Three focused policy/schema tests and check:code passed. Native/screen builds passed.
  The final two-chapter integration at
  `.runtime/reader-pixi-1795366639173/result.json` passed six GPU pages, non-first-page
  pixels, momentum across chapter handoff, backward reload, zoom interruption, fixed
  resize geometry and cleanup. GPU compositing was enabled.
- No full suite, separate proof app, prolonged benchmark or presented-FPS measurement.
  Real-book performance, low-budget extremes and GPU-loss recovery remain unverified.

The sections below retain the target design and outstanding acceptance criteria.
The DOM remains the lightweight geometry/chapter adapter in this delivered slice;
do not describe it as completely removed or claim the 60+ presented-FPS goal is proven.

Future application ownership remains **Downloader -> Library -> Reader**:
Downloader delivers completed manga to Library; standalone Library asks Reader to
open it; Reader works independently. This migration does not build those apps or
introduce a central feature registry. Also outside this migration: manual
previous/next controls, auto-scroll, speed-control UI, CBZ drag/drop and installer/
Windows file association. Smooth manual scrolling is the first new reader feature.

## 2. Preserve these behaviors

- Square startup/default restore, native identity/icon, original header placement,
  dark background, full-width body and no right scrollbar gutter.
- First configured 3–5 pages before initial display; current completes before
  speculative next. Existing defaults remain initialPages=5 and maxDecodedMB=1536.
- Frozen, natural-order same-folder catalog; current + next residency, no permanent
  previous slot, on-demand backward reload and visible short-chapter protection.
- Fixed opening-time page boxes/DPI, natural-size caps, centered chapter columns,
  page gaps and both horizontal edges when the window is narrower than the pages.
  Resize changes the viewport/framebuffer, not accepted page sizes or decode widths.
- Ctrl+wheel and exact Ctrl+0; existing zoom range/steps and pointer/center anchors.
  Explicit zoom does not replace or re-decode accepted pixels.
- Priority demand/visible/background, between-page preemption, cache reuse,
  source/page/width validation and non-blocking budget deferral.
- Canceled/failed replacement preserves the readable document and position.
  Stale work cannot publish into a newer reading session.
- Existing keyboard/focus operation, right overlay scrollbar and accessible status.
  Canvas is not permission to remove page/chapter names and keyboard navigation.
- Diagnostics stay opt-in and off by default. No new toolbar or idle frame loop.
- Electron/React/MUI/TypeScript/Vite versions, sandbox/context isolation, trusted
  IPC, the separate template and Chrome profiles remain unchanged.

## 3. Proposed ownership — keep the reader self-contained

```text
screen/body/reader/
├── BodyReader.tsx                      Existing document/loading owner and UI
├── BodyReaderPixi.ts                   Canvas/worker lifetime and narrow bridge
├── BodyReaderPixiWorker.ts             GPU scene, texture queue and frame loop
├── BodyReaderPixiWorkerContract.d.ts    Local, type-only worker message contract
└── BodyReaderPixiWorkerPolicy.ts        Pure camera/geometry/momentum calculations

electron/reader/
└── CbzArchive.cts                      Existing archive/cache/priority/admission owner
```

The four additional files have distinct jobs, not one file per method. Named
sections inside the worker own texture lifecycle, camera, input, momentum and
diagnostics. Its neutral contract exists because browser and worker compilation
have different runtime globals; it is not a second global ShellHost or event bus.
Policy functions take plain data, have no side effects and do not import the
worker/bridge. The proposed prefixes fit the existing private-child import rule:
BodyReader imports BodyReaderPixi; that bridge and its worker import their own
prefixed contract/policy. Neither imports sibling screen features.

BodyReader continues to own catalog authorization, opening/replacement, priority,
chapter residency, statuses and immutable document metadata. The Pixi worker owns
accepted render resources and the authoritative live camera. It never gets Node,
filesystem, Electron IPC, parent ports or the full application bridge.

Body.tsx remains a forwarding parent. Screen.tsx and discovery remain generic.
Library/Downloader ownership does not move into the reader or shared mechanics.

## 4. Boundaries that require adaptation

Current inspected baseline: `588278584a2bc26e73656bfd9a49d0ff1db0ac66`; the working
tree was clean at planning preflight. Recheck it before implementing and preserve
any subsequent operator work. Existing tests/results are historical evidence,
not fresh verification of Pixi.

| Current owner/path | Migration consequence |
| --- | --- |
| BodyReader prepare(), images/pendingImages maps | Renderer-neutral accepted-page descriptors replace DOM-image ownership for the Pixi path. Browser bitmap validation and GPU staging become worker operations. |
| buildChapter(), renderReading(), reconcile(), reclaimUnused() | Retain their policies; replace DOM rectangle/IntersectionObserver decisions with immutable logical geometry plus versioned worker visibility/position. |
| CSS zoom, scrollTop/scrollLeft and SCROLLBAR section | Adapt to one worker-owned camera, preserving actual column origins, native-style controls and input attribution. No second authoritative scroll position. |
| screen/index.html | connect-src currently forbids fetch. Worker loading needs a narrowly scoped page-token fetch allowance and explicit worker policy. |
| CbzArchive page protocol | Fetch is registered, but responses currently have no CORS allowance. Actual file-origin/worker access must be proven with the same token/integrity checks. |
| Native estimated memory ledger | Existing bitmap/texture allowances must be reconciled with render-worker, framebuffer and staging overhead; do not assume extra allocations are free. |
| Vite/TypeScript/static checker | Add actual worker bundling and complete strict worker-source coverage, without suppressions or ownership-check shortcuts. |
| tests/reader-*-proof.mjs | DOM-image assertions cannot certify Pixi. Adapt affected acceptance checks to geometry, source/texture identity and displayed pixels; keep native proofs where still relevant. |

## 5. Runtime design

### Rendering and geometry

Use a **viewport-sized canvas**, not a canvas as tall as the document and not a
single texture containing an entire chapter. Store chapter/page rectangles and
history gaps as numerical metadata. Draw only intersecting page sprites/tiles plus
a bounded lookahead. A page's logical box stays reserved even while pixels are
pending. Source bitmaps need not all be GPU-resident to preserve chapter residency.

Maintain each chapter's immutable opening geometry, column centering, document
width growth and history height. Keep the scene's working coordinates near the
camera to avoid large-document floating-point jitter. Pass current viewport size
and display DPR explicitly; canvas CSS sizing stays on the main thread. Changing
framebuffer resolution must not mutate stored page geometry or trigger native decode.

Start with Pixi's documented WebGL path. M1 uses WebGL2 on the actual PC. Consider
WebGPU later only when it addresses a concrete compatibility/performance question,
not as a mandatory extra backend benchmark or an assumption that it is faster.
Software rendering is a labeled compatibility result, not a GPU-target pass.

### One camera and bounded messages

The rendering worker owns x/y, zoom, velocity and the latest committed layout.
The UI sends wheel/keyboard/control commands; it does not send a stale absolute
position every frame. The worker reports boundary/visibility changes promptly and
coalesces position snapshots for UI/scrollbar projection. React updates only for
actual reader-state changes, never each animation frame.
New input and chapter updates still pass through the UI thread; a worker does not
make them immune to UI stalls. The isolation target is continuing already-prepared
movement without needing a UI callback for every displayed frame.

Messages are discriminated, runtime-validated plain-data contracts carrying
protocol version, renderer lifetime, reading generation, layout revision and
input/command sequence. Page operations additionally identify catalog/chapter,
source revision, page identity/index, requested/actual bitmap dimensions and the
authorized token URL. Bound queues and batch sizes; coalesce replaceable commands,
but never silently drop release/commit/cancel operations.

New layouts commit against the worker's **latest logical anchor**: chapter/page,
offset within the page and screen anchor. The existing native/DOM path remains a
temporary baseline, not a camera that can overwrite worker movement. A native
scrollbar used as a projection must distinguish worker-generated updates from
user input to prevent feedback loops. Preserve vertical and horizontal navigation.

A delayed UI snapshot must not cause eviction of content the worker now displays.
Use a versioned retirement handshake: the worker validates the proposed release
against its current visibility/camera, detaches only safe resources and acknowledges
that generation before BodyReader releases the native chapter. Reject stale
retirement requests. Keep extra visible short chapters rather than forcing two.

### Texture loading, upload and admission

Fetch only validated yuzread-page tokens; use createImageBitmap in the rendering
worker, not new Image/document APIs. Verify dimensions/identity before accepting
pixels. Define color conversion, alpha and orientation explicitly and check visual
parity; do not silently change page quality to meet the FPS target.

Separate native preparation, worker bitmap decode, GPU upload and scene publication.
Use demand-first bounded queues and explicitly prepare textures before they become
visible. Import Pixi's prepare support where required; it is not assumed present.
Limit uploads by byte/size/time budget as well as item count: even one huge upload
can hitch. Split oversized images into bounded tiles after checking **both** GPU
texture dimensions. Tiling retains source pixels, page size and seamless sampling;
never solve a texture limit by stretching/downscaling an accepted page.

Reconcile the existing native bitmap+texture estimates rather than charging them
twice. Account for additional render-worker/framebuffer storage and transient
full-bitmap/tile/upload overlap before allocating them. If existing reservations
cannot cover that overhead, add a narrow typed supplemental render reservation to
the same admission owner/limit, forwarded through existing parents. Design its
grant/retirement contract before implementation; do not invent a separate allowance
that silently doubles maxDecodedMB or raise 1536 MB to hide oversubscription.

Deferral keeps visible textures/pixels intact and delays speculative work. Native
page-ready is not GPU-ready. Publish initial 3–5 pages or a replacement only after
their validated renderer resources are prepared and the new scene can draw.
Keep old content until the replacement is ready. A preparation/submission promise
does not prove GPU completion or frame presentation; source cleanup must follow
the renderer's real resource-lifetime requirements.

### Smooth input and cleanup

Adapt Citadel's signed impulses, fast response and exponential friction as the
starting motion model, not copied C# code. Starting reference values: 12-ms response,
250-ms friction time constant, 1.5 momentum gain and bounded speed. A 250-ms time
constant is not a promise that movement stops after 250 ms. Normalize browser
pixel/line/page deltas; do not equate all browser wheel events with WPF's 120-unit
notch. Test precision touchpad input and avoid excessive/doubled inertia.

Use elapsed time and refresh-independent integration; compare travel and reversal
at 60/120/165-Hz schedules. Ctrl+wheel remains zoom, Shift/horizontal input remains
horizontal navigation, and consumed inputs do not also run a native scrolling path.
Preserve pointer/center zoom anchors. Reduced motion uses direct movement. Keep
momentum tuning in validated reader JSON; speed-control UI is a later feature.

Zoom, direct scrollbar/keyboard positioning, picker pause, replacement, blur,
hidden/pagehide and close have explicit interruption semantics. Rebase on layout
commits rather than writing an old destination over a new chapter anchor. Run one
worker animation loop only during movement or pending draw work. Stop Pixi/system
ticker work when idle after uploads settle; a static canvas retains its last frame.
Do not use minFPS=60 as a performance guarantee: it clamps timing, not hardware FPS.

Abort pending fetches, close unowned/stale ImageBitmaps, destroy owned sprites/
textures, stop callbacks, remove listeners and settle render retirement before
releasing associated native reservations/tokens. An OffscreenCanvas transfers once:
remount/recovery creates a fresh canvas, never transfers an initialized one twice.
Browser Worker.terminate() has no completion promise and is not proof that GPU
reclamation finished. Define graceful dispose acknowledgements and backend resource
completion separately; uncertain failed retirement must not immediately recycle a
supplemental admission grant. Do not confuse this with native Node-worker retirement.
Handle worker failure and GPU context/device loss without resetting document identity
or position. Verify resource restoration; use a bounded, clearly labeled DOM fallback
if recovery cannot work. Do not keep duplicate DOM images and Pixi textures normally.

## 6. Implementation stages and exit gates

### M1 — Install PixiJS and connect the rendering worker [complete]

- Installed only pixi.js@8.23.0 and its dependencies; no existing dependency version
  changed. No React wrapper, viewport plugin or global GPU/VSync flags.
- The actual reader connects its first accepted page to BodyReaderPixi/Worker via
  a local typed contract. No separate rendering demo. `pixiPreview: false` is the
  normal default; true enables the first-page migration connection after restart.
- The viewport-sized worker canvas fetches the accepted token, validates ImageBitmap
  dimensions, uploads one texture and draws it with WebGL. The original image stays
  as fallback; this temporary one-page preview is not the full memory/camera cutover.
- Manual, coalesced draws only; no Pixi app/shared/system ticker or idle GC loop.
  Limits are 4 Mi pixels per preview page and 8 Mi framebuffer pixels; unsupported
  sizes fall back to the existing image, not a silent quality reduction. M3 adds tiling.
- Vite emits local ES worker modules. Existing strict screen checking covers the
  worker and Pixi's DOM-referencing declarations; explicit guards reject worker DOM/
  UI imports and untracked worker URLs. No separate tsconfig/exclusions were needed.
- CSP permits only local workers and yuzread-page connections; the token protocol
  adds opaque-origin CORS while retaining authorization/integrity/GET checks.
  loadFile, startup/trust rules, sandbox and native wire contracts are unchanged.
- Extended the existing prepare-types mechanism with a version-guarded, backed-up
  Pixi declaration correction: AbstractBitmapFont.distanceField is always initialized,
  but its declaration incorrectly includes undefined. Runtime Pixi is untouched.

**Checks:** check:code passed (35 production files, 21 type/22 boundary fixtures);
both builds passed. One focused tests/reader-pixi-smoke.mjs run passed real CBZ-token
fetch, worker ImageBitmap/WebGL2 pixels, scroll updates, fixed resize geometry, GPU
compositing enabled and pagehide cleanup. Evidence:
`.runtime/reader-pixi-m1-1795363046102/result.json`.

No full suite, separate proof project, extra backend benchmark, controlled-stall
experiment or presented-FPS measurement was run. Camera/scrolling still follows the
existing DOM in this first-page connection; M2/M4 perform the real geometry/momentum
migration. Do not claim this preview meets the completed 60+ FPS goal.

### M2 — Renderer-neutral geometry and static Pixi pages [implemented; wider acceptance pending]

- Extend the local files/contracts and add pure geometry/camera tests.
- Adapt a limited fixture chapter to numerical geometry and accepted-page descriptors;
  connect a worker-owned scene without yet changing normal wheel behavior.
- Behind a validated temporary development backend selection, compare DOM and Pixi
  opening geometry, mixed page sizes, centering, gaps, zoomed extents and 100%/125% DPI.
- Keep canvas viewport-sized; preserve status accessibility and scrollbar placement.

**Exit:** The same prepared pages appear with unchanged dimensions, colors,
orientation and logical anchors. Resize does not stretch/re-decode them. No app-wide
restructure, new area registry or duplicate normal pixel residency is introduced.

### M3 — Texture queue, budget and retirement [implemented; extreme/failure acceptance pending]

- Connect real preparation replies to bounded worker decode/upload queues.
- Implement tile/texture limits, demand priority, GPU-ready publication, resource
  accounting and explicit cleanup. Add native budget/codec forwarding only where
  additional reservations are genuinely needed.
- Verify initial-page publication, low-budget deferral, upload cancellation,
  replacement races, stale results, texture reuse, context/device-loss recovery and
  actual worker retirement.

**Exit:** Next-page uploads do not destroy current pixels, accepted widths never
regress, memory allowances are not doubled, and abort/release leaves no live owned
bitmap/texture/queued work. Oversized pages work by tiling, not quality loss.

### M4 — Momentum, zoom and chapter continuity [implemented; wider acceptance pending]

- Make worker camera/momentum authoritative for the Pixi path; connect normalized
  wheel, precision input, keyboard and both scroll axes without double movement.
- Adapt zoom/reset and existing scrollbar controls, including live-origin anchors.
- Replace DOM visibility dependencies with versioned geometry/worker visibility;
  preserve current+next selection, history gaps, demand reload and retirement gates.
- Preserve picker cancel/resume, corrupt-neighbor survival, replacement, reduced
  motion, hidden/blur/close cleanup and idle inactivity.

**Exit:** Smooth movement persists across chapter publication/eviction; Ctrl+wheel/
Ctrl+0 still anchor correctly, backward reload stays stable, and short visible
chapters are never evicted from delayed UI information. No React per-frame loop.

### M5 — Focused behavior and presented-frame acceptance [pending]

- Add tests/reader-pixi-proof.mjs with generated mixed/tall/short chapter fixtures
  and optional --archive <caller-supplied-real.cbz>. Do not scan the user's library.
- Use a short, declared, reproducible scroll workload on the actual monitor: warm
  current chapter, next decode/upload during movement, and a chapter handoff/backward
  reload. Record archive, cache state, zoom, DPI, window size, GPU backend and Hz.
- Compare DOM baseline and Pixi under the same conditions. Use short Electron/
  Chromium tracing with actual compositor presentation feedback when available;
  distinguish worker updates, GPU submission and presented moving frames. Check
  event availability before naming a capture a presented-FPS measurement.
- Target a sustained 60-class or higher rate of distinct moving frames, with a
  roughly 16.7-ms-or-better frame budget and documented refresh/clock tolerance
  (59.94-Hz displays are 60-class). Report rolling rates, p50/p95/p99/max intervals,
  missed frames and >25/>50-ms hitches; an average FPS alone cannot pass pacing.
- Verify no artificial 60 ceiling on a higher-Hz monitor. Report achieved rate;
  monitor Hz or ticker FPS is not a substitute. Keep controlled injected stalls
  separate from normal-workload measurements.
- Run only affected behavior checks plus npm run check:code and build. Adapt affected
  legacy proofs, retaining meaningful geometry/identity/pixel assertions rather than
  weakening them for canvas. No automatic full suite or prolonged benchmark.

**Exit:** Focused behavior is correct and measured normal-workload scrolling meets
the declared 60+ goal with stable pacing, including background work. If real-book
or presentation evidence is missing, mark that acceptance PARTIAL and leave it
pending; do not substitute callback statistics or certify an untested workload.

### M6 — Operator testing active; final acceptance/documentation cleanup [pending]

- The operator requested the usable all-page Pixi/momentum build for testing now;
  it is currently active. Final completion still requires the outstanding acceptance
  work, not another first-page demo. Keep unsupported-GPU compatibility explicit, not silently
  reported as accelerated success. Remove superseded normal DOM pixel ownership
  and competing input paths; retain only the justified compatibility adapter.
- Update README/AGENTS with actual ownership, backend choice, evidence and limits.
  Transfer lasting decisions into AGENTS.md, then remove this completed plan.
- Normally relaunch only positively identified Yuzread and leave it running.
  Commit/push/release only if the operator requests it.

**Exit:** One normal rendering path, stable existing reader behavior, off-by-default
diagnostics, no idle worker/ticker activity or leaked resources, and honest reported
GPU/presentation acceptance. Future Library/Downloader/features remain separate work.

## 7. Planned file/change budget

Main application edits: BodyReader.tsx, its four proposed private files and reader
JSON options. Tooling: package.json/lock, strict worker checking, Vite worker output
if needed and tests/code-contract-check.mjs. Security integration: screen/index.html
and only the necessary page-protocol response handling. Native/parent/wire edits are
limited to any proven additional admission/diagnostic contract; no decode rewrite.
Tests: focused Pixi proof, relevant contract/policy tests and affected renderer checks.

Do not edit generated outputs, the separate template, disabled unrelated areas,
taskbar pins or Chrome. No new shared rendering framework, performance dashboard,
global event bus, physics dependency or permanent duplicate plan document.

## 8. Sources and evidence limits

- [Pixi renderer choices](https://pixijs.com/8.x/guides/components/renderers)
- [Pixi worker environment](https://github.com/pixijs/pixijs/blob/dev/src/__docs__/concepts/environments.md)
- [Pixi texture lifecycle](https://pixijs.com/8.x/guides/components/textures)
- [Vite worker bundling](https://vite.dev/guide/features.html#web-workers)
- [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [Electron custom protocols](https://www.electronjs.org/docs/latest/api/protocol)
- npm registry returned pixi.js 8.23.0 during planning. Recheck installed declarations
  and exact-version source during M1; current documentation/dev branches are design
  references, not proof that every example matches that release.

Planning itself made no runtime changes. M1's actual implementation/checks are
recorded above; the presented-frame goal and full reader migration remain pending.
