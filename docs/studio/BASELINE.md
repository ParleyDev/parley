# Parley Studio: measured baseline

| | |
|---|---|
| Date | 2026-11-14 |
| Code basis | `main` at `639a50a` plus the Phase 1 changes (test hooks, pure-module extraction; no change in behaviour) |
| Plan | [DAW_COMPLETION_PLAN.md](DAW_COMPLETION_PLAN.md), Phase 1 |

What the DAW does today, measured, so that later phases can show what they changed. Every figure names the command
that produced it. Figures marked *measured* came from running the code; anything else says how it was arrived at.

Machine: Linux x86-64, headless Chromium and WebKit under Playwright, no audio hardware (the browsers' null output
device). Timing and memory figures depend on the machine: compare runs from the same one.

## 1. What is now checked automatically

| Check | Command | Result |
|---|---|---|
| Pure modules: tempo and bar arithmetic, applying ops, undo and redo for 11 kinds of edit, the solo and mute rule, automation interpolation, WAV encoding | `npm test` (in `frontend/`) | 43 tests pass |
| Take placement: a plain take, a looped take split into passes, a punched take | `cargo test --locked studio_daw` (in `backend/`) | 6 tests pass |
| The rendered mix against arithmetic: level and pan law, clip and master gain, summing, mute, solo, clip positions to the sample, trim, nudge, split, fades, automation, buses and sends, effects, stems, the WAV file | `node e2e/run.mjs studiorender` | 53 checks pass on Chromium (48 kHz) and on WebKit (44.1 kHz) |
| Take alignment and duration (measured, no tolerance asserted) | `node e2e/run.mjs studiorecord` | see section 3 |
| The existing Studio suites, with their seven unconditional passes replaced by real checks | `node e2e/run.mjs studio studioaudio studioconsole studiodaw studiodaw2 studiolive studioprojects dawdrag dawproject` | 277 checks pass on Chromium |

Under WebKit, `studiorender`, `dawdrag` and `dawproject` run and pass; the suites that need a voice room and a
microphone (`studio`, `studioaudio`, `studioconsole`, `studiodaw`, `studiodaw2`, `studiolive`, `studioprojects`,
`studiorecord`) say so and skip, because the fake microphone and camera exist only in the Chromium runs.

### Does the render suite notice a wrong engine?

Each change below was made to `frontend/src/lib/daw.ts`, the app rebuilt, the suite run, and the change reverted
(*measured*):

| Change | Checks that fail (of 53) |
|---|---|
| Track gain multiplied by 1.02 (0.17 dB) | 30 |
| Pan position multiplied by 0.95 | 14 |
| Fade-in 5 % too long | 2 |
| Fade-out starting 20 ms late | 1 |

Two earlier changes went unnoticed (a fade curve of exponent 1.1, and the late fade-out before a check was added at
1510 ms): the suite samples fades at a few points, so a change in the shape of a fade between those points can pass.

## 2. Rendering: defects the baseline pins down

These are asserted as they are today, labelled as baseline in the suite, and are to be changed by the phase named.

| Finding | Evidence | Phase |
|---|---|---|
| A stem of a track that is not soloed is silent while another track is soloed: solo reaches exports | `studiorender`: "while a track is soloed, the stems of the others are silent" | 4 (decision D5) |
| A mix over full scale is hard-clipped in the 16-bit file, with no warning | `studiorender`: two tracks at 0.9 render to 1.8 and the file holds full scale | 4 |
| The WAV encoder truncates instead of rounding, and scales positive samples by 32767: up to 1.5 steps of 16-bit error | `studiorender` tolerance of 2/32768 between the render and the file; `wav.test.ts` | 4 |
| A render started before the page has fetched audio that a remote edit just introduced leaves that audio out, silently | Seen while writing the suite: 13 renders were silent until the suite waited for the clip's waveform | 3 |
| At a 44.1 kHz device rate a file is resampled twice (to the device rate on decode, to 48 kHz on render): positions hold within 1 ms, but a single-sample click of 0.9 comes out at 0.53 instead of 0.64 | `studiorender` under WebKit, whose context runs at 44.1 kHz | 2 (decision D3; defect R6) |

The last row stands in for the manual check the plan asked for (a 44.1 kHz and a 48 kHz output device): the two
engines run at those two rates on the same machine, and the suite records the difference. It has not been repeated on
physical devices.

