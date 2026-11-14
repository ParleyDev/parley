# Parley Studio: Phase 5 results (editing workflow and engine responsiveness)

| | |
|---|---|
| Date | 2026-11-14 |
| Plan | [DAW_COMPLETION_PLAN.md](DAW_COMPLETION_PLAN.md), Phase 5 |
| Tracker | `parley-pods.16` |

Every result here is *measured* by a suite in `frontend/e2e/suites/` against a running stack with headless browsers,
or by the unit tests. The engine checks work on audio: what plays is captured sample for sample from the master and
compared with arithmetic or with the offline render. What was not built or not measured is listed in section 5 and
is not claimed.

## 1. What changed

### The engine

- **Edits no longer restart playback.** Each clip that plays has its own voice. When the project changes while it
  plays, the engine compares what should sound with what does: changed clips get new voices, the others play on;
  levels and effect settings are applied to the running mixer; automation is laid out again when it changed
  (`reshape`, `resync`, `reautomate` in `frontend/src/lib/daw.ts`). Playback starts again, from where it is, only
  when the mixer's *shape* changes (a track, a bus, an effect or an automated parameter added or removed, routing
  changed) or the loop is switched or its range moved.
- **Loops are laid out ahead.** The turns of a loop are queued a few seconds ahead on the audio clock, so a page
  whose timers run once a second still turns on the sample.
- **Overlapping clips on a track.** Where audio clips on one track overlap, the one that starts later is heard and
  the other is silent under it, with a crossfade of up to 10 ms at each edge (`seams` in
  `frontend/src/lib/dawops.ts`). The same rule is used for playing and for the render.
- **A noise gate and a look-ahead limiter** as worklet effects (`parley-gate`, `parley-limiter` in
  `frontend/src/lib/worklets/studio.js`), on a track, a bus or the master, in playback and in the render. The
  limiter looks 2 ms (96 frames) ahead and delays its signal by as much. The server accepts `gate` as an effect.
- **Instruments played by hand go through their track**: effects, fader, pan and mute, playing or stopped. A key
  let go after the octave was changed, or while the window was elsewhere, stops the note it started.

### Editing

- **Copy, cut and paste** of the selected clips (at the playhead, on their own tracks), **arrow keys** to nudge by the
  grid (with Shift, by a millisecond), a **selection box** dragged over empty timeline, **Ctrl/Cmd-drag** to copy and **Alt-drag** to move free of
  the grid, **Ctrl/Cmd+wheel** to zoom about the pointer, **handles on the loop's edges**, **markers that drag**.
- **Tracks** can be made taller or lower (kept on the device) and moved up and down (shared, an edit of `position`).
- **Take lanes.** Takes recorded over one another on a track form a group; the track shows the one in use and can
  be opened into a row per take. A click on a take uses it there. Splitting splits every take of the group, so each
  side can use a different one: that is how a comp is made.
- **The playhead, the time display and the meters move outside React.** Regions and track heads are memoised.

### Recording

- **Latency can be measured.** The Audio panel shows the latency the browser reports and offers to measure it: a
  short series of clicks is played and recorded, and the round trip found from the recording. The figure is kept on
  the device for that pair of input and output, used for every take from then on, and can be cleared.
- **The output device** can be chosen where the browser supports it; the studio follows the one chosen for calls.
- **A take draws its waveform while it is recorded.**
- **Monitoring latency** is shown with advice to wear headphones.

## 2. Acceptance criteria

| Criterion (plan) | Result | Where |
|---|---|---|
| React commits near zero while playing | 2 commits in 5 s of playing (0.4 a second), counted through React's developer-tools hook, while the playhead and the time moved | `dawengine`, "playing does not make React draw" |
| No gap in other clips when one is edited during playback | A 1 kHz tone captured from the master while other clips were moved, added, trimmed, turned down and deleted, by this member and by another: no discontinuity in 3.6 s (largest deviation from a pure sine 4.7e-5), level unchanged. The edited clips are heard where and as loud as the edits put them | `dawengine`, "editing while it plays" |
| Ten minutes of looped playback in a background tab has no late pass | **Not as written.** Five minutes of a one-second loop in the foreground of headless Chromium: 300 turns, each exactly 48 000 samples after the one before (0 of 299 are not). On WebKit 30 turns in 30 s, likewise. A background tab was not run, nor ten minutes | `dawengine`, "a loop" |
| Each editing command exact and undoable in one step | Copy, cut, paste, nudge, selection box, copy-drag, free move, zoom at the pointer, loop edges, markers, track order and height, take lanes: each checked on the stored fields, each one version on the server, each undone in one step | `dawedit` (59 checks) |
| Gate and limiter the same live and in export; limiter never over its ceiling | Played and captured, both match the render sample for sample (largest difference 0). The limiter's output peaks at −6.00 dBFS for a ceiling of −6 with 5 dB over full scale going in, in the export and played. The gate is shut under its threshold, open over it, holds, and turns down by its range | `dawengine`, "the limiter and the gate" |
| After calibration, loopback within ±1 ms | Through a loop of 100 ms that the browser reports as about 38 ms, measuring finds 100.1 ms; a take made after it has every burst within 0.04 ms of the backing, and is stored with the measured latency. The measurement survives a reload | `studiorecord` |

