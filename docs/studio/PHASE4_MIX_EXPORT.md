# Parley Studio: Phase 4 results (mix and export correctness)

| | |
|---|---|
| Date | 2026-11-14 |
| Plan | [DAW_COMPLETION_PLAN.md](DAW_COMPLETION_PLAN.md), Phase 4 |
| Tracker | `parley-pods.15` (with `parley-pods.2`, `.3`, `.14`) |

Every result here is *measured* by `frontend/e2e/suites/studiorender.mjs` (rendered samples and exported files
compared with arithmetic) or `studiorecord.mjs`, against a running stack with headless browsers. What was not
measured is listed in section 5 and is not claimed.

## 1. What changed

- **Meters measure samples.** A meter processor (`parley-meter` in `frontend/src/lib/worklets/studio.js`) looks at
  every sample of every strip after its fader, pan and mute, and of the master after its fader, and reports the peak
  and the mean square about 47 times a second. The strips show them on a decibel scale from −60 to +6 dBFS
  (`frontend/src/lib/meters.ts`, `StudioConsole.tsx`). Where worklets are not available the analyser is read as before.
- **Clipping is marked and stays marked.** A sample over full scale lights the strip's clip mark and the master's;
  the mark stays after playback stops until it is clicked.
- **The export is 24-bit by default.** `WAV` is 24-bit PCM at 48 kHz; `WAV (16-bit)` is offered next to it and is
  dithered (triangular, one step peak to peak each way, from a fixed seed so that the same project gives the same
  file). FLAC and MP3 are as before.
- **The export says when it is over full scale.** A mix whose render exceeds full scale is clipped in the file, as
  before, and the export panel now says by how many decibels (`data-daw-export-over`). Stems likewise.
- **The render is at the project's rate.** A device that cannot run at 48 kHz gets the same file as one that can:
  audio is decoded for the render at 48 kHz whatever the page's context runs at.
- **A render does not leave audio out.** If a file a clip or sampler needs cannot be loaded, the render fails and
  says which file, instead of producing a mix without it (`parley-pods.3`).
- **Solo is for listening.** Solo is not part of the export or the stems; mute is. A stem is what its track puts into
  the mix; a muted track has no stem in the zip (`parley-pods.2`). The engine can still render "what is heard" for
  tests.
- **The recorder says when the browser skipped audio.** The capture processor recycles its buffers (it allocates
  next to nothing during a take), and the recorder compares the frame numbers of successive batches: frames the
  browser never handed over are counted, the member is told when the take ends, and the take keeps its time
  (`parley-pods.14`).

## 2. Acceptance criteria

| Criterion (plan) | Result | Where |
|---|---|---|
| Meters within 0.1 dB of the rendered level | A full-scale stereo sine reads 0 dBFS peak and −3.01 dBFS RMS within 0.1 dB on its strip and on the master, in the engine and in the figures on screen; raised 1 dB it reads +1 dBFS | `studiorender`, "meters" |
| Clip marked and held | +1 dBFS marks the strip and the master; both marks stay after stop; each is cleared on its own | `studiorender`, "meters" |
| Export identical regardless of device rate | A second page whose audio context runs at 44.1 kHz exports a 48 kHz file of the same length with the same samples as the 48 kHz page (to one 24-bit step) | `studiorender`, "a device at another rate" |
| 24-bit export exact | Header fields and sizes add up; every sample within half a 24-bit step of the float render | `studiorender`, "the exported file" |
| 16-bit export dithered | Within a step and a half of the render; a −60 dBFS tone keeps its level within 0.1 dB; the error has an RMS of half a step, and correlates under 0.03 with itself one period on and with the tone (rounded without dither the same measure is over 0.9); the same project gives the same file twice | `studiorender`, "a quiet tone" |
| Over full scale reported | A mix 5.1 dB over is clipped at full scale in the 24-bit and 16-bit files and the export says 5.1 dB; an export within full scale says nothing | `studiorender`, "over full scale" |
| Solo not exported, stems right | A solo changes neither the mix nor the other tracks' stems; the "heard" render has the soloed track alone; a muted track's stem is silent and is not in the zip; with nothing on the master the stems add up to the mix within 1e-4 | `studiorender` |
| A missing file fails the render | With the audio routes failing, the render is refused with the file's name and the member exporting is told | `studiorender`, "audio that cannot be had" |

`studiorender` passes on Chromium and on WebKit.

## 3. Found on the way

- **The browser sometimes does not run the audio thread for a block.** `studiorecord` (a minute of noise recorded
  and compared bit for bit) failed in some runs with exactly one block of 128 samples of silence in the stored take
  and everything after it in place. Recycling the capture buffers did not remove it. In a failing run the recorder's
  own count named the same place (`at` frame 2721120, 128 frames): the processor was not called for that block, so
  there was nothing to capture. It is the browser or this machine under load, not the recorder losing data. The
  recorder now counts and reports such blocks, and the suite checks every sample outside them and bounds the total
  (under 10 ms of a one-minute take).
- **A render could be refused for audio the page already had.** Reloading the project replaces its list of audio
  files; for a moment the list could lack a file that a clip uses and the engine has decoded. With the new refusal
  that became an error. The engine now remembers every file it has loaded.
- **WebKit serves audio it has had from its cache**, past a failing network route. The missing-file test fails the
  page's own requests as well.

## 4. Behaviour that differs from before

- `WAV` exports are 24-bit (they were 16-bit, undithered). 16-bit is a separate choice.
- A soloed track no longer changes what is exported; before, the export was what was heard, and the stems of the
  other tracks were silent.
- Stems of muted tracks are left out of the zip.
- An export that cannot load one of its files fails with a message; before, it produced a file without that audio.
- Silence exported at 16 bits is dither noise at about −96 dBFS, not digital zero.
- Meters read in dBFS and are lower on screen for the same signal than the old linear bars.

## 5. Not verified, and known limits

- **Sample peak, not true peak.** The meters and the over-full-scale figure are sample peaks; inter-sample peaks
  are not estimated.
- **FLAC and MP3 are still 16-bit**, made from the dithered 16-bit data.
- **Meter ballistics** (the fall-back between reports) were not measured. On WebKit the meter checks run with a
  wider peak tolerance where the page's audio does not run at 48 kHz.
- **Skipped audio blocks are reported, not prevented.** How often they happen on real machines is unknown; here it
  was about one run in three under a loaded headless browser.
- **Real hardware at another rate** was not used: the 44.1 kHz device is a test setting of the page's audio context.
- **No listening test and no manual pass**: nothing was judged by ear or tried by hand; Firefox was not run.
