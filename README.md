# Yuzread completed-work log

This is the operator's append-only record of completed outcomes. Entries stay in
time order, oldest to newest. Add new entries only at the bottom. Do not reorder,
rewrite or delete earlier entries; append a correction when an earlier result later
proves incomplete or wrong.

Current operating rules, architecture, file ownership, launch commands and unfinished
work live in `AGENTS.md`.

## 2026-11-22 — Strict modular Reader foundation

**Summary:** Yuzread's Reader was converted into a strict TypeScript application with
folder-visible ownership.

**Done:** Established generic area discovery, parent-local child registration, typed
connections, runtime validation, strict source checks and separate native/screen
boundaries.

**Why:** The operator navigates by folder and filename. Feature ownership needed to be
visible without reading implementation syntax or maintaining central child lists.

**Result:** Reader areas and children became independently owned modules. Invalid
duplicates, incompatible connections and cross-owner imports are rejected by focused
checks.

## 2026-11-23 — Complete GPU Reader workflow

**Summary:** Reader moved all loaded page drawing and smooth movement to the Pixi GPU
worker while retaining the existing archive workflow.

**Done:** Added all-page GPU rendering, bounded lossless tiles, joined mouse-wheel
momentum, zoom, same-folder chapter continuation, backward reload, bottom chapter
navigation, drag/drop, resource reuse and opt-in diagnostics.

**Why:** Scrolling needed to remain smooth while decoding continues without duplicating
full page pixels in DOM images or abandoning Reader's established geometry, cache and
failure behavior.

**Result:** Focused page, pixel, chapter, zoom, resize, reversal, cache and cleanup
checks passed. The application ceiling is currently disabled with `maxFPS: 0` for
operator comparison. Presented FPS and universal real-book performance remain
uncertified.

## 2026-11-24 18:39:52 +07:00 — Persistent Reader settings

**Summary:** Scroll speed and smooth-scroll duration became persistent Reader settings.

**Done:** Added shared setting-card and slider mechanics, validated numeric preference
schemas, atomic override storage, live worker updates and Reset behavior that removes
the saved override.

**Why:** User preferences needed to survive restarts without writing packaged defaults
or turning shared UI controls into Reader feature controllers.

**Result:** Saved values load before worker creation, update live and return to
configured defaults after Reset. Static, build and focused persistence checks passed.
Source checkpoint: `8dc6dba240c7000c5294da9ada325d26a527957f`.

## 2026-11-24 23:04:02 +07:00 — Stale Calibre association cleanup

**Summary:** Removed obsolete Calibre registry ownership without disturbing Yuzread's
selected CBZ default.

**Done:** Backed up and removed the absent Calibre capability tree, 78 ProgID roots,
78 extension references, three RegisteredApplications values, 20 association-toast
values and six Explorer Open With values.

**Why:** Windows still exposed paths to Calibre executables that were no longer
installed.

**Result:** Yuzread remained the protected `.cbz` default with the same UserChoice
hash. Cleanup evidence is stored under
`.runtime/calibre-cleanup-20261124-230402/`.

## 2026-11-24 23:43:08 +07:00 — Portable three-application suite and native CBZ opening

**Summary:** Yuzread became an isolated portable suite with independent Reader,
Library and Downloader apps, and Reader became the native CBZ opener.

**Done:** Added role declarations, three branded executables, independent base windows,
a Library-default thin launcher, portable-local data/cache/log/crash ownership,
portable ZIP/checksum assembly, per-user CBZ registration and cold/running Explorer
file delivery through the existing Reader workflow.

**Why:** Each application needs a clear identity and ownership boundary while sharing
one runtime. Native opening must not expose filesystem paths to screen code or create a
second Reader workflow.

**Result:** Fresh static checks and 23 focused identity, launcher, portable, schema and
external-open tests passed. Real packaged CBZ checks previously passed cold and
already-running opening through Pixi Reader. Source checkpoint:
`df341362dca3e870632cc74c2f12e7cf20255ffd`.

## 2026-11-24 23:46:08 +07:00 — Permanent workspace onboarding contract

**Summary:** Workspace knowledge was consolidated so a new agent can continue without
the operator retelling the project history.

**Done:** Rebuilt `AGENTS.md` around identity, project goal, architectural reasons,
strict operating rules, current state, unfinished work and a complete explained file
tree. Defined this file as the append-only completed-work log.

**Why:** The previous documents mixed current rules, superseded statements, historical
measurements and temporary task details, making it difficult to identify the current
truth.

**Result:** Current operating knowledge now has one permanent owner, generated folders
are visibly classified, and every completed workspace change must be documented,
validated, committed and pushed before it can be reported complete.

## 2026-11-27 20:24:44 +07:00 — Development state moved into the repository

**Summary:** Development-launcher userData now stays inside `C:\Apps\yuzread`; the
legacy `%APPDATA%\Yuzread` profile was moved, and the workspace documentation now
records where each launch mode keeps its state.