Also measured:

| | Result | Where |
|---|---|---|
| A track added while playing | Playback starts again: the tone is silent for about 30 ms and goes on at its level and place | `dawengine` |
| A loop shortened while it plays | Turns at the new length from the next turn | `dawengine` |
| The overlap rule | Six cases of `seams`: clips that overlap nothing, the later clip heard with its crossfade, a clip inside another, two starting together, muted and MIDI clips and other tracks left out, a very short overlap | `dawops.test.ts` |
| An instrument played by hand | Heard hard left on a track panned left; a quarter of the level with the fader at a quarter (the energy of the note, within 0.02); silent on a muted track; stops when its key is let go after an octave change; the same while the project plays (within 8%). Levels are compared from the second note: see section 3 | `dawengine`, "an instrument played by hand" |
| The take's waveform while recording | Drawn from the captured samples during the take | `studiorecord` |

Unit tests: `npm test` (57), `cargo test` (87). Gates: `npx tsc -b`, `npx oxlint src` (warnings only, none new),
`npm run build`. Regression on Chromium: `studio`, `studioaudio`, `studioconsole`, `studiodaw`, `studiodaw2`,
`studiolive`, `studioprojects`, `studiorender`, `studiosync`, `studiotakes`, `studiorecord`, `dawdrag`,
`dawproject` pass. On WebKit: `dawengine`, `dawedit`, `dawdrag`, `dawproject`, `studiosync`,
`studiorender` pass.

## 3. Found on the way

- **A loop's range changed while it played was not followed**: the turns already queued were for the old range.
  The engine now starts again from where it is when the loop changes.
- **A marker jumped by the distance between the pointer and its line** when a drag began. It keeps that distance.
- **What plays and what is rendered are the same samples.** With the gate and the limiter in the path, the captured
  playback and the offline render differ by nothing at all at 48 kHz: the two are one graph built by one function.

- **On WebKit a selection box stopped after its first move.** A drag over the tracks that followed another could
  start the browser's own drag of selected text, which ends the pointer's events: the box stayed as it was and the
  selection was wrong. The tracks no longer select text or start a native drag (`Daw.tsx`). `dawedit` failed on
  WebKit for this and passes now.
- **The first note played by hand after the engine was idle starts harder on WebKit**: its peak was 0.955 against
  0.785 for the notes after it, after about 20 ms of silence. Not fixed (`parley-pods.18`); the suite checks that
  the first note sounds and compares levels from the second, by energy, peaks having varied on Chromium as well.
- **One loop turn in one run was a click short on Chromium** (1 of 28 turns, nothing skipped by the engine's own
  count). It did not come again in four further runs, the 300-turn run among them; the cause is not known
  (`parley-pods.19`). The suite now reports where, should it.
- **The toolbar's second row comes and goes on a narrow window**: the tools that need a selection sit in the
  toolbar, which wraps at 1440 px on WebKit, so the tracks move down by a row when something is selected
  (`parley-pods.20`). Not changed.

## 4. Behaviour that differs from before

- Clips that overlap on a track no longer sum: the later one is heard. This applies to projects that already hold
  overlaps as soon as they are opened with this version, not only after an edit as the plan had it.
- An edit during playback is heard without the short stop there was before, except those in section 1 that change
  the mixer's shape or the loop.
- An instrument tried from its keyboard or the piano roll is heard through its track (it went straight to the
  output before): a muted track's instrument is silent.
- A take is placed by the measured latency once one has been measured on the device.
- Ctrl/Cmd-drag copies a clip; Alt-drag moves it free of the grid.

## 5. Not built, not verified, and known limits

- **Ten minutes in a background tab was not run.** The loop was run in the foreground of a headless browser. That
  the turns are queued ahead is what should carry a background tab; it was not observed there.
- **Changes to the mixer's shape and to the loop still restart playback**, with a gap of about 30 ms here. Adding a
  track or an effect while playing is heard as a short stop.
- **A limiter on a track or bus delays that track by 2 ms** against the others; the delay is not compensated. On
  the master it delays everything alike.
- **Pinch to zoom** (trackpad on Safari, touch) was not built; Ctrl/Cmd+wheel covers the trackpad pinch that
  Chromium and Firefox report as a wheel. Tracks are reordered from the track menu, not by dragging.
- **Comping is by whole clips**: a range is chosen by splitting first. Take rows show names, not waveforms.
- **`Daw.tsx` was not split into modules**; regions and track heads are memoised inside it.
- **The waveform drawn while recording is not shifted by the latency**; the clip that replaces it is.
- **Calibration was not tried on real hardware.** The test's loop is a digital one of a known length. Acoustic
  loops (speakers to microphone) with noise and echo were not measured.
- **Output device selection has no test**: there was no second device to hear, and the panel's control was not
  exercised by a suite.
- **The performance figures are from one machine**; no frame-rate target was measured, and the plan's performance
  report in CI was not added.
- **No manual pass**: the plan's editing script for an experienced user was not done; nothing was judged by ear;
  Firefox was not run.