## 3. Recording: alignment and duration

`studiorecord` plays a backing of 1 kHz tone bursts at known times, feeds what the DAW plays back into the test's
microphone as if a player hit every burst exactly, records a take the way the band does (voice room, `MediaRecorder`,
Opus), and compares where each burst landed on the timeline with where it is in the backing.

Three runs of five takes each, Chromium (*measured*; + is late):

| Figure | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Take position error, mean (ms) | +10.3 | +3.3 | −5.0 |
| Take position error, spread between takes, standard deviation (ms) | 9.5 | 13.1 | 13.6 |
| Take position error, earliest to latest take (ms) | −1.1 to +23.4 | −7.3 to +28.5 | −19.6 to +18.5 |
| Drift within one take, 3 s apart (ms) | 0 to 10 | 0 to 0.02 | 0 to 0.06 |
| Latency the app subtracted, as the browser reported it (ms) | 42 to 57 | 42 to 58 | 42 to 54 |
| Reported take length minus length of the audio (ms) | +34 to +65 | +44 to +61 | +41 to +55 |

What this says:

- **Takes do not land in the same place twice.** Over 15 takes the position error ranged from −19.6 ms to +28.5 ms, a
  window of 48 ms, with the same signal path every time. That is the figure Phase 2 has to bring down; a tolerance can
  be asserted once it has.
- **Within a take the audio holds together** (drift near zero in 14 of 15 takes; one take showed a 10 ms step).
- **The length the client reports is 34 to 65 ms longer than the audio it uploaded**, on every take: it is taken from
  the wall clock, not from the audio.

What it does not say: the loop from the DAW's output to the microphone here is a stream between two audio contexts.
There are no speakers, no air and no audio interface, so the 42 to 58 ms the app subtracts (the browser's reported
latency for the null device) is not present in the loop to be subtracted. The **mean** error therefore says little
about real hardware. The **spread** does not depend on that and is the dependable figure. Real-device alignment
remains a manual measurement (plan section 9.3).

The last run's figures are also written to `frontend/e2e/out/studiorecord-baseline.json`.

## 4. Performance at the design envelope

`npm run perf:studio` builds a project of 16 audio tracks of 5 minutes each (16 different files), 200 clips and 8
effects (four EQs, two compressors, a reverb on a bus fed by four sends, a limiter on the master), then opens, plays,
loops and renders it. One run, Chromium (*measured*):

| Measure | Figure |
|---|---|
| DAW on screen after navigation | 0.43 s |
| All 16 files fetched and decoded | 2.7 s |
| Frames per second, idle / playing (10 s) | 60.1 / 60.1, no frame over 50 ms |
| Play pressed to sound | 310 ms: 60 ms of work in the page, 207 ms scheduled ahead, 43 ms output device |
| Audio sources started on play | 200 (every clip of the project, up front) |
| Late starts on play / over 20 s of a 2 s loop | 0 of 200 / 0 of 176; least lead 203 ms |
| Offline render of the 5 minute mix | 22.1 s (13.7 times faster than real time) |
| Renderer memory before / loaded / playing / after render | 198 / 1304 / 1539 / 1471 MB |
| Page heap before / loaded | 9 / 894 MB |

What this says:

- **Memory is the limit, not the processor.** The decoded audio alone is 879 MB (16 × 5 min × 48 kHz × 32-bit float),
  and the renderer stood at 1.3 to 1.5 GB. A desktop carries that; a phone or a 4 GB laptop will not. The envelope in
  the plan (section 4.3) holds on this machine only because of its memory.
- Drawing and scheduling are comfortable at this size on this machine: 60 fps and no late starts.
- Pressing play takes about a third of a second to be heard, most of it a fixed 207 ms of scheduling ahead.

Limits of the figures: the files are steady tones sent as FLAC, which decode faster than music does; the machine has
no audio hardware, so no figure here includes a real device's buffer; frames were counted in a headless browser. The
run's figures are written to `frontend/e2e/out/studioperf.json`.

## 5. Not measured

- Alignment through real speakers, a real microphone and a real interface, and on Bluetooth.
- Safari and Firefox on real devices; iOS and Android. WebKit under Playwright on Linux is not Safari.
- Recording in WebKit and Firefox (no automated microphone there yet).
- Long takes (the 30 minute limit), poor networks, and several people recording at once.
- Performance on a low-memory machine or a phone.
