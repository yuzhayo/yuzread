# Yuzread workspace agent contract

This file is the permanent onboarding and operating contract for
`C:\Apps\yuzread`. Read it before inspecting implementation files. The operator
must not have to retell the project history to each agent.

## Workspace checkpoint

- **Last documentation update:** 2026-11-28 09:27:30 +07:00
- **Documented implementation HEAD:**
  `2452b0c5c91cd93511b67a8a2614f507281dfd0c`
- **Commit time:** 2026-11-27 20:26:32 +07:00
- **Commit subject:** `fix: keep development userData inside the repository`
- **Branch/upstream:** `main` → `origin/main`
- **Previous baseline:**
  `df341362dca3e870632cc74c2f12e7cf20255ffd`
- **Relationship:** the implementation checkpoint is the last committed baseline
  before this change. This documentation update accompanies momentum duration
  feature completion.

Required preflight:

```text
git log -1 --date=iso-strict --format="%H %ad %s"
git status --short
```

If Git disagrees with this checkpoint, Git is the source of truth. Update this
section as part of the next completed task.

## Who am I?

You are the operator's implementation partner for Yuzread. The operator owns the
product and decides intended behavior. The operator understands the system through
folders, filenames, visible behavior and plain-language explanations; the agent
owns syntax, integration, focused verification and accurate reporting.

Work as follows:

- Show ownership through the file tree before discussing implementation detail.
- Explain why a piece exists before explaining syntax.
- Use direct language and concrete Yuzread examples.
- Preserve operator data and unrelated changes.
- Do not substitute a different product goal or architecture.
- Do not claim a result that was not actually verified.

When the operator says **explain**, only explain the current request. Read only
what is needed. Do not edit files, install dependencies, build, test, launch,
commit or push until the operator explicitly authorizes implementation.

## What is this project's goal?

Yuzread is one portable Windows suite containing three independent sibling apps:

| Application | Executable               | App ID                   | Job                                                   |
| ----------- | ------------------------ | ------------------------ | ----------------------------------------------------- |
| Reader      | `yuzread-reader.exe`     | `com.yuzread.desktop`    | Open and read CBZ archives.                           |
| Library     | `yuzread-library.exe`    | `com.yuzread.library`    | Future manga catalog and Reader handoff owner.        |
| Downloader  | `yuzread-downloader.exe` | `com.yuzread.downloader` | Future acquisition and completed-file delivery owner. |

The suite launcher `Yuzread.exe` opens Library by default and exits. The three
apps remain separate processes, screens, identities, locks, state and user data.
Sharing one Electron runtime must never turn one app into another app's feature.

Intended future direction:

```text
Downloader --completed filesystem delivery--> Library
Library ----explicit CBZ open request---------> Reader
Library ----configured fallback---------------> Windows CBZ opener
```

Reader is currently the complete business application. Library and Downloader
currently provide independent frameless base windows only. Do not invent their
business features without a direct request.

The actual-use product is the isolated portable suite at:

```text
C:\Apps\yuzread\portable\Yuzread
```

The repository root is development. Portable production must run without source,
Node or npm and keep persistent data, cache, logs, crashes and temporary files under
its own folder.

## Why was this structure chosen?

The operator navigates by ownership, like labeled rooms in a building:

- `electron/` is the native room: Windows, Electron, filesystem and archive work.
- `screen/` is the visible room: presentation, interaction and feature state.
- `reader/`, `library/` and `downloader/` are sibling application owners.
- Named area parents are power strips: they discover, place and connect children.
- Prefixed children are self-contained appliances: they own their behavior and state.
- `shared/` contains reusable mechanics only, never hidden application control.
- `tests/` verifies behavior but is not application runtime code.
- Generated folders are outputs, never alternative source trees.

This shape lets the operator find a feature from its path and lets an agent repair
the real owner instead of spreading compensating patches through unrelated files.

## Mandatory agent contract

### Authority and precedence

The global OpenCode instructions always apply. This workspace contract strengthens
and narrows them for Yuzread; it never weakens them. When rules overlap, follow the
strictest compatible rule. If a workspace statement appears to conflict with a
global safety or preservation rule, stop and explain the concrete conflict.

