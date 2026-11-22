# Yuzread reader plan — remaining stages 5–6

Completed geometry, width/cache guards, zoom, current + next continuation and
Open placement are recorded with their ownership/reasons/evidence in `AGENTS.md`.
This plan contains only unfinished scheduling and diagnostics work. Citadel remains
a reference for behavior, not imported/copied code or an application to launch.

## Approved decisions — 2026-11-22

- Zoom is included: Ctrl+wheel, Ctrl+0, default 1.0, configured 0.5–3.0 range and
  0.1 steps. Browser page zoom must not run alongside reader zoom.
- Automatically continue into the next CBZ, using natural filename order among
  CBZ files in the initially opened file's folder. No picker for each chapter.
- Keep the current dark reader background and centered page presentation.
- Keep the initial 3–5-page display, then silently finish the current chapter;
  prepare the next chapter in the background without blocking current reading.
- Chapter residency uses **current + next**, selected by the operator after phase 3.
  No permanent previous slot or speculative previous-chapter preload. Earlier
  chapters are loaded on demand if the reader moves backward.
- Open CBZ belongs in the hover-revealed Windows area. No permanent bottom
  reader toolbar. Preserve the existing configured button placement.
- Keep square startup, return-to-default window action, native icon/taskbar
  identity, body layout and configured hover strip unchanged.
- This is the one active reader plan. Do not rebuild completed stages or add an
  architecture migration before completing the remaining bounded slices.

## Status

| Stage | State | Evidence |
| --- | --- | --- |
| 5. Preparation scheduling | partial | sequential current-then-next work exists; demand prioritization/preemption and combined resource limits remain to build |
| 6. Reader diagnostics | pending | measurement harness exists in the proof; no in-app log yet |

Preserve the completed reader contracts in `AGENTS.md`: fixed page geometry and
accepted images, exact zoom/anchors, current + next (no permanent previous slot),
safe visible-content eviction, frozen native authorization and stale-work cleanup.

## Stage 5 — Preparation scheduling

- Preserve early first-page display and current-then-next sequential preparation.
- Add bounded aggregate decode parallelism, mirroring Citadel's `MaxDecodeParallelism`.
- Add priority/preemption between pages for visible or backward-demand work rather
  than forcing it to wait for a long speculative next decode to finish.
- Keep between-page yielding and no ordinary-scroll animation/React frame loop.
  A worker does not make CPU/memory-bandwidth competition impossible.

Current visible/initial pages take priority over neighbor work. Use one aggregate
background queue, not one independent busy decode loop per resident chapter.
Estimate resources across resident chapters, cached variants and in-flight buffers.
If the budget is insufficient, defer unused neighbor work and report the condition;
do not secretly stretch/downscale current pages or evict them individually.

## Stage 6 — Reader diagnostics

Citadel's `ReaderDiagnosticsFeature` samples composition callbacks, hitches and
scroll continuity, separating "the frame stalled" from "the viewport moved
somewhere nobody asked for". CompositionTarget.Rendering and requestAnimationFrame
are callback-cadence signals, not proof of every GPU-presented frame. Yuzread's proof collects animation callback
cadence, GPU feature state and display frequency into
`.runtime/reader-proof-*/result.json`. The in-app `reader-diagnostics.log`
feature is still to build. A hitch is a frame of 25 ms or more; a jump is an
unwanted scroll displacement of 2 px or more.

Diagnostics remain opt-in and inert in normal reading. Use Chromium performance
evidence for dropped/presented frames where available, along with main-thread
stalls, decode/attach times and unexpected scroll jumps. Measure active scrolling
with real CBZs as well as fixtures, including loading, chapter seams and zoom.
Target the actual configured display refresh rate (144 Hz requested; an earlier
environment check reported 165 Hz) with 60 FPS as a measured minimum goal. Do not
unlock arbitrary frame limits or force identical redraws while the page is idle.

## File ownership and delivery order

```text
electron/reader/CbzArchive.cts       Dialog, chapter catalog, archive worker,
                                   variant cache, page protocol and cleanup
screen/body/reader/BodyReader.tsx   Geometry, zoom, chapter roles/anchors,
                                   loading/preload state, DOM and diagnostics
screen/windows-area/WindowsAreaBtnLoad.tsx  Open entry point only; uses parent callback
screen/windows-area/WindowsArea.tsx + screen/Screen.tsx + screen/body/Body.tsx
                                   Parent-only forwarding; no reader algorithms
electron/main.cts + preload.cts     Native service/bridge wiring only
screen/config.json                 Placement, labels, visuals, sizing/zoom settings
```

Keep technical jobs in named sections of these owners, not twelve new folders or
separate feature frameworks. Generic screen assembly discovers/places area roots;
it never owns page sizing, archive loading or reading rules. Preserve unrelated
changes and the separate template snapshot.

Next slice: aggregate scheduling/resource admission and demand priority, then opt-in
diagnostics. Do not rebuild completed geometry/zoom/chapter/Open behavior or run
unrelated historical proofs by default.

Focused acceptance checks, not a full suite:

1. Aggregate budget pressure with current + next and several visible short chapters:
   visible content is never evicted to force a count; speculative work defers safely.
2. Backward/visible demand arriving during a long next decode: between-page
   preemption/priority works while accepted pixels and anchors remain unchanged.
3. Failed preparation, reopen during preload and normal close:
   preserve the readable chapter, cancel/clean workers and invalidate old tokens.
4. Open stays in the hover bar, the body has no permanent bottom toolbar, dark
   background and shell/native icon/launch geometry stay unchanged.
5. Opt-in diagnostics are inert when off. Measure loading, zoom and chapter seams
   with fixtures and real CBZs; distinguish callback cadence from presented frames.
   Report actual refresh rate, evidence coverage and unverified limits.

## Out of scope

Library, downloader, drawer, dim overlay, auto-scroll, manual momentum scroll,
fullscreen, page thumbnails, and the CBZ cache reuse across sessions are not part
of this plan.