**Done:** Changed the non-portable userData fallback in `electron/main.cts` to
`.runtime\dev-userdata\<application.userDataFolder>`. Moved the existing development
profile, including `load-folder.json` and `reader-preferences.json`, into
`.runtime\dev-userdata\Yuzread` and removed the old `%APPDATA%` directory. Added the
development-state section, file-map entries and an updated checkpoint to `AGENTS.md`.

**Why:** Daily use is the portable suite, but development launchers were still writing
Reader JSON outside the project folder. Keeping both launch modes inside their own
owned folders makes the storage boundary visible and prevents stale external state
from being mistaken for the portable product's data.

**Result:** `npm run check:code` passed and both `build:electron` and
`build:suite-runtime` succeeded. A short development Reader launch stayed responsive
while writing fresh Electron state (`lockfile`, `blob_storage`, `DIPS-wal`) into
`.runtime\dev-userdata\Yuzread`; the old `%APPDATA%\Yuzread` path was not recreated
and both Reader JSON files retained their values. The test process was closed
gracefully. Portable daily-use state at `portable\Yuzread\data\reader\` was untouched.

## 2026-11-28 — Separate Momentum duration setting

**Summary:** Reader gained an independent Momentum duration card in Setting Screen that
controls how long wheel movement continues after the last input, separately from Smooth
scroll.

**Done:** Added a `momentumDurationMs` validated preference (100–2000 ms, step 10, default
200 ms) with its own Setting Screen section card, live apply, persistence and Reset.
Threaded the value through the body contract, Windows Area ports, Reader body effect,
Pixi surface and worker policy. The worker now spreads the remaining wheel credit across
the configured momentum window, so a shorter setting stops sooner without changing the
total distance one wheel notch scrolls.

**Why:** The operator wanted stopping feel to be tunable on its own; Smooth scroll already
controls how softly input is absorbed, so coupling both behaviours in one slider left no
way to shorten or lengthen the tail without also changing the smoothness.

**Result:** `npm run check:code` passed (66 production files, strict types, formatting and
contract checks) and `tests/contract.test.mjs` passed all 49 cases, including wheel travel,
reversal, smooth-duration pacing and section discovery. Measured travel stays at 3600 px
for twenty 100 ms-spaced notches at 200 ms momentum and above; a single notch still stops
inside its configured window. Scroll Anywhere outside-window capture was not delivered in
this entry and remains unfinished work.

## 2026-11-28 - Scroll Anywhere outside-window wheel capture

**Summary:** Reader gained a latched Scroll Anywhere toggle immediately left of Scroll
Speed. While it is on, ordinary vertical wheel input scrolls the manga even when the
pointer is outside the whole Reader window and another application has focus.

**Done:** Added a bundled Windows low-level wheel-hook helper
(`electron/reader/ReaderGlobalWheelHost.cs`) compiled at build time into
`electron-built/reader/ReaderGlobalWheelHost.exe`, plus the native lifetime adapter
`ReaderGlobalWheel.cts`, trusted IPC routes and runtime-validated preload capabilities.
The helper consumes wheel input only while armed, only outside the Reader window, only
without Ctrl/Shift/Alt/Win and only for vertical deltas; everything else passes through
untouched, injected events are skipped and the Reader never takes focus. The screen side
adds `WindowsAreaBtnScrollAnywhere.tsx` (component `reader.scrollAnywhere`), Windows Area
state relay, Body wheel/readiness ports and `injectExternalWheel` in `BodyReaderPixi.ts`,
which reuses the shared wheel advance path and configured scroll speed. The latch is
session-only, defaults to OFF every launch, is never written to preferences, and
minimize/hide pauses capture without unlatching.

**Why:** Reading long pages meant moving the pointer back over the Reader between every
few notches, and focus-following capture would have broken normal use of other windows.
A single bundled helper keeps the outside-window path exclusive and cheap, while the
latch makes the state explicit and reversible.

**Result:** `npm run check:code` passed (69 production files, 23 type proofs) and
`tests/contract.test.mjs` passed all 50 cases, including the new latch-label and
connection checks. A focused `tests/scroll-anywhere-smoke.mjs` run passed: the helper
process count stayed at 0 before latching and 1 while latched, a single native wheel
event advanced the reader by 81 px, malformed external wheel input was rejected, the
toggle sat immediately left of Scroll Speed with matching row geometry, the latch
survived minimize/restore without changing window focus, and no Scroll Anywhere
preference appeared in `reader-preferences.json`. `npm run build:portable` rebuilt the
portable product with the helper at
`portable/Yuzread/resources/app/electron-built/reader/ReaderGlobalWheelHost.exe`; the
portable Reader started with capture OFF (0 helper processes) and preserved
`data/reader/reader-preferences.json`, logs and crash dumps.