### Scope

- Change only what the operator requested and the normal implementation steps
  required to complete it.
- Preserve unrelated modifications and data. Never reset, discard or overwrite
  work merely to obtain a clean tree.
- Do not add dependencies, change pinned framework versions, alter machine-wide
  settings, modify Chrome profiles, create an installer, publish a release or add
  unrelated features without authorization.
- Do not edit `C:\Apps\Template\electron`; it is a separate snapshot.
- Do not edit generated output directly. Change its source and rebuild it.
- No `any`, suppression directives, unchecked casts, fake declarations, weakened
  validators or compiler exclusions to make checks pass.

### Ownership

Ownership chain:

```text
suite → application → native/screen boundary → area parent → child feature
```

Parents may discover, validate, place, connect, forward and clean up. Parents must
not perform child calculations, own child business state, import child
implementations or maintain handwritten child lists.

Children declare stable parent-local registration and own their feature rules,
state, UI, events, validation and cleanup. Child filenames begin with the parent's
name. Children do not import siblings or another application's implementation.

Use these responsibility sections where they apply:

- `CONFIG AND CONTRACT`
- `CHILD REGISTRATION`
- `LOGIC AND CALCULATIONS`
- `STATE AND COORDINATION`
- `UI AND LOCAL EVENTS`
- `LIFECYCLE AND CLEANUP`

Do not create empty headings or one file per method. Keep related behavior in its
real owning file. Split only for a distinct responsibility or runtime boundary.

### Shared code

`screen/shared/components/` contains reused visual mechanics.
`screen/shared/logic/` contains reused non-UI mechanics. Shared modules must not
import app features, inspect app internals or become a global controller/event bus.
Reuse must be real; do not move one-use feature behavior into `shared/` preemptively.

### Configuration and discovery

`screen/config.json` owns Reader layout, appearance, area/child declarations and
connections. `screen/library/config.json` and `screen/downloader/config.json` own
their local layouts. `electron/*/config.json` owns native window settings.

Parents and children are discovered from explicit declarations. Reject duplicates,
cycles, incompatible ports and invalid identities. Do not silently choose the first
registration. Adding a compatible child changes its file and JSON declaration, not
its parent, central assembler or siblings.

### Native and security boundary

All Electron, Node, filesystem, archive, registry and Windows work belongs under
`electron/`. Screen code never imports native implementations.

Keep:

- Node integration off.
- Context isolation and sandbox on.
- Trusted sender and top-frame validation on every IPC route.
- Named, runtime-validated capabilities instead of raw IPC/filesystem access.
- CBZ paths native-only; the screen receives opaque identities or pending revisions.
- No external navigation or child windows.
- No forged Windows `UserChoice` hashes.

`ShellHost.d.ts` is the neutral type-only wire contract. Preload and native handlers
must implement and runtime-validate the same contract.

### Preserve current Reader behavior

Do not change these unless the operator requests that exact behavior:

- PixiJS 8.23.0/WebGL2 draws all loaded pages in one OffscreenCanvas worker.
- `maxFPS: 0` means no application FPS ceiling; browser/display VSync still applies.
- Lossless 1024-pixel tiles use a nominal 128 MiB bitmap/texture pool.
- Visible pixels are protected; budget limits are estimates, not RSS/VRAM guarantees.
- Same-direction mouse-wheel ticks join within 150 ms; the first tick is immediate.
- Scroll speed remains 1×–10× and Smooth Scroll remains 100–2000 ms, default 250 ms.
- Momentum duration is 100–2000 ms, default 200 ms, independent of smooth scroll.
- Settings persist as validated overrides; Reset removes the override.
- Ctrl+wheel zooms and Ctrl+0 returns exactly to 100%.
- Opening geometry/DPI remains fixed for accepted pages; resize changes the viewport,
  not accepted page dimensions or decode width.
