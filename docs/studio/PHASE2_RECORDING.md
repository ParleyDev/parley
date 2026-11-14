# Parley Studio: Phase 2 results (recording integrity)

| | |
|---|---|
| Date | 2026-11-14 |
| Plan | [DAW_COMPLETION_PLAN.md](DAW_COMPLETION_PLAN.md), Phase 2 |
| Before | [BASELINE.md](BASELINE.md), section 3 |
| Tracker | `parley-pods.5` |

Every figure here is *measured* by a suite in `frontend/e2e/suites/` against a running stack (Chromium, headless,
the browser's fake audio device), unless it says otherwise. What could not be measured here is listed in section 5
and is not claimed.

## 1. What changed

- **Capture.** A take is the samples that arrived at the recorder's input, taken in the DAW's own audio graph by an
  AudioWorklet (`frontend/src/lib/worklets/studio.js`), stored as 24-bit PCM at 48 kHz, one or two channels. No codec
  is involved. The engine's context is created at 48 kHz.
- **One clock.** The take's downbeat, the backing, the click and the count-in are all on the engine's audio clock
  (`engine.downbeat`). A take's position is the context frame of its first sample against the downbeat, less the
  latency the browser reports (smoothed: the browser's figure wanders and reads zero for a moment after start). Its
  length is its frame count. The second audio context and the unused `useMultitrack` are gone.
- **Click.** Played to the device's output beside the master, never through it: it is in no take and no export.
- **Durability.** Samples go to IndexedDB in half-second blocks as they are captured (`frontend/src/lib/takestore.ts`)
  and are sent from there by byte offset, with backoff, until the server has all of them. A page that opens later
  finds what an earlier one left and sends it. Recording does not start with less than 64 MB free on the device, and
  says why.
- **Server.** A piece is appended only where the stored take ends (otherwise `409` with how much is there), in whole
  frames, up to 30 minutes. Finishing writes a true WAV header and tells the length from the size. Every 10 s a sweep
  finishes tracks that have had nothing for 90 s and ends takes whose recorders have all been silent for 45 s. A
  finished take accepts the rest of itself for 24 hours, and its clip grows to fit. Creating a track checks that the
  lane belongs to the recorder; deleting a session checks ownership first and refuses one that is recording.
- **What the user sees.** An armed track shows its input's name and level before and during recording. The transport
  shows the take being recorded, sent, or retried, and says when a take is compressed or voice-processed.
- **Fallback.** Where the worklet cannot load, the browser's own recorder is used as before; the take is stored
  compressed and labelled "compressed" in the transport and on the clip.

## 2. Acceptance criteria

| Criterion (plan) | Result | Where |
|---|---|---|
| Take decodes to PCM matching the synthetic input within 24-bit quantisation; no lossy stage | 2,880,000 of 2,880,000 samples (60 s of noise) identical to the input rounded to 24 bits; nothing before or after them | `studiorecord` 2 |
| Loopback of known delay: placed within ±1 ms in 20 of 20 runs | 20 of 20; every one of 140 bursts within 0.33 ms (mean 0.04 ms; the take begins on a whole millisecond) | `studiorecord` 1 |
| Recorded duration equals the frame count | Reported length within 0.67 ms of frames ÷ rate on every take (it is the frame count in whole ms) | `studiorecord` 1, 2 |
| Network cut for 20 s: take complete and continuous | 28 s take, every sample in place; also with pieces refused for 20 s, held back 3 s, sent twice, and accepted with the answer lost | `studiotakes` |
| Page closed during a take: reopening sends the rest and places it without user action | 8 s take whole and placed after reopening the app outside the voice room, touching nothing; then removed from the device | `studiotakes` |
| …if the user never returns, the server places what it received within the idle period | Session ended by the server 45 s after the recorder vanished; the 4.6 s it had became a clip with a true header | `studiotakes` |
| An abandoned take no longer blocks recording | The next start is no longer refused with "already recording" | `studiotakes` |
| Click absent from every take and every export | Click played during all 20 takes (counted); the windows where only the click sounds are digital silence in every take and in the rendered mix | `studiorecord` 1 |
| Server restart between chunks | 23 s take recorded across `docker restart` of the backend, whole | `studiotakes` with `STUDIO_RESTART_CMD` |

Against the baseline (BASELINE.md section 3): take position spread was 48 ms between takes and is now under 0.4 ms;
reported length was 34 to 65 ms longer than the audio and is now the audio's length.

Unit tests: `cargo test` (86, including offset append, whole frames and limit, length from size, header) and
`npm test` (46, including the 24-bit encoder). Regression: `studio`, `studioaudio`, `studioconsole`, `studiodaw`,
`studiodaw2`, `studiolive`, `studioprojects`, `studiorender`, `dawdrag`, `dawproject` pass on Chromium; `dawdrag`,
`dawproject`, `studiorender` on WebKit (the others need a microphone and are skipped there).

## 3. Found on the way

- **A processor's first frame number can be one device buffer behind** (Chromium). Measured against a source started
  at a known frame: in about half the takes the first `process()` call reported a frame 512 before the true one,
  while the audio itself was unbroken. Uncorrected, the whole take lands 10.7 ms early. The processor now takes its
  position from the second call. Every later batch is still placed by its own frame number: if the browser does not
  run the processor for a moment, the take is silent there and stays in time.
- **`outputLatency` is not steady**: 0 just after the context starts, then 21 to 32 ms on the fake device. The median
  of recent readings is used.
- **Earlier takes are heard, and so re-recorded, in a loopback.** A property of the test, not the recorder; the suite
  removes each take before the next.

## 4. Behaviour that differs from before

- A loop take's first pass begins where its audio begins. When the take could not start exactly on the downbeat (no
  count-in, the start reaching the recorder a few ms later than the latency allows for), that pass starts a few ms
  into the loop instead of claiming to start at it. `studiodaw2` was changed to say so.
- A track with no input chosen, and a take made outside a project, still records the call's microphone in stereo
  when it is stereo; a track set to mono records mono.
- The session's armed list is no longer checked when a track is created (a recorder that reconnects mid-take must be
  able to go on); lane ownership is.
- Upload volume for a take is about nine times what Opus was (144 kB/s per mono track).

## 5. Not verified

None of the plan's manual pass has been done; it needs real hardware and cannot be done from here:

- A USB interface and a built-in microphone on Chrome, Safari and Firefox; the iOS and Android apps.
- Alignment by ear against a click, and with a real acoustic loop: the latency taken off is the browser's own
  figure, and how true that is on real devices is not known. The ±1 ms above is the recorder's own precision.
- Bluetooth headphones (reported latency).
- Safari and Firefox recording at all: no suite here can open a microphone in them, so whether the worklet path or
  the fallback is taken there, and how well, is untested. On Safari the call's microphone is shared rather than
  opened a second time, so a take there is labelled voice-processed when the call processes its sound.
- 44.1 kHz hardware under a 48 kHz context (cost and added latency).
- Storage pressure on phones, and a 30 minute take end to end (the longest take recorded here is 60 s).

## 6. Known limits

- A take whose track never reached the server before its session ended cannot be sent later: the server has no
  session to put it in, and the take is dropped from the device after its retries.
- A page killed without warning (no `pagehide`) can lose up to the last half second that had not reached IndexedDB.
- A finished take grows when its late remainder arrives only if it is not a loop take.
- Monitoring and recording open the same input separately.