- First configured pages appear before sequential completion.
- Current and speculative next chapter are retained; backward history reloads on demand.
- Previous/List/Next remain a bottom hover overlay and preserve zoom/speed.
- Drag/drop accepts one real CBZ and reuses the normal Reader workflow.
- Explorer cold-start and second-instance CBZ requests reuse the same workflow.
- Failed/cancelled replacement preserves readable content.
- Diagnostics remain opt-in and disabled by default.
- No permanent header, right scrollbar gutter, idle draw loop or React scroll-frame loop.

### Temporary planning documents

A `*-plan.md` file is optional temporary working material, not project truth.

- Do not create a plan for a small, clear task.
- If a complex task needs one, use it only while that task is active.
- Before completion, transfer lasting current rules/status into this file.
- Delete the temporary plan when the task completes.
- Never mention a temporary plan in the README work log; future agents must not be
  directed toward a file that is intended to disappear.

There is currently no active plan document. Current unfinished work is recorded in
the **Current unfinished work** section below.

### Documentation roles

- `AGENTS.md` is current truth: identity, goals, ownership, rules, complete file map,
  current behavior, unfinished work and completion procedure.
- `README.md` is an append-only completed-work log for the operator. Entries are
  oldest-to-newest and contain Summary, Done, Why and Result. Add new entries only
  at the bottom. Never reorder, rewrite or delete an old entry; append a correction
  entry if an old fact later proves wrong.
- Temporary plans are private working checklists and disappear at completion.
- `.runtime/` is generated evidence/backups. Evidence proves only the named check at
  its recorded time; it is not automatically current truth.

## Current workspace situation

### Delivered

- Strict TypeScript modular Reader with automatic area/child discovery.
- GPU all-page CBZ rendering, bounded tile residency and joined wheel momentum.
- Zoom, chapter continuation/navigation, drag/drop and persistent speed/smooth/momentum.
- Independent Library and Downloader frameless base windows.
- Distinct process names, icons, app IDs, userData and single-instance locks.
- Thin Library-default suite launcher and direct role launchers.
- Isolated portable production and versioned ZIP/SHA-256 release artifact.
- Per-user Yuzread Reader CBZ registration.
- Cold-start and already-running Explorer CBZ opening.
- Stale Calibre associations removed while preserving Yuzread's protected default;
  machine-maintenance evidence is under
  `.runtime/calibre-cleanup-20261124-230402/`.

### Current production identity

- Suite/version: Yuzread `0.1.0` from `package.json`.
- Suite default: Library from `electron/suite.json`.
- Portable root: `portable/Yuzread/`.
- Release: `releases/Yuzread-0.1.0-win-x64.zip` plus `.sha256`.
- CBZ ProgID: `Yuzread.Reader.CBZ.1`.
- Reader default currently selected in Windows `UserChoice`; never forge or rewrite
  that protected selection.

### Development state location

Development launchers do not use portable storage. `electron/main.cts` places their
Electron `userData` under
`C:\Apps\yuzread\.runtime\dev-userdata\<application.userDataFolder>` instead of
`%APPDATA%\<application.userDataFolder>`. Reader state therefore lives at
`.runtime/dev-userdata/Yuzread/load-folder.json` and
`.runtime/dev-userdata/Yuzread/reader-preferences.json`; `reader-cache` and Electron
generated files stay in that same directory. The former `%APPDATA%\Yuzread` profile
was moved into the repository, so no Yuzread application JSON remains outside this
workspace. QA profiles still use `.runtime/qa-profile-*`; daily-use portable data
still uses `portable/Yuzread/data/reader/`.

### Current unfinished work

- Operator feel comparison for uncapped Reader pacing remains subjective and unverified.
- Presented FPS, universal real-book performance and GPU-loss recovery are not certified.
- Library catalog/business behavior is not implemented.
- Downloader acquisition/business behavior is not implemented.
- Downloader-to-Library completed-file layout and Library-to-Reader handoff require
  explicit design before implementation.
- GitHub Release publication and automatic update behavior are not implemented.
- No installer is planned unless the operator changes direction.

## Complete workspace file map

Labels distinguish editable source from generated output. Every project-owned source,
configuration, launcher, documentation and test file is listed. Generated/vendor
trees are represented by their owning directory because their contents are produced
or installed, not individually maintained.

```text
C:\Apps\yuzread\
├── AGENTS.md                              [documentation/current contract] This file.
├── README.md                              [documentation/append-only log] Completed outcomes.
├── ShellHost.d.ts                         [contract/source] Native ↔ screen wire types.
├── package.json                           [tooling/source] Version, dependencies and commands.
├── package-lock.json                      [tooling/lock] Exact npm dependency graph.
├── tsconfig.json                          [tooling/source] Shared TypeScript settings.
├── tsconfig.electron.json                 [tooling/source] Native .cts compilation.
├── tsconfig.screen.json                   [tooling/source] Browser/UI strict checking.
├── tsconfig.tools.json                    [tooling/source] Build/tool script checking.
├── vite.config.mts                        [tooling/source] Screen build and worker bundling.
├── .prettierrc.json                       [tooling/source] Formatting policy.
├── .prettierignore                        [tooling/source] Formatter exclusions.
├── .gitignore                             [tooling/source] Generated/private output exclusions.
├── start.cmd                              [launcher/source] Suite launcher; Library default.
├── start-reader.cmd                       [launcher/source] Direct Reader development entry.
├── start-library.cmd                      [launcher/source] Direct Library development entry.
├── start-downloader.cmd                   [launcher/source] Direct Downloader development entry.
├── desktop.ini                            [Windows/ignored] Explorer metadata; do not edit.
│
├── electron\                              [native/source] Electron, Windows and filesystem owners.
│   ├── main.cts                           App lifecycle, role selection, IPC and composition.
│   ├── preload.cts                        Sandboxed validated screen capability bridge.
│   ├── AppWindow.cts                      Native window creation, geometry and commands.
│   ├── WindowConfig.cts                   Native window configuration validation.
│   ├── SectionHover.cts                   Native hover/drag-region observation.
│   ├── DiagnosticLog.cts                  Bounded native diagnostic file writing.
│   ├── PortableRuntime.cts                Portable paths, cleanup and retention policy.
│   ├── SuiteApplications.cts              Discovers and validates sibling app declarations.
│   ├── SuiteLauncher.cts                  Starts one selected branded app and exits.
│   ├── SuiteRuntime.cts                   Builds shared development runtime and branded EXEs.
│   ├── SuiteRuntimeIcons.cts              Produces role-specific icon artwork/resources.
│   ├── SuiteRuntimeBrandExecutable.ps1    Updates staged Windows EXE metadata/resources.
│   ├── SuitePortable.cts                  Assembles portable product, ZIP and checksum.
│   ├── SuitePortableLauncher.cs           Thin suite launcher and CBZ registry commands.
│   ├── install-electron.cts               Installs/verifies the pinned Electron runtime.
│   ├── prepare-types.cts                  Exact-version MUI/Pixi declaration repairs.
│   ├── build-icon.py                      Source icon conversion helper.
│   ├── electron-runtime.json              Pinned Electron archive/runtime identity.
│   ├── suite.json                         Suite-level default application declaration.
│   ├── config.json                        Reader native title/window/startup configuration.
│   ├── assets\                            [native/source assets]
│   │   ├── app-icon.png                   Preserved original suite PNG artwork.
│   │   ├── app-icon.ico                   Preserved original suite Windows icon.
│   │   ├── yuzread-reader.png             Reader standalone PNG icon.
│   │   ├── yuzread-reader.ico             Reader Windows icon.
│   │   ├── yuzread-library.png            Library PNG icon.
│   │   ├── yuzread-library.ico            Library Windows icon.
│   │   ├── yuzread-downloader.png         Downloader PNG icon.
│   │   └── yuzread-downloader.ico         Downloader Windows icon.
│   ├── reader\                            [native/source Reader owner]
│   │   ├── application.json               Reader identity/process/config declaration.
│   │   ├── CbzArchive.cts                 Archive catalog, decode, cache, budget and page protocol.
│   │   ├── ReaderExternalOpen.cts          Validated cold/second-instance CBZ FIFO.
│   │   └── ReaderPreferences.cts           Validated atomic Reader override persistence.
│   ├── library\                           [native/source Library owner]
│   │   ├── .gitkeep                       Repository marker; no runtime behavior.
│   │   ├── application.json               Library identity/process/config declaration.
│   │   └── config.json                    Library native window configuration.
│   └── downloader\                        [native/source Downloader owner]
│       ├── .gitkeep                       Repository marker; no runtime behavior.
│       ├── application.json               Downloader identity/process/config declaration.
│       └── config.json                    Downloader native window configuration.
│
├── electron-built\                        [native/auto-generated] Compiled .cjs; never edit.
│
├── screen\                                [screen/source] Browser/UI applications and mechanics.
│   ├── main.tsx                           Bootstrap, native adapters and root ports.
│   ├── Screen.tsx                         Generic discovered-area composition parent.
│   ├── config.json                        Shared presets plus complete Reader screen plan.
│   ├── environment.d.ts                   Browser bridge and QA declarations.
│   ├── index.html                         Vite document and security policy shell.
│   ├── styles.css                         Reset, full-window and native drag mechanics.
│   ├── shared\                            [screen/source shared mechanics]
│   │   ├── components\
│   │   │   ├── ActionButton.tsx           Reusable configured icon button.
│   │   │   ├── AreaLayout.tsx             Area/slot placement and failure isolation.
│   │   │   ├── ConfiguredRow.tsx          Config-driven row order and sizing.
│   │   │   ├── ConfiguredValueSlider.tsx  Shared accessible controlled slider.
│   │   │   ├── LayoutInspector.tsx        Development-only layout inspection UI.
│   │   │   ├── SettingScreenSectionCard.tsx Shared collapsible settings card chrome.
│   │   │   └── WindowControlButtons.tsx   Shared Minimize/default/Close rendering mechanics.
│   │   └── logic\
│   │       ├── Appearance.ts              Converts validated appearance into styles.
│   │       ├── AreaDiscovery.ts           Discovers area roots and parent-local children.
│   │       ├── ConfigValidation.ts        Validates hierarchy, layout and connections.
│   │       ├── Diagnostics.ts             Structured issue collection and deduplication.
│   │       ├── NumberPreference.ts        Reusable numeric preference validation mechanics.
│   │       ├── ParentConnections.ts       Parent-scoped typed ports and cleanup.
│   │       ├── VisualConfig.ts            Visual/preset codecs and shared types.
│   │       └── WindowControlPorts.ts      Shared native-window command codecs.
│   ├── reader\                            [screen/source complete Reader app]
│   │   ├── action-bar\
│   │   │   └── ActionBar.tsx              Retained disabled Reader area parent.
│   │   ├── windows-area\
│   │   │   ├── WindowsArea.tsx            Top-overlay parent: discovery/placement/relay.
│   │   │   ├── WindowsAreaContract.ts     Top-overlay ports and codecs.
│   │   │   ├── WindowsAreaBtnClose.tsx    Close feature child.
│   │   │   ├── WindowsAreaBtnDefaultSize.tsx Default-square feature child.
│   │   │   ├── WindowsAreaBtnLoad.tsx     Native CBZ picker feature child.
│   │   │   ├── WindowsAreaBtnScrollSpeed.tsx Speed popup, value and persistence child.
│   │   │   ├── WindowsAreaBtnSettingScreen.tsx Settings popup shell/drag/focus child.
│   │   │   ├── WindowsAreaTitle.tsx       Retained disabled title child.
│   │   │   └── setting-screen\
│   │   │       ├── WindowsAreaBtnSettingScreenSections.ts Discovers local settings sections.
│   │   │       ├── WindowsAreaBtnSettingScreenSectionSmoothScroll.tsx Smooth-scroll setting.
│   │   │       └── WindowsAreaBtnSettingScreenSectionMomentumDuration.tsx Momentum duration setting.
│   │   ├── body\
│   │   │   ├── Body.tsx                   Reader-body parent: placement and relay only.
│   │   │   ├── BodyContract.ts            Reader-body request/state contracts.
│   │   │   └── reader\
│   │   │       ├── BodyReader.tsx         Reader workflow, chapters, zoom, UI and coordination.
│   │   │       ├── BodyReaderPixi.ts      Canvas, input and worker bridge lifetime.
│   │   │       ├── BodyReaderPixiWorker.ts GPU tiles, drawing, camera and momentum.
│   │   │       ├── BodyReaderPixiWorkerContract.d.ts Local worker message contract.
│   │   │       └── BodyReaderPixiWorkerPolicy.ts Pure momentum/geometry calculations.
│   │   └── bottom-bar\
│   │       ├── BottomBar.tsx               Bottom-overlay parent: placement and relay.
│   │       ├── BottomBarContract.ts        Chapter-navigation ports and codecs.
│   │       ├── BottomBarChapterNavigation.tsx Previous/List/Next feature child.
│   │       └── BottomBarStatus.tsx         Retained disabled status child.
│   ├── library\                           [screen/source Library base app]
│   │   ├── .gitkeep                       Repository marker; no runtime behavior.
│   │   ├── config.json                    Library local screen plan.
│   │   ├── body\
│   │   │   └── LibraryBody.tsx            Empty future Library feature parent/workspace.
│   │   └── windows-area\
│   │       ├── LibraryWindowsArea.tsx      Library top-overlay parent.
│   │       ├── LibraryWindowsAreaControls.tsx Library window-control child.
│   │       └── LibraryWindowsAreaTitle.tsx Hidden Library title child.
│   └── downloader\                        [screen/source Downloader base app]
│       ├── .gitkeep                       Repository marker; no runtime behavior.
│       ├── config.json                    Downloader local screen plan.
│       ├── body\
│       │   └── DownloaderBody.tsx          Empty future Downloader feature parent/workspace.
│       └── windows-area\
│           ├── DownloaderWindowsArea.tsx   Downloader top-overlay parent.
│           ├── DownloaderWindowsAreaControls.tsx Downloader window-control child.
│           └── DownloaderWindowsAreaTitle.tsx Hidden Downloader title child.
│
├── screen-built\                          [screen/auto-generated] Vite output; never edit.
│
├── tests\                                 [verification/source] Focused checks and QA drivers.
│   ├── code-contract-check.mjs            Static source coverage/ownership guard.
│   ├── contract.test.mjs                  Screen schema, discovery and contract tests.
│   ├── modular-area-proof.mjs             Runtime proof of automatic area/child discovery.
│   ├── shell-proof.mjs                    Main Reader shell UI integration proof.
│   ├── chapter-navigation-smoke.mjs       Bottom chapter navigation integration proof.
│   ├── persistent-settings-smoke.mjs      Reader preference persistence integration proof.
│   ├── scroll-speed-smoke.mjs             Live speed panel/worker integration proof.
│   ├── setting-screen-smoke.mjs           Settings popup interaction proof.
│   ├── reader-proof.mjs                   General Reader archive workflow proof.
│   ├── reader-preparation-proof.mjs       Native decode/cache/integrity proof.
│   ├── reader-geometry-proof.mjs          Page sizing/geometry proof.
│   ├── reader-zoom-proof.mjs              Zoom anchor/input regression proof.
│   ├── reader-chapters-proof.mjs          Continuation/residency/backward-load proof.
│   ├── reader-scheduling-proof.mjs        Priority and shared-budget proof.
│   ├── reader-diagnostics-proof.mjs       Opt-in diagnostics and cleanup proof.
│   ├── reader-drop-smoke.mjs              Explorer drag/drop integration proof.
│   ├── reader-pixi-smoke.mjs              GPU pages, movement, resize and cleanup proof.
│   ├── reader-resource-proof.mjs          Tile/resource/reuse performance evidence driver.
│   ├── cbz-native-open-smoke.mjs          Cold/running packaged Explorer-open proof.
│   ├── external-open.test.mjs             Native argv parser/FIFO unit tests.
│   ├── suite-applications.test.mjs         Role identity/discovery/isolation tests.
│   ├── suite-launcher.test.mjs             Suite selection and failure unit tests.
│   ├── suite-launcher-smoke.mjs            Real branded launcher/process proof.
│   ├── suite-windows-smoke.mjs             Three independent native windows proof.
│   ├── portable-runtime.test.mjs           Portable paths/cleanup/dependency tests.
│   ├── portable-package.test.mjs           Portable contents/manifest/checksum tests.
│   ├── portable-smoke.mjs                  Packaged three-app runtime proof.
│   ├── move-pointer.ps1                    Controlled native pointer movement helper.
│   └── native-drag.ps1                     Controlled native window drag helper.
│
├── node_modules\                          [dependencies/auto-generated] npm-managed; never edit.
├── .runtime\                              [evidence/auto-generated] QA results/backups/runtime.
│   ├── dev-userdata\                      [dev/runtime state] In-repository userData for launchers.
│   └── qa-profile-*                       [dev/runtime state] Isolated QA userData profiles.
├── .agents-temp\                          [temporary/auto-generated] Task scratch; remove own leftovers.
├── portable\Yuzread\                      [product/auto-generated] Actual-use portable suite.
│   ├── data\                              [product/persistent] User settings; preserve on rebuild.
│   ├── cache\                             [product/disposable] Role caches/temp/session data.
│   ├── logs\                              [product/bounded] Role diagnostics.
│   ├── crash-dumps\                       [product/bounded] Role crash reports.
│   └── resources\app\                    [product/auto-generated] Packaged compiled app.
├── releases\                              [release/auto-generated] ZIP and checksum deliverables.
└── .git\                                  [version-control] Git metadata; never edit manually.
```

## Launch, build and verification

Development launchers:

```text
start.cmd                 Library by default
start-reader.cmd          Reader
start-library.cmd         Library
start-downloader.cmd      Downloader
```

Important commands:

```text
npm run check:code        Strict types, format check and ownership/contracts
npm run build:electron    Compile native TypeScript
npm run build:screen      Build browser/UI output
npm run build             Validate and build both boundaries
npm run build:portable    Rebuild portable product and release artifacts
npm run check             Historical broad test/UI suite; do not run routinely
```

Use the narrowest focused test that can detect the requested behavior. Do not repeat
historical proofs or broad benchmarks by habit. UI/visual claims require current UI
evidence. Performance counters are observations, not universal guarantees.

Generated source rules:

- Never edit `electron-built/` or `screen-built/`.
- Never edit packages under `node_modules/`.
- Rebuilding portable production must preserve `portable/Yuzread/data`, logs and
  crash dumps according to `SuitePortable.cts`; cache is disposable.
- Keep scratch under repository `.agents-temp/` and remove only this task's leftovers.
- Do not treat `.runtime/` evidence as editable implementation.

## Hard completion rule: document, commit and push

No authorized workspace change is complete until all applicable steps below succeed:

1. Implement only the requested scope.
2. Run focused validation and `npm run check:code` when source/config/contracts changed.
3. Update this file's timestamp, implementation checkpoint, current behavior,
   unfinished work and file map when affected.
4. Append one concise entry to the bottom of `README.md` with:
   - **Summary**
   - **Done**
   - **Why**
   - **Result**
5. Delete any completed temporary plan after transferring durable current truth here.
6. Review `git diff`, `git diff --check` and `git status`; preserve unrelated work.
7. Commit the authorized changes with a descriptive message.
8. Push the current branch to its configured upstream.
9. Report the pushed commit SHA, validation actually run and any remaining limitation.

Hard prohibitions:

- Never force-push.
- Never rewrite published history.
- Never silently include unrelated modifications.
- Never claim completion when commit or push failed.
- If no upstream, authentication or network access blocks pushing, commit what is
  safely owned, report the exact blocker and mark the task blocked/partial.
- Documentation-only changes follow the same commit-and-push rule.

The final response leads with the outcome, not a narration of routine steps.
