# Parley Studio: DAW completion plan

| | |
|---|---|
| Status | Approved 2026-11-14 (decisions D1–D9 accepted as recommended). Phase 1 done: see [BASELINE.md](BASELINE.md). Phase 2 done, awaiting review and the manual pass: see [PHASE2_RECORDING.md](PHASE2_RECORDING.md). Phase 3 done: see [PHASE3_SYNC.md](PHASE3_SYNC.md). Phase 4 done: see [PHASE4_MIX_EXPORT.md](PHASE4_MIX_EXPORT.md). Neither has had a manual pass. |
| Date | 2026-11-14 |
| Code basis | `main` at `639a50a` |
| Tracker | `parley-pods` |

## How to read this document

Every statement about current behaviour was established by reading the code path end to end (frontend control → store → HTTP/WebSocket → backend handler → database/disk → playback or render), and is cited as `path:line`. Nothing was executed during the investigation, so the statuses below mean the following.

| Status | Meaning |
|---|---|
| **Functional** | Traced end to end by reading. "(tested)" is added when an existing automated check exercises the behaviour, and says what kind of check it is. |
| **Partial** | Works for the main case; the notes say what is missing. |
| **UI-only** | A control exists that changes nothing that is heard, stored or shared. |
| **Broken** | Implemented, with a concrete failing code path. |
| **Missing** | No implementation found. |
| **N/A** | Deliberately not applicable; the notes say why. |

"Confirmed" defects were read in the code. "Suspected" defects are plausible from the code but need a reproduction before work is scheduled.

Abbreviations for the two backend files that hold almost all of Studio: **S** = `backend/src/routes/studio.rs` (497 lines), **D** = `backend/src/routes/studio_daw.rs` (974 lines).

Terminology that is easy to confuse, because the table names differ from the product words:

| Product word | Table | What it is |
|---|---|---|
| Project | `studio_projects` (one per `project` channel) | The arrangement: lanes, clips, mix, tempo |
| Take | `studio_sessions` | One recording pass: count-in, start position, who is armed |
| Audio file | `studio_tracks` | One recorded or imported file |
| Session | `studio_gatherings` | A named get-together with attendance; gates nothing |
| Track | `studio_lanes` | A lane in the arrangement (audio, MIDI or bus) |

---

## 1. Executive summary

### Current state

Studio is not a DAW-looking shell. It is a working, collaborative, multitrack editor of about 5,500 lines, built in two days (2026-11-11 to 2026-11-12) on browser-native Web Audio with no audio framework:

- A single project store with optimistic, server-validated, all-or-nothing edit operations that are broadcast to everyone who can see the project (`frontend/src/lib/daw.ts:89-191`, D:619-633).
- One playback engine whose graph builder and clip scheduler are shared by live playback and offline export (`frontend/src/lib/daw.ts:348-388`, `:486-507`, `:623-645`).
- Non-destructive clips with trim, split, fades, clip gain, take groups; buses, sends, eight insert effects, breakpoint automation; MIDI lanes with three instruments and a piano roll; tempo map, markers, loop, punch; shared transport, presence, timeline comments, saved versions; export to WAV, FLAC, MP3, stems, DAWproject and a native project archive.

The design is sound and should be kept. Nothing found justifies a rebuild.

### Principal weaknesses

The weaknesses are concentrated where a DAW has to be trustworthy rather than where it has to be feature-rich. In order of importance:

1. **Recording is lossy and fragile.** Takes are captured with `MediaRecorder` as Opus at 128 kbps (`frontend/src/lib/studio.ts:138-148`). A failed chunk upload is dropped with a toast (`studio.ts:163-169`); closing the tab mid-take never calls `finish`, and an unfinished file is never finalised, placed or cleaned up (S:394, D:719). The server appends chunks with no sequence number (S:380-383). This is the production audio path, and it conflicts directly with "do not silently downgrade audio quality" and with Journey C.
2. **Recording alignment is approximate.** A take's position is derived from wall-clock time and a server clock offset measured over HTTP, taken before `MediaRecorder` has actually started, and its duration is `Date.now()` arithmetic (`studio.ts:140-144`, `:175`). The server trusts both numbers (S:357-358, S:394, D:676-678). Count-in clicks run on a second `AudioContext` scheduled from `Date.now()` (`studio.ts:210-217`).
3. **Export depends on the machine it runs on.** The live context runs at the device's sample rate and decodes every file at that rate (`daw.ts:443`, `:468`); the offline render is fixed at 48 kHz and reuses those buffers (`daw.ts:629-632`). On a 44.1 kHz device a 48 kHz take is resampled twice. Export is 16-bit only, hard-clipped, with no dither and no warning when the mix is over (`frontend/src/lib/multitrack.ts:203-212`).
4. **Metering cannot be trusted for gain staging.** The meter shows a compressed RMS figure (`sqrt(sqrt(mean square)) × 1.6`, `daw.ts:590-598`), there is no peak reading and no clip indication, and nothing shows the level of the selected input before recording.
5. **Correctness is unproven.** One suite measures audio samples, and only for the call/recording stereo path (`frontend/e2e/suites/studioaudio.mjs`). No test decodes a rendered mix. All nine Studio suites are Chromium-only, the frontend has no unit tests, and the engine files have no fix commits: they are unexamined rather than proven.
6. **Safety gaps around the project.** A failed op send discards the edit and reloads (`daw.ts:121-128`); a non-resumable WebSocket reconnect leaves the open project stale (`frontend/src/lib/ws.ts:227`); deleting a take can delete audio that a saved version still needs (S:314-318 against D:935); several authorization and ordering defects exist on the take endpoints (section 3.3).
7. **Workflow friction that experienced users will notice.** Any clip edit during playback restarts playback with an audible gap (`daw.ts:576-581`); the whole arrangement re-renders in React on every animation frame while playing (`frontend/src/components/Daw.tsx:43-53`, `:82`); there is no copy/paste, marquee selection, track resize or reorder, pointer-anchored zoom, crossfade, or noise gate.

### Recommended direction

Finish the product by making the existing loop of **record → edit → mix → export** reliable and verifiable before widening it.

- **Keep** the store, the op protocol, the Web Audio graph, `AudioBufferSourceNode` scheduling, integer-millisecond timeline, the server as the single source of truth, and local-disk media storage.
- **Change** five things, each with a demonstrated need: lossless sample-counted capture with local persistence and resumable upload; one audio clock for backing, click and capture; a fixed 48 kHz project sample rate; real peak metering with clip detection; and playhead rendering that does not go through React.
- **Add** a verification layer that measures rendered and recorded samples, before any behaviour changes, so that every later phase is checked against audio rather than against the DOM.
- **Defer or exclude** everything that widens the surface without serving the core loop (section 8).

Seven P0 items (four phases) make the three required journeys reliable. P1 completes the editing and collaboration workflows. P2 is recorded but not scheduled.

---

## 2. Existing feature inventory

### 2.1 Frontend structure

| Component | File | Role |
|---|---|---|
| Project list | `frontend/src/components/StudioView.tsx` | Grid of projects in a `studio` channel; create with name and tempo (`:43-45`) |
| DAW shell | `frontend/src/components/Daw.tsx` (766 lines) | Toolbar and transport, keyboard handling (`:192-210`), `Arrangement` (`:431`), `LaneHead` (`:618`), `Region` (`:678`), `ClipWave` (`:723`), `ClipInspector` (`:400`), `TempoPanel` (`:329`), `ProjectMenu` (`:353`) |
| Mixer | `frontend/src/components/DawMixer.tsx` (240) | Strips, FX rack, master |
| Panels | `frontend/src/components/DawPanels.tsx` (254) | Versions, export, comments, takes, band, sessions |
| Automation row | `frontend/src/components/DawAutomation.tsx` (66) | Breakpoint editing |
| Piano roll, instrument | `DawPianoRoll.tsx` (130), `DawInstrument.tsx` (75) | MIDI editing and instrument settings |
| Store and engine | `frontend/src/lib/daw.ts` (725) | zustand store `useDaw` (`:62`), ops and undo (`:89-176`), remote apply (`:179`), graph (`:348`), `Engine` singleton (`:427-651`) |
| Recorder | `frontend/src/lib/studio.ts` (253) | `StudioRecorder` (`:25`), `Metronome` (`:197`) |
| Supporting | `fx.ts`, `tempo.ts`, `clock.ts`, `monitor.ts`, `instruments.ts`, `midi.ts`, `exporters.ts`, `dawproject.ts`, `projects.ts` | Effects, tempo map, server clock, input monitoring, instruments, Web MIDI, export formats, DAWproject, rights |

The DAW is only mounted for users with edit rights (`frontend/src/components/VoiceView.tsx:85`, `:261-263`); the audience has no read-only view.

`useMultitrack` in `frontend/src/lib/multitrack.ts:59` is an older playback and mixdown engine with **no remaining callers**. Only `clickAt`, `peaksOf` and `encodeWav` are still imported from that file. There is therefore one playback engine in use, plus one second `AudioContext` owned by the count-in metronome (`studio.ts:210`).

### 2.2 Audio engine

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Web Audio graph per lane: inserts → volume → pan → mute/solo gate → analyser → bus or master | Functional (tested: `sources === 2` and a non-zero master meter) | `daw.ts:348-388` | Same builder for live and offline contexts |
| Clip scheduling | Functional | `daw.ts:486-507` | One `AudioBufferSourceNode` per clip, all created up front for the remaining timeline; `start(when, offset, duration)` is sample-accurate |
| Decode and buffering | Partial | `daw.ts:461-477`, `:479-483` | Whole file fetched and decoded into memory at the device rate; no cache across reloads, no eviction, no Range requests (S:411-418) |
| Loop playback | Partial | `daw.ts:534` | `setInterval(50 ms)` queues the next pass 300 ms ahead on the main thread; a throttled or busy tab can miss a pass |
| Metronome during playback | Partial | `daw.ts:551` | `setInterval(25 ms)`, 120 ms lookahead, clicks go straight to `ctx.destination` |
| Count-in metronome | Partial | `studio.ts:197-232` | Separate `AudioContext`, scheduled from `Date.now()`; not phase-locked to the backing |
| Edit during playback | Partial | `daw.ts:576-588` | Mix changes apply live; any clip change stops and restarts playback after 60 ms |
| Track gain, pan | Functional | `daw.ts:362`, `:390-404` | Not verified in rendered audio by any test |
| Mute, solo | Functional | `daw.ts:298-307` | Solo is shared project state; buses stay audible under solo. Solo is not exercised by any test |
| Master bus | Functional | `daw.ts:349-358` | Master effects, gain, analyser |
| Meters | Partial | `daw.ts:590-598`, `frontend/src/components/StudioConsole.tsx:34-58` | Compressed RMS, post-fader, with a 1.2 s hold tick. Not a peak meter |
| Clipping detection | Missing | | No overs indicator live; export hard-clips silently |
| Loudness | Partial | `daw.ts:353-358`, `:600-609`, `fx.ts:186` | Momentary, ungated live; integrated (BS.1770 gating) after export only |
| Output device | Missing | `daw.ts:443` | The engine ignores the output device chosen in settings; the call audio and sound effects honour it (`frontend/src/lib/voice.ts:804`, `frontend/src/lib/sfx.ts:49-50`) |
| Latency reporting | Partial | `daw.ts:612-617` | `outputLatency + baseLatency + input track latency`; several browsers report zero for some terms |
| AudioWorklets | N/A today | | None in Studio. The call path already loads one for noise suppression (`frontend/src/lib/rnnoise.ts:16-20`), so the build and CSP already support worklet modules |
| Offline render | Functional (tested: byte length only) | `daw.ts:623-646` | 48 kHz stereo; tail of 3 s when a reverb or delay is active |

### 2.3 Timeline and arrangement

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Multiple audio tracks | Functional (tested) | `Daw.tsx:592-601`, D:511-554 | No server cap on lanes or clips |
| Time ruler in bars, timecode readout | Functional | `Daw.tsx:579-582`, `frontend/src/lib/tempo.ts:62` | |
| Horizontal scroll, zoom | Partial | `Daw.tsx:89-90`, `:291-292` | Buttons only (×1.5), 4–400 px/s; not anchored at the pointer; no Ctrl+wheel or pinch |
| Track resize, vertical zoom | Missing | `Daw.tsx:31-32` | Fixed 76 px |
| Track reorder | Missing | `Daw.tsx:172-176` | `position` is set only at creation |
| Clips, drag to move | Functional (tested: snapped and > 0, not exact) | `Daw.tsx:478-507` | Cross-lane only for a single clip to a lane of the same kind (`:467`) |
| Trim | Functional | `Daw.tsx:468-470`, `:695-696` | Clamped to the source; no UI test |
| Split | Functional (tested: invariants exact) | `Daw.tsx` key `S` (`:192-210`) | Splits grouped takes together; fades reset at the cut |
| Duplicate, delete, select all | Functional | `Daw.tsx:145-151`, `:200-201` | No UI test |
| Copy, cut, paste | Missing | | |
| Non-destructive editing | Functional | `backend/migrations/0150_studio_projects.sql` | Clips reference audio by id with `start_ms`, `in_ms`, `length_ms` |
| Clip gain | Functional | `Daw.tsx:400-430`, `daw.ts:309-317` | 0–200 % |
| Fade in, fade out | Functional | `Daw.tsx:698-699`, `daw.ts:309-317` | Linear only |
| Crossfades, overlap handling | Missing | `Daw.tsx:596`, `daw.ts:486-507` | Overlapping clips on a lane are drawn stacked and all play |
| Loop region | Functional (tested: state) | `Daw.tsx:543-556` | Re-drag to change; no edge handles |
| Snap to grid | Functional (tested) | `tempo.ts:49` | Bar, beat, half, sixteenth, off. Alt both disables snap and copies (`Daw.tsx:484`, `:495`) |
| Tempo and time signature | Functional | `tempo.ts:8-62`, `Daw.tsx:329` | Tempo map by bar; signatures are n/4 only |
| Playhead seek | Functional | `Daw.tsx:589`, `:554` | |
| Multiple selection | Partial | `Daw.tsx:596` | Shift-click and select all; no marquee |
| Keyboard shortcuts | Partial | `Daw.tsx:192-210` | Space, Delete, S, L, Home, Esc, Tab, undo/redo, Ctrl+D, Ctrl+A. No nudge, zoom or clipboard keys |
| Undo, redo | Partial (tested: one move, one loop clear) | `daw.ts:105-176` | Per client, in memory, 200 steps, inverse ops. Undo re-sends old field values and can overwrite a collaborator's later edit |
| Markers | Partial | `Daw.tsx:583-586` | Add, rename (native prompt), remove; not draggable |
| Waveforms | Partial | `Daw.tsx:723-766` | Peaks every 20 ms, normalised to the file's own maximum, so absolute level and fades are not shown; coarse when zoomed in |

### 2.4 Recording

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Input selection | Functional (tested: field persistence) | `DawMixer.tsx:150-161`, `studio.ts:117-125` | Member, device by name, channel mono/1/2/1-2. The device list is only filled for the lane's owner but the control is not disabled for others |
| Track arming | Functional (tested) | `daw.ts:270-279`, `Daw.tsx:647` | Exclusive per owner, Ctrl for several |
| Audio recording | Partial (tested: duration bounds, stereo, mute) | `studio.ts:138-176`, S:327-405 | Lossy Opus 128 kbps; 30 MB cap ≈ 33 minutes (S:24) |
| Capture source | Partial | `frontend/src/lib/voice.ts:718-728`, `studio.ts:117` | Default input taps the call's microphone graph after input volume and before the talk gate. On a `voice`-profile channel that includes echo cancellation, noise suppression, AGC and possibly RNNoise. Project channels are created with the music profile (D:222-229), where these are off |
| Input monitoring | Functional (tested: lane id only) | `frontend/src/lib/monitor.ts` | In / Auto / Off through the lane's effects on the owner's device |
| Monitoring latency | Partial | | Nothing shows the round-trip figure or advises headphones |
| Metronome, count-in | Partial (tested: tick counter) | `studio.ts:197-232`, S:277-278 | Count-in length uses the console tempo and ignores the tempo map |
| Multiple takes | Functional (tested) | D:681-701 | Loop recording makes one clip per pass in a group |
| Overdub | Functional (tested: `playing === 'backing'`) | `daw.ts:674-725` | The project plays as backing from the take's downbeat |
| Punch in/out | Functional (tested: clip bounds) | D:703-708 | Records throughout, keeps the punch range |
| Take selection, comping | Partial | `Daw.tsx:306` | Choose one take of a group; no comping across takes |
| Recording alignment | Partial (tested: `start_ms < 1500`) | `studio.ts:140-144`, S:357-358, D:676-678 | Wall clock and HTTP clock offset; latency compensation is the browser's self-report |
| Recovery from interruption | Missing | `studio.ts:163-176`, S:367-394 | See section 3.3, defects R1–R4 |
| Pre-record input meter | Missing | `Daw.tsx:653` | The fallback shows the call microphone level, not the lane's selected input |
| Live waveform while recording | Missing | `Daw.tsx:597` | A growing red block |

### 2.5 Mixing

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Volume faders | Functional (tested: field) | `DawMixer.tsx:194-205`, `Daw.tsx:651` | Up to 150–200 % |
| Stereo pan | Functional | `DawMixer.tsx:194` | |
| Mute, solo | Functional | `Daw.tsx:645-646` | Shared with all collaborators and honoured by export |
| Peak meters | Missing | | See 2.2 |
| Master bus | Functional | `DawMixer.tsx:229-234` | |
| EQ | Functional | `fx.ts:92-165` | High-pass, low shelf, peaking mid, high shelf |
| Compressor | Functional | `fx.ts` | `DynamicsCompressorNode` with make-up gain; no gain-reduction display |
| Reverb | Functional | `fx.ts` | Generated impulse; decay is not automatable |
| Delay | Functional | `fx.ts` | |
| Noise gate | Missing | | Planned in the original epic, not built |
| Limiter | Partial | `fx.ts` | A compressor at ratio 20; it does not guarantee a ceiling |
| Drive, filter, chorus | Functional | `fx.ts:11-58` | |
| Effect bypass | Functional | `DawMixer.tsx:27-51`, `fx.ts:180` | Bypass rebuilds the graph |
| Effect parameter persistence | Functional (tested: API read; validators unit-tested) | D:336-355, D:760-795 | No test reloads the page |
| Automation | Partial (tested: one point) | `DawAutomation.tsx`, `daw.ts:319-337`, `:417` | Volume, pan, sends, effect parameters; linear breakpoints; no write/touch modes; not on the master |
| Sends and buses | Functional (tested: validation) | `daw.ts:348-388`, D:358-368 | |
| MIDI instrument audition | Partial | `DawInstrument.tsx:12-19` | Live playing bypasses the lane's effects, fader and meters |

### 2.6 Projects, persistence and export

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Creation and naming | Functional (tested) | `StudioView.tsx:43-45`, D:212-229 | An empty name is accepted |
| Save and load | Functional | D:263, `daw.ts:73` | Every edit is committed on the server as it is made |
| Autosave | N/A | | Continuous save by design. The gap is that a failed send discards the edit (`daw.ts:121-128`) |
| Crash recovery of edits | Functional | | Committed ops survive; undo history does not |
| Crash recovery of a take in progress | Missing | | Section 3.3 |
| Audio import | Functional (tested) | `daw.ts:243-268`, D:729-757 | 200 MB; type taken from the request header; no integrity check |
| WAV export of the mix | Partial (tested: byte length) | `daw.ts:654-661`, `multitrack.ts:203-212` | 48 kHz, 16-bit, hard clip, no dither |
| FLAC, MP3 | Functional (tested: container) | `exporters.ts:93-132` | FLAC 16-bit; MP3 192 kbps |
| Stems | Functional (tested: file names) | `exporters.ts:156-173` | Always WAV; zip is stored-only without zip64 |
| Project metadata | Partial | D:245-251 | Name, stage tag, archive. Archiving only filters the list |
| Media asset integrity | Partial | S:314-318, D:611 | No hash; no delete or orphan cleanup; a version can lose its audio (defect P3) |
| Version history | Partial (tested: restore fields) | D:870-946 | Manual saves and an automatic one before restore; 100 kept; any editor can restore |
| DAWproject | Partial (tested: XSD and field round trip) | `dawproject.ts` | Export omits clip gain and effect automation; import skips all devices, including the ones Parley writes (`:210`) |
| Native project archive | Partial (tested: counts) | `exporters.ts:189-252` | Import drops routing-only flags and inputs |

### 2.7 Collaboration

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Several users in one project | Functional (tested: sequential edits) | D:157-166, D:638-646 | Editors are band members (engineer or artist) and project managers |
| Presence | Functional (tested: DOM) | `daw.ts:225-241`, D:802-808 | Playheads and selections; not stored |
| Shared transport | Functional (tested: state enum only) | `daw.ts:210-223`, D:962-971 | Server timestamp + 250 ms; each client can stop following |
| Independent playback | Functional | `daw.ts:203` | The follow toggle |
| Collaborative timeline changes | Functional | `daw.ts:179-191` | Version gap ⇒ full reload |
| Conflict resolution | Partial | D:511-607 | Row lock per batch; scalars are last-writer-wins per field; JSON collections (notes, automation, effects, sends, markers, tempo map) are replaced whole |
| Track ownership and permissions | Partial | D:541-549, D:557-562 | Lanes have an owner for recording, but any editor can edit or delete any lane or clip |
| Shared recording sessions | Functional (tested) | S:260-297 | One take at a time; armed members record locally |
| Per-participant contributions | Functional (tested) | D:664-673 | Each member's take lands on their lane |
| Versioned takes | Partial | D:681-701 | Loop passes form a group; separate takes at the same place simply overlap |
| Timestamped comments | Functional (tested: API) | D:814-866, `Daw.tsx:587` | No replies or ranges |
| Remote listening and review | Partial | | Shared playback for editors only; the audience cannot open the DAW |
| Collaborative mixing | Functional | | All mix state is shared, including solo |
| Reconnection and state recovery | Partial | `ws.ts:144`, `:227-229` | Resume replays missed events; a fresh `READY` does not reload the project |
| Multi-instance behaviour | Partial | `backend/src/ws/hub.rs:100`, `:174-191` | Events cross instances through Postgres NOTIFY; voice state is per instance, and the take endpoints read it (S:263, S:270, S:332). Open issue `parley-hx7z` |

### 2.8 Backend API and permissions

Routes are in S and D and mounted under `/api` and `/api/v1`. Authentication is the `Authorization` header only.

| Gate | Definition | Evidence |
|---|---|---|
| View | `VIEW_CHANNEL` on the project channel | S:116-120 |
| Editor | Engineer or artist in the band, or Manage Projects; room presence is not needed | D:157-166 |
| Crew | Engineer, or Manage Projects | S:154-156 |
| Record | In the voice room and not suppressed | S:263-265, S:332-333 |
| Create, delete project | Create Projects (granted to @everyone by default), Delete Projects | D:214, D:280, `backend/src/perms.rs:113` |

Media is stored on local disk as `UPLOAD_DIR/studio-{id}.webm` whatever its type (S:103, S:360), on a volume shared by both backend instances (`docker-compose.yml:83`, `:116-117`). Nothing is transcoded or rendered on the server.

### 2.9 Tests and documentation

- **End-to-end**: nine Studio suites in `frontend/e2e/suites/` (about 280 checks) run against a real backend and database. They assert DOM state, API state and debug counters exposed on `window`. Only `studioaudio.mjs` measures samples (channel RMS of the capture, the remote stream and the recorded file, `:60-91`).
- **Browsers**: every Studio suite imports Chromium directly, so `E2E_BROWSER` has no effect on them. CI runs WebKit only for three unrelated suites (`.github/workflows/ci.yml:86-92`).
- **Unit**: none in the frontend (`frontend/package.json:7-15`). The backend has three validator tests (D:760-795); S has none.
- **Weak checks**: several unconditional passes (`studio.mjs:31`, `studioconsole.mjs:78,81,104`, `studiodaw.mjs:118`, `studiodaw2.mjs:196,207`), fixed sleeps, and a machine-specific path (`studiodaw2.mjs:200`).
- **Documentation**: `README.md:404-418` describes Studio accurately in most respects. Two statements do not match the code: the take cap is described as "about an hour" but 30 MB at 128 kbps is about 33 minutes (`README.md:406`, S:24); and `website/index.html:817` says each musician's track is recorded "in full quality, so a bad connection never ruins a take", which the lossy, non-retrying upload does not deliver.

---

## 3. Gap analysis

### 3.1 Missing

| Area | Missing capability |
|---|---|
| Recording | Lossless capture; recovery of an interrupted take; input level before recording; live waveform; latency calibration |
| Engine | Peak metering and clip detection; output device selection; decode cache and memory management |
| Mixing | Noise gate; a limiter that holds a ceiling; master automation |
| Timeline | Clipboard; marquee selection; nudge keys; pointer-anchored zoom; track resize and reorder; crossfades or an overlap rule |
| Projects | Bit-depth choice and dither on export; clip warning on export; range export; automatic versions; audio cleanup |
| Collaboration | Read-only view for listeners; per-track edit protection; conflict-aware undo; per-user solo |
| Verification | Any measurement of rendered audio; any non-Chromium coverage; unit tests of engine arithmetic |

### 3.2 Incomplete

| Area | What exists | What is incomplete |
|---|---|---|
| Alignment | Server-timestamped downbeat, reported latency, manual track nudge | Not measured on the audio clock; duration is wall-clock; no way to calibrate |
| Scheduling | Sample-accurate source scheduling | Loop and click depend on main-thread timers; edits restart playback |
| Tempo | Tempo map in the project | The console config holds a second copy of tempo and signature, synchronised outside the transaction (S:218, D:628-632); count-in ignores the tempo map (S:277-278); restore does not update the copy (D:915-937) |
| Take selection | Pick one of a loop group | No comping; takes recorded separately are not grouped |
| DAWproject | Field-exact round trip of arrangement data | Effects are lost on Parley → Parley round trip |
| Reconnect | Resume with replay | No reload on a fresh session |
| Phone | Play, levels, read-only timeline | No editing by design; recording on phones is untested |

### 3.3 Defects

Confirmed by reading unless marked suspected.

**Recording and media**

| ID | Defect | Evidence | Consequence |
|---|---|---|---|
| R1 | A failed chunk upload is dropped; there is no retry and no local copy | `studio.ts:163-169` | A hole in the take, shifting everything after it |
| R2 | Closing or reloading the tab never calls `finish`; unfinished files are never finalised, placed, listed or deleted | `studio.ts:171-176`, S:394, D:719 | The take is lost to the user and the bytes are orphaned |
| R3 | Chunk append has no sequence number or offset; file write and size update are not atomic | S:380-383 | A retried or concurrent request corrupts the file |
| R4 | A take is never stopped when its starter disconnects, and blocks further takes | S:266-267, `backend/src/ws/handler.rs:398-403` | The project cannot record until a crew member stops it |
| R5 | Duration and offset are client assertions; a missing or zero duration means the take is uploaded but silently never placed | S:394, S:401, D:660-661 | Take appears lost; the client still receives 200 |
| R6 | Export resamples twice on 44.1 kHz devices, and results differ between machines | `daw.ts:443`, `:468`, `:629-632` | Quality loss and non-deterministic export |
| R7 | Export hard-clips with no warning and no dither | `multitrack.ts:203-212` | Silent distortion when the master is over |
| R8 | Audio is served without Range support and with `max-age=0` | S:411-418 | Every project open downloads every file in full |

**Project safety and authorization**

| ID | Defect | Evidence | Consequence |
|---|---|---|---|
| P1 | A network error on an op send discards the optimistic edit and reloads | `daw.ts:121-128` | Lost edits on a brief disconnect |
| P2 | A fresh `READY` does not reload the open project or the take list | `ws.ts:227` | Stale project until the next edit arrives with a version gap |
| P3 | Deleting a take deletes audio that is referenced only by a saved version or a sampler; restore then drops those clips. It also works on a take in progress | S:314-318, D:935 | Silent loss from version history |
| P4 | `delete_session` runs its detach `UPDATE` before checking that the take belongs to the channel in the path | S:314 against S:316 | Crew of one project can detach another project's takes |
| P5 | `create_track` does not check the lane's owner or the take's armed list | S:344-349 | Any unsuppressed room member can record onto any armed lane |
| P6 | Project `CHANNEL_UPDATE` events are sent to the whole server rather than to those who can view the channel | S:174, S:220, S:236, D:253, D:631 | Name, band and settings of a private project reach members who cannot see it |
| P7 | Artists can rename the project and change tempo through ops, bypassing the crew-only endpoints; the op rename leaves the channel name unchanged | D:500-504, D:628-629 against S:209, D:245 | Inconsistent names and permissions |
| P8 | A role change is stored before the speak-permission check can fail | S:183 against S:189 | Error response with the change persisted and no event |
| P9 | Starting a take is check-then-insert with no unique constraint | S:266-291 | Suspected: two simultaneous starts both succeed |
| P10 | Op broadcasts are sent after commit, outside the row lock | D:626-633 | Suspected: out-of-order arrival forces needless reloads |

**Editing and instruments**

| ID | Defect | Evidence | Consequence |
|---|---|---|---|
| E1 | Undo sends old field values without checking whether someone else changed them since | `daw.ts:105-176` | Undo can overwrite a collaborator's edit |
| E2 | The piano roll and automation rows save the whole collection on every change | `DawPianoRoll.tsx:41`, `DawAutomation.tsx:34-39`, D:576 | Two people on the same clip or lane overwrite each other |
| E3 | Changing octave while holding a key leaves a stuck note | `midi.ts:98` | Minor |
| E4 | Dragging an automation point past its neighbour can switch which point is being dragged (suspected) | `DawAutomation.tsx:35`, `:48` | Minor |
| E5 | The playhead is React state at the root of the DAW; nothing is memoised | `Daw.tsx:43-53`, `:82`, `:596` | Full re-render every frame while playing, on the same thread that runs the loop and click timers |

---

## 4. Target architecture

The principle is to keep the architecture and correct five specific properties. Each decision below names the need that justifies it.

### 4.1 Decisions

**AD-1. The server stays the single source of truth; the op protocol is kept.**
Edits remain optimistic ops validated and applied in one transaction on the server (D:619-626). No CRDT library, no local-first store. The need for change is limited to three refinements, all P1: item-level ops for collections that people edit together (notes, automation points, effects, markers); undo that only reverts fields the user's own op last set; and a retry queue for sends that fail on the network rather than on validation.

**AD-2. The timeline stays in integer milliseconds.**
With AD-3, one millisecond is exactly 48 frames, so every stored position is an exact frame. Integer milliseconds are already deterministic (no accumulated floating-point drift), are validated by the server, and are used by every op, by DAWproject export and by all tests. A sample-based timeline would need a migration of every table and op and would still have to handle imported files at other rates. The cost of staying is that takes are placed on a 1 ms grid; simultaneous inputs on one device share one start stamp, so they keep their relative phase. This decision should be revisited only if phase-coherent placement between *different* devices becomes a requirement, which the network makes impossible in any case.

**AD-3. The project sample rate is fixed at 48 kHz.**
The live `AudioContext` is created with `sampleRate: 48000`, as the offline context already is. Files are decoded once at 48 kHz, capture is at 48 kHz, and live playback and export use identical buffers. The browser resamples at the device boundary on 44.1 kHz hardware. This removes defect R6 and makes export identical on every machine. Need: demonstrated (double resampling and machine-dependent output).

**AD-4. One audio clock for backing, click, count-in and capture.**
The count-in metronome moves into the engine, on the engine's context, scheduled in context time. Clicks go to a dedicated click output that is not part of the master bus, so they can never reach an export. A take's offset is measured as the context time of the first captured frame minus the context time of the downbeat, both read on the same clock; the server formula (`start = position + offset − latency`, D:676) is unchanged. The server clock is then used only to agree when a shared action starts, never to align recorded audio. Need: demonstrated (alignment depends on wall-clock arithmetic taken before the recorder starts).

**AD-5. Production audio is captured losslessly by an AudioWorklet and is separate from call audio.**
A small capture processor receives the input stream in the engine context, counts frames, and hands PCM blocks to the main thread. This is the one place where a worklet is clearly justified: `MediaRecorder` cannot produce PCM portably, has an unknown start delay and encoder priming, and gives no frame count. Takes are stored as 24-bit PCM WAV at 48 kHz (decision D2 in section 10 covers the storage cost).

Responsibilities are separated as follows.

| | Call audio | Production audio |
|---|---|---|
| Purpose | Talking, hearing each other, cueing | The recorded take |
| Path | WebRTC, Opus, jitter buffers, optional processing | Local capture → local store → HTTP upload |
| Quality | Adapts to the network | Never adapts; lossless or explicitly labelled |
| Timing | Best effort | Frame-counted on the local audio clock |

The recorder may still take its input from the call's microphone stream when the channel's profile has all processing off (so that phones do not open the microphone twice), but it records from an unprocessed capture whenever the call path has echo cancellation, noise suppression, AGC or RNNoise active. The existing behaviour that muting the microphone silences the take is kept and made visible. `MediaRecorder` remains only as a fallback when the worklet cannot start, and such takes are labelled as compressed wherever they are shown.

**AD-6. A take is durable on the device before it is durable on the server.**
Captured blocks are written to IndexedDB (already used by `frontend/src/lib/clips.ts`) and removed when the server acknowledges them. Upload is by byte offset: the client sends `offset`; the server appends only when `offset` equals the stored size and otherwise answers with the current size, so retries are idempotent. On load, the client looks for unacknowledged takes and resumes them. The server finalises any track that has been idle for a set period, deriving duration from the byte count, and ends takes whose recorders have all gone. Need: demonstrated (R1–R5, Journey C).

**AD-7. Scheduling stays on `AudioBufferSourceNode`; only the driver changes (P1).**
Source nodes are already sample-accurate and immune to main-thread jank once scheduled. A mixing engine inside a worklet or in WebAssembly would duplicate what the browser does natively and is rejected. Two changes are planned instead: a single lookahead scheduler with a horizon of several seconds that owns clips, loop passes and clicks (replacing the three separate timers), and per-clip rescheduling so that an edit during playback restarts only the affected source.

**AD-8. Metering is measured, not estimated.**
A meter processor in the same worklet module reports sample peak, RMS and an overs count per strip and for the master. The meter UI already updates the DOM directly from `requestAnimationFrame` without React (`StudioConsole.tsx:34-58`), and that is kept. An `AnalyserNode` polled per frame can miss peaks when frames are dropped, which is exactly when clipping matters.

**AD-9. Three kinds of state, with one owner each.**

| State | Owner | Examples | Rule |
|---|---|---|---|
| Project | Server; mirrored in `useDaw` | Lanes, clips, mix, tempo, markers | Changes only through ops |
| Engine | `Engine` singleton | Context, graph, buffers, scheduled sources, position, levels | Derived from project state; never written by components; read through subscriptions or `requestAnimationFrame` |
| View | Component state and `localStorage` | Zoom, scroll, selection, open panels, drag in progress | Never sent as ops; never read by the engine |

The playhead position and meter levels are engine state. They are drawn by writing to element styles from a frame callback, not by setting React state. The arrangement re-renders when the project or the view changes, not while time passes.

**AD-10. Effects remain native nodes, with worklets only where no node exists.**
EQ, compressor, reverb, delay, drive, filter and chorus stay as they are. The noise gate and a look-ahead limiter have no native equivalent and are added as worklet processors (P1). The offline context loads the same module so that live and exported sound match.

**AD-11. Media stays on local disk; no new service.**
Local disk on the shared volume is kept. Additions are Range support and immutable caching for finished files, a reference check before deletion (clips, versions, samplers), and a periodic sweep of unreferenced and unfinished files. Lossless takes roughly ninefold the bytes per minute compared with today; FLAC transcoding on finalisation using a pure-Rust encoder is a P2 option that would halve it without an external tool.

**AD-12. Tempo has one home.**
The project owns tempo, time signature and the tempo map. The console config keeps click, count-in bars and the disarmed list. The count-in length is computed from the tempo at the take's position.

### 4.2 Browser constraints that shape the design

| Constraint | Effect on the design |
|---|---|
| An `AudioContext` needs a user gesture to start | Already handled by the transport buttons; recovery of pending uploads must not depend on audio |
| Background tabs throttle timers to about one per second | AD-7's horizon must exceed that; capture and source playback are unaffected |
| `outputLatency` and input latency are missing or zero in some browsers | Latency compensation needs a calibration step (P1) and the manual nudge stays |
| `AudioContext.setSinkId` exists only in Chromium | Output device selection is offered where supported and reported as unavailable elsewhere |
| Decoded audio is 32-bit float: about 11.5 MB per mono minute at 48 kHz | A supported project size is defined and measured; a peaks cache avoids decoding just to draw |
| Storage quota and eviction for IndexedDB | Request persistent storage when a take starts; show remaining space; never delete an unacknowledged take |
| Mobile web views (Capacitor) and desktop (Tauri) | Capture worklet and IndexedDB are available in all three shells; each needs a manual pass |

### 4.3 Performance envelope

Initial target, to be confirmed by measurement in Phase 1: **16 audio tracks, 5 minutes, 200 clips, 8 active effects**, on a mid-range laptop in Chromium.

| Measure | Target |
|---|---|
| Frame rate while playing with the arrangement visible | ≥ 50 fps |
| Late loop passes or clicks over 10 minutes of looped playback | 0 |
| Time from pressing play to sound, buffers decoded | < 150 ms |
| Offline render of the 5-minute project | < 60 s |
| Tab memory with the project loaded | < 1.5 GB |

---

## 5. Prioritized backlog

Each item was assessed for user value, relevance to collaborative music making, complexity, dependencies, performance impact, whether it already exists elsewhere in Parley, and whether something simpler would do. Complexity is S (days), M (about a week), L (more than a week).

### P0: required for a reliable record → edit → mix → export loop

| ID | Item | Why it is essential | Simpler alternative considered | Size |
|---|---|---|---|---|
| P0-1 | Audio verification harness and baseline | Nothing else can be accepted without measuring audio | Keep DOM-level tests: rejected, they cannot detect any defect in this plan | M |
| P0-2 | Lossless, frame-counted capture (AD-5) | The recorded take is the product | Raise the Opus bitrate: still lossy, still no frame count | M |
| P0-3 | Durable takes: local persistence, resumable upload, server finalisation, abandoned-take cleanup (AD-6) | Journey C; defects R1–R5 | Retry only: does not survive a closed tab | L |
| P0-4 | One audio clock for click, count-in, backing and capture offset (AD-4) | Overdubs must land where they were played | Keep wall clock and add a bigger nudge: makes every take a manual fix | M |
| P0-5 | Fixed 48 kHz project rate; export with 24-bit option, dither on 16-bit, and an overs warning (AD-3) | Defects R6, R7; export is the deliverable | None | S |
| P0-6 | Peak meters with clip indication on strips and master; input level on armed tracks (AD-8) | Gain staging before and after recording | Analyser-based peak: can miss overs | M |
| P0-7 | Project safety: reload on reconnect, retry instead of discard, audio reference check before delete, authorization and ordering defects P2–P8, single tempo source (AD-12) | Committed work must stay committed and private | None; these are defects | M |

### P1: important for a complete, comfortable product

| ID | Item | Notes | Size |
|---|---|---|---|
| P1-1 | Playhead and meters outside React; memoised regions and lane heads (AD-9) | Protects the main thread that still drives timers | S |
| P1-2 | Unified lookahead scheduler; edits during playback without a restart (AD-7) | Removes the audible gap | M |
| P1-3 | Editing essentials: copy/cut/paste, marquee selection, arrow-key nudge, zoom at pointer with Ctrl+wheel and pinch, loop edge handles, draggable markers, a separate modifier for copy | The workflows experienced users expect | M |
| P1-4 | Track resize and reorder | Reorder is an op on `position`; height is view state | S |
| P1-5 | Overlap rule on a lane: the later clip wins, with an automatic short crossfade at the seam | Simpler than free crossfade editing, and it also gives comping its seams | M |
| P1-6 | Take lanes and basic comping: takes at the same place form a group; choose a take per range | Builds on the existing group model | M |
| P1-7 | Noise gate and look-ahead limiter as worklet effects (AD-10) | Required list in the brief; no native node | M |
| P1-8 | Latency calibration by loopback, stored per device; visible monitoring latency and headphone advice | Self-reported latency is unreliable | M |
| P1-9 | Collaboration hardening: item-level ops for notes, automation, effects and markers; conflict-aware undo; per-user solo; optional "only the owner and crew edit this track" | Defects E1, E2; see decision D5 | L |
| P1-10 | Recording does not depend on voice-room state: eligibility from band role and armed tracks | Removes the solo musician's detour through voice, and the per-instance failures of `parley-hx7z` | M |
| P1-11 | Read-only DAW for listeners with shared playback and comments | "Remote listening and review" | S |
| P1-12 | Automatic versions (at session end and at a coarse interval while editing), pruned before manual ones | Version history without effort | S |
| P1-13 | Media hygiene: Range and immutable caching, peaks cache, orphan sweep, raised and duration-based take limit | Defect R8; large projects | M |
| P1-14 | Output device selection where the browser supports it | Exists for calls and sound effects already | S |
| P1-15 | Live waveform while recording | Confidence that the right input is being captured; the capture worklet already has the samples | S |
| P1-16 | DAWproject: import the devices Parley exports; export clip gain | Round-trip fidelity | S |
| P1-17 | Cross-browser coverage: Studio suites on WebKit; manual matrix for Firefox, iOS, Android and desktop shells | Compatibility is currently unknown | M |
| P1-18 | Instrument audition through the lane chain; fix the stuck note (E3) | Hearing what will be exported | S |

### P2: advanced or nice to have

| ID | Item |
|---|---|
| P2-1 | Automation write modes (touch, latch) and master automation; curved segments |
| P2-2 | FLAC storage of takes on finalisation |
| P2-3 | Windowed decoding and buffer eviction for projects beyond the envelope |
| P2-4 | Sample-level waveform when zoomed in; absolute-level waveform scale |
| P2-5 | Range and loop-only export; export progress and cancel; normalisation to a loudness target |
| P2-6 | Graphical EQ and gain-reduction meter |
| P2-7 | Comment replies and range comments; version comparison and audition |
| P2-8 | Recording MIDI during a take, with count-in and input quantise |
| P2-9 | Time signatures other than n/4 |
| P2-10 | Fade curve shapes |

Out-of-scope items are listed with reasons in section 8.

---

## 6. Implementation phases

Phases 1–4 are P0 and are ordered so that each one is measured by the harness built in Phase 1. Phases 5 and 6 are P1 and independent of each other. Every phase ends with the full existing Studio suites passing, a deploy to the test stack, and a review.

### Phase 1: Verification foundation

**Scope**
- Test hooks in the engine, following the existing `window.__parley*` convention: render the project (or a stem) and return the samples; expose the master output as a `MediaStream` for loopback tests.
- A helper library for suites: generate WAV fixtures (sine, impulse train, DC step, silence) at chosen rates; decode a rendered buffer; measure peak, RMS, per-channel level, impulse positions and cross-correlation lag.
- A synthetic microphone installed by the test with `addInitScript`, replacing `getUserMedia` inside the test page only, so recording tests are deterministic and work in every engine.
- New suite `studiorender.mjs` asserting today's behaviour as a baseline (section 9.2), and `studiorecord.mjs` measuring today's take alignment and duration error without asserting a tolerance yet.
- A unit test runner for pure modules (decision D6), with first tests for `tempo.ts`, op inversion, WAV encoding and the take-placement arithmetic (extracted from D:676-708 into a pure function with Rust unit tests).
- Remove unconditional passes and the machine-specific path from the existing suites; make the Studio suites honour `E2E_BROWSER`.
- A performance fixture project matching the envelope in 4.3, with a script that records the measures.

**Dependencies**: none.

**Expected files**: `frontend/src/lib/daw.ts` (hooks only), `frontend/e2e/lib.mjs`, new `frontend/e2e/audio.mjs`, new suites, `frontend/package.json`, `.github/workflows/ci.yml`, D (extract pure function and tests).

**Acceptance criteria**
- The baseline suite passes on Chromium and WebKit and fails when a gain, pan or fade constant in the engine is deliberately changed.
- A written baseline of measured alignment error, duration error and the performance figures exists for the current code.
- No production behaviour changes.

**Automated tests**: the new suites and unit tests themselves; existing suites unchanged in outcome.

**Manual verification**: run the baseline on one 44.1 kHz and one 48 kHz output device and record the difference in the rendered file (expected to differ today; this is defect R6).

**Risks**: WebKit under Playwright may not run every existing Studio check; those are marked as skipped with a reason rather than removed. Debug hooks must expose nothing that a page script could not already reach.

### Phase 2: Recording integrity

**Scope**
- Worklet module with a capture processor; recorder rewritten to use it, at 48 kHz, 24-bit PCM, one or two channels according to the lane's input (P0-2).
- Engine context created at 48 kHz (AD-3, live side).
- Count-in and click moved into the engine on a click output outside the master (AD-4); the second `AudioContext` and the unused `useMultitrack` are removed.
- Offset measured on the audio clock; duration derived from the frame count.
- IndexedDB take store; upload by byte offset with retry and backoff; recovery on load; `pagehide` flush; storage estimate and persistence request (AD-6).
- Server: offset-checked append; finalisation that fixes the WAV header and derives duration from size; a sweep that finalises idle tracks and ends takes with no active recorder; take limit expressed in duration; `create_track` validates lane ownership and the armed list (P5); `delete_session` checks ownership first and refuses a take in progress (P4).
- Input level and input name on armed tracks before and during recording; upload progress on the take; a clear state for "recorded here, still uploading".
- `MediaRecorder` kept as a labelled fallback.

**Dependencies**: Phase 1.

**Expected files**: `frontend/src/lib/studio.ts`, new `frontend/src/lib/worklets/studio.ts`, new `frontend/src/lib/takestore.ts`, `frontend/src/lib/daw.ts`, `frontend/src/lib/multitrack.ts`, `frontend/src/lib/monitor.ts`, `frontend/src/components/Daw.tsx`, `DawMixer.tsx`, `DawPanels.tsx`, S, D, a migration (track sample rate, channels, bit depth, last-chunk time), `README.md`.

**Acceptance criteria**
- A recorded take decodes to PCM whose samples match the synthetic input within 24-bit quantisation; no lossy stage.
- With a loopback of known delay, the take is placed within ±1 ms of the expected position after reported latency, in 20 of 20 runs.
- Recorded duration equals the frame count; 60 s of input yields 60 s ± 1 frame block.
- With the network cut for 20 s during a take, the finished take is complete and continuous.
- With the page closed during a take, reopening the project uploads the remainder and the take is placed without user action; if the user never returns, the server places what it received within the idle period.
- A take abandoned by its starter no longer blocks recording.
- The click is absent from every recorded take and from every export.

**Automated tests**: `studiorecord.mjs` with tolerances asserted; fault injection with `page.route` (dropped, delayed and duplicated chunk requests); page close and reopen; server restart between chunks; Rust unit tests for offset append and finalisation; regression of `studio`, `studioaudio`, `studioconsole`, `studiodaw`, `studiodaw2`, `studiolive`.

**Manual verification**: record a vocal over a backing track with a USB interface and with a laptop microphone, on Chrome, Safari and Firefox and in the iOS and Android apps; listen for alignment against a click; pull the network cable mid-take; force-quit the browser mid-take; record with Bluetooth headphones and note the reported latency.

**Risks**
- Upload volume rises about ninefold; slow uplinks will finish uploading after the take ends. Mitigated by local durability and visible progress; see decision D2.
- Device storage may be short on phones; recording refuses to start below a threshold and says why.
- Opening a second capture of the same microphone can fail on some phones; the recorder then uses the call stream and labels the take if processing was active.
- A 48 kHz context on 44.1 kHz hardware adds a small resampling cost and possibly latency; measured in the manual pass.

### Phase 3: Project safety and synchronisation

**Scope**
- Reload the open project, take list and comments on a fresh `READY` (P2).
- Send queue: network failures retry with backoff and keep the optimistic state; only a server refusal reverts, and it reverts that edit rather than the project (P1). A visible "saving / saved / offline" indicator.
- Audio may not be deleted while a clip, a saved version or a sampler refers to it (P3).
- Project events sent only to those who can view the channel (P6); rename and tempo through ops limited to crew, with the channel name kept in step (P7); role change made atomic (P8); unique constraint on one open take per project (P9); op broadcast order guaranteed (P10).
- Tempo and signature owned by the project; count-in from the tempo at the take position; restore no longer leaves a stale copy (AD-12).

**Dependencies**: Phase 1. Independent of Phase 2.

**Expected files**: `frontend/src/lib/ws.ts`, `frontend/src/lib/daw.ts`, `frontend/src/components/Daw.tsx`, S, D, `backend/src/routes/channels.rs`, a migration.

**Acceptance criteria**
- Edits made during a 30 s network outage are all present on the server afterwards, in order, with no reload.
- After a backend restart, an open project shows edits made by another user in the meantime without any action.
- A version saved before a take was deleted restores with all its clips.
- A member without view permission on a private project receives no event that names it.
- An artist cannot rename the project by any route.

**Automated tests**: new suite `studiosync.mjs` (offline edit queue, forced socket close with and without resume, backend restart, two clients editing during one client's outage); permission matrix additions to `studioprojects.mjs`; version-with-deleted-take restore in `studiodaw2.mjs`.

**Manual verification**: two people edit while one switches between Wi-Fi and mobile data; laptop sleep and wake with the project open.

**Risks**: a queued edit can conflict with what others did during the outage; because ops are field-level and applied in order on the server, the result is last-writer-wins and the client reloads if the server refuses. This is stated in the UI rather than hidden.

### Phase 4: Honest mixing and export

**Scope**
- Meter processor; strips and master show peak with hold, RMS, and a latched clip indicator that is cleared by clicking; a working dB scale (P0-6).
- Export: 16-bit with TPDF dither or 24-bit; a pre-flight that reports the true maximum and blocks nothing but states "the mix exceeds full scale by x dB"; stems aligned to the mix start and the same length (P0-5).
- Sum of stems equals the mix when the master chain is empty.
- Rendered-audio regression tests for every mix feature (section 9.2).

**Dependencies**: Phases 1 and 2 (worklet module, 48 kHz context).

**Expected files**: the worklet module, `frontend/src/lib/daw.ts`, `multitrack.ts`, `exporters.ts`, `frontend/src/components/StudioConsole.tsx`, `DawMixer.tsx`, `DawPanels.tsx`.

**Acceptance criteria**
- A full-scale sine reads 0 dBFS peak and −3 dBFS RMS on the meter, within 0.1 dB; a signal 1 dB over latches the clip indicator within one frame block.
- The same project exported on a 44.1 kHz and a 48 kHz device produces identical files.
- A 24-bit export of a −60 dBFS sine has the expected level within 0.1 dB; a 16-bit export of the same shows dither rather than truncation distortion.
- All render tests in 9.2 pass on Chromium and WebKit.

**Automated tests**: `studiorender.mjs` extended; WAV header and length checks; stems null test; meter readings through a test hook.

**Manual verification**: listening comparison of live playback against the exported file on headphones; import the WAV and stems into REAPER or Audacity and confirm alignment and levels.

**Risks**: one meter node per strip adds processing; measured against the envelope, with a fallback of metering only visible strips.

### Phase 5: Editing workflow and engine responsiveness (P1)

**Scope**: P1-1 to P1-8, P1-14, P1-15, P1-18.

**Dependencies**: Phases 1 and 4. P1-6 depends on P1-5.

**Expected files**: `frontend/src/components/Daw.tsx` (split into arrangement, lane head and region modules as part of memoisation), `DawMixer.tsx`, `DawPianoRoll.tsx`, `DawInstrument.tsx`, `frontend/src/lib/daw.ts`, `fx.ts`, the worklet module, D (overlap and comp validation).

**Acceptance criteria**
- With the envelope project playing, React commits per second are near zero while nothing is edited, and the frame rate target is met.
- Moving, trimming or muting a clip during playback produces no gap in other clips' audio (verified by recording the master output and checking for discontinuities).
- Ten minutes of looped playback in a background tab has no late pass.
- Each new editing command has an exact expected result on clip fields and is undoable in one step.
- Gate and limiter behave the same live and in export; the limiter output never exceeds its ceiling.
- After calibration, loopback alignment is within ±1 ms without relying on browser-reported latency.

**Automated tests**: `dawedit.mjs` with exact field expectations for every command and its undo; gap detection during edits; gate threshold and limiter ceiling render tests; performance script in CI as a non-blocking report.

**Manual verification**: an experienced DAW user completes a fixed editing script (import, cut, comp two takes, crossfade, automate) and reports where the tool surprised them; trackpad pinch and Ctrl+wheel on macOS and Windows.

**Risks**: splitting `Daw.tsx` touches most selectors used by existing suites, so `data-daw-*` attributes are preserved exactly. The overlap rule changes how existing overlapping clips sound; projects that already contain overlaps keep summing until edited, and this is announced.

### Phase 6: Collaboration hardening (P1)

**Scope**: P1-9 to P1-13, P1-16, P1-17.

**Dependencies**: Phase 3.

**Expected files**: D (item-level ops, track protection, auto versions, sweep), S (eligibility), `backend/src/ws/hub.rs` only if presence is needed across instances, `frontend/src/lib/daw.ts`, `DawPianoRoll.tsx`, `DawAutomation.tsx`, `frontend/src/components/VoiceView.tsx`, `dawproject.ts`, migrations.

**Acceptance criteria**
- Two users adding notes to the same clip, or points to the same lane, at the same time both keep their additions.
- Undo after another user changed the same field does not overwrite their change and says so.
- One user's solo does not change what another hears or what is exported.
- A protected track rejects edits from other artists on the server.
- A take can be recorded by a band member who is connected to a different backend instance from the engineer.
- A listener can open the project, follow shared playback and comment, and cannot edit.

**Automated tests**: `studiocollab.mjs` driving truly simultaneous ops from two clients (interleaved requests, same-clip and delete-versus-edit races), asserting the server state and both clients' converged state; two-instance run of the recording suites using the existing second test backend; DAWproject effect round trip.

**Manual verification**: two musicians in different locations complete Journey B from a written script and note every moment they were unsure what the other was doing.

**Risks**: item-level ops add op types that old clients do not understand; the server keeps accepting whole-collection puts, and clients reload on an unknown op. Per-user solo changes a shipped behaviour and DAWproject export of solo; see decision D5.

---

## 7. End-to-end user journeys

### Journey A: record vocals over a backing track and export

| Step | Today | After |
|---|---|---|
| Create and name a project | Functional | Unchanged |
| Import a backing track | Functional; file decoded at device rate | Decoded once at 48 kHz (Phase 2) |
| Choose the microphone and check level | Input can be chosen; no input meter | Input level and name on the armed track (Phase 2) |
| Record with count-in | Works; must join the voice room first; lossy; click on a separate clock | Lossless, frame-counted, click on the audio clock (Phase 2); no voice room needed for a solo take (Phase 6) |
| Take lands in time | Approximately, by reported latency | Within ±1 ms of the audio clock measurement (Phase 2); calibrated (Phase 5) |
| Trim, split, fade, adjust gain | Functional | Exact results verified (Phases 1, 5) |
| Balance with faders, add EQ and reverb | Functional; meters misleading | Peak meters and clip indication (Phase 4) |
| Export WAV | 16-bit, device-dependent, silent clipping | Deterministic, 16- or 24-bit, overs reported (Phase 4) |

Journey A is reliable after Phase 4.

### Journey B: two musicians build a shared mix

| Step | Today | After |
|---|---|---|
| Both open the project | Functional for band members | Unchanged |
| Each records a part | Functional when both reach the same backend instance | Durable takes (Phase 2); instance-independent (Phase 6) |
| Each sees the other's take arrive | After upload and finish | Progress visible while uploading (Phase 2) |
| Each edits their own part at the same time | Functional for different clips; collections overwrite; undo can clobber | Item-level ops and safe undo (Phase 6) |
| One loses connection briefly | Edits made meanwhile are discarded | Queued and applied (Phase 3) |
| They listen together | Shared transport, approximate sync | Unchanged; documented as review-grade, not performance-grade |
| They mix | Shared mix; solo affects both | Per-user solo (Phase 6) |
| They export | As Journey A | As Journey A |

Journey B is usable after Phase 4 and comfortable after Phase 6.

The three kinds of real-time behaviour are kept distinct throughout:

| Kind | Mechanism | Guarantee |
|---|---|---|
| Collaborative editing | Ops over HTTP, events over WebSocket | Everyone converges on the server's state |
| Synchronised listening | Shared transport with a server timestamp | Everyone hears the same place within tens of milliseconds; good for review |
| Live performance | The voice call (WebRTC, music profile) | Whatever the network allows; not a recording path and not sample-aligned |

Recording together means each musician records locally against their own playback of the backing; the takes are then aligned on the timeline. It does not mean playing in time with each other over the network, which latency rules out.

### Journey C: close the browser mid-session and return

| Situation | Today | After |
|---|---|---|
| Edits made before closing | Kept; each was committed when made | Unchanged |
| An edit in flight when the tab closed (within the 150 ms debounce of a live control) | May be lost | Flushed on `pagehide` (Phase 3) |
| A take being recorded | The unsent tail is lost and the whole take is never placed | Captured blocks are on the device; upload resumes on return, and the server places what it has if the user does not return (Phase 2) |
| A take finished recording but still uploading | Same loss | Same recovery |
| Undo history | Lost | Lost; stated in the UI. Versions are the recovery route (automatic versions in Phase 6) |
| Project state on return | Loaded from the server | Unchanged |

"Committed work" is defined as: every acknowledged edit, and every frame of audio that was captured before the browser closed. Journey C is met after Phases 2 and 3.

---

## 8. Explicit exclusions

| Excluded | Reason |
|---|---|
| Rebuilding the engine in an AudioWorklet or WebAssembly | Native source nodes are already sample-accurate; a second mixing engine would duplicate the browser and create a competing implementation |
| A CRDT or local-first document model | The server-validated op model works; the specific collisions are solved by item-level ops |
| A sample-based timeline | AD-2: millisecond positions are exact frames at 48 kHz; the migration has no audible benefit |
| Playing in time together over the network | Network latency makes it impossible to guarantee; the call remains the place for it, without sample alignment |
| Server-side rendering or mixdown | No backend capability exists; the browser renders deterministically after AD-3; it would add a service and its cost |
| Plug-in hosting (VST, AU, CLAP, WAM) | Not available in browsers in a portable way; large security and compatibility surface |
| Time-stretching, warping, pitch correction | Substantial DSP with no browser primitive; not needed for record → edit → mix → export |
| Video tracks, surround and immersive formats | Outside the music-collaboration core |
| Step sequencer, MIDI CC and pitch-bend editing, notation | MIDI is a supporting feature; audio recording is the core |
| Per-user independent mixes | One shared mix is the product; per-user solo covers the practical need |
| Offline editing with later merge | Requires a different consistency model; a short outage queue covers the practical need |
| Full editing on phones | Phones keep play, record, levels and comments; precise editing needs a pointer and space |
| External paid services for storage, transcoding or mastering | Constraint of the brief; local disk and browser-native processing suffice |
| Source separation, automatic mixing or mastering | Not required for the core loop; would add heavy dependencies |

---

## 9. Verification strategy

### 9.1 Principles

1. Assert on audio wherever sound is the outcome. A test of a fader renders the project and measures the level; it does not read the fader's position.
2. Generate fixtures. Sines, impulses and steps with known properties are created by the test, so expected values are computed rather than recorded.
3. Keep the existing suites as regression. Their `data-daw-*` selectors and API expectations are preserved through every phase.
4. Run on more than one engine. Rendering and editing tests run on Chromium and WebKit in CI; recording tests use a synthetic microphone that works in both.
5. Pure arithmetic gets unit tests; anything involving Web Audio is tested in a browser.

### 9.2 Automated coverage

| Area | Method | Example assertions |
|---|---|---|
| Timeline editing | UI actions, then API read | After a move, trim, split, duplicate, paste or delete, every clip field equals a computed value; undo restores the exact prior fields |
| Playback alignment | Render two impulse clips | Impulses appear at exactly the expected frames; a split clip renders identically to the unsplit clip |
| Gain, pan | Render a sine | Level changes by `20·log10(gain)` ± 0.1 dB; pan law per channel matches the node's law |
| Mute, solo, buses, sends | Render with each combination | Muted and non-soloed lanes are silent; bus and send levels match computed sums |
| Fades, clip gain | Render a DC step | Envelope is linear between the expected frames |
| Automation | Render with breakpoints | Level at chosen times matches interpolation |
| Effects | Render with one effect at a time | Bypass is bit-identical to no effect; parameters change the measured response in the expected direction; live capture of the master equals the offline render within tolerance |
| Effect persistence | Set, reload the page, render | Rendered output before and after reload is identical |
| Recording duration and alignment | Synthetic microphone fed from the master output through a known delay | Take length equals captured frames; impulse lag equals delay minus reported latency ± 1 ms; loop passes and punch ranges cut at the expected frames |
| Click | Record and export with the click on | No click energy in the take or the export |
| Undo and redo | Scripted sequences, including after a remote edit | State equals the expected state at each step; no remote change is lost |
| Save and load | Build a project, reload, compare | Project JSON and rendered audio are identical before and after |
| Export | Parse the file | Header fields, frame count, channel count, sample rate and bit depth; peak equals the render's peak; stems sum to the mix |
| Multi-user editing | Two clients issuing simultaneous requests | Server state is one of the valid serial orders; both clients converge; item-level additions are all kept |
| Reconnection | Close the socket, block the network, restart the backend | Clients converge without a manual reload; queued edits are applied once |
| Media recovery | Drop, delay and duplicate chunk requests; close the page; restart the server | The finished take is complete, continuous and placed; no orphan files remain after the sweep |
| Permissions | API matrix per role | Each endpoint returns the expected status; no event reaches a user without view permission |
| Performance | Envelope project with tracing | The measures in 4.3, reported per run and compared with the baseline |
| Backend | Rust unit tests | Take placement, loop and punch slicing, offset append, finalisation, validators |

### 9.3 Manual coverage

| Area | Procedure |
|---|---|
| Listening | Compare live playback with the exported file; record against a click and listen for flam |
| Hardware | Built-in microphone, USB interface with two inputs, Bluetooth headphones, wired headphones |
| Browsers and shells | Chrome, Edge, Safari, Firefox on desktop; Safari on iOS; Chrome on Android; the iOS and Android apps; the desktop app. One Journey A pass each per release that touches recording or the engine |
| Interruption | Network loss, sleep and wake, tab discard, browser crash, backend deploy during a take |
| Two-person session | Journey B across two networks, from a written script |
| Long session | Ninety minutes of recording and editing in one tab, watching memory and responsiveness |

### 9.4 Compatibility statement

A capability is described as supported in a browser only after its row in 9.3 has been run there. Until then the documentation says "tested in Chromium".

---

## 10. Decisions requested from reviewers

These are the choices with real trade-offs. Each has a recommendation; the plan above assumes it.

**D1. Keep the architecture and fix five properties, rather than rebuild.**
Recommended. The alternative is an engine rewrite, which would delay every user-visible improvement and discard code that the investigation found to be structurally sound.

**D2. Lossless takes as 24-bit, 48 kHz PCM.**
Recommended. Cost: about 8.6 MB per mono minute against 0.96 MB today, on the server's disk and on each musician's uplink (1.15 Mbit/s for mono in real time). Options: (a) 24-bit PCM now, FLAC on the server later (recommended); (b) 16-bit PCM, two thirds of the size, less headroom for quiet recordings; (c) stay with Opus at a higher bitrate, which remains lossy and keeps the timing problems. A per-take limit must replace the 30 MB cap; 30 minutes per take is proposed.

**D3. A fixed 48 kHz project rate.**
Recommended. Cost: the browser resamples at the output on 44.1 kHz devices. Benefit: identical buffers for playback and export, exact millisecond-to-frame mapping, one capture rate.

**D4. Millisecond timeline kept.**
Recommended, as a consequence of D3.

**D5. Solo becomes per user and is not exported; mute stays shared.**
Recommended for collaboration, but it changes shipped behaviour and what DAWproject export writes. The alternative is to keep solo shared and add a separate per-user "listen" control.

**D6. A unit test runner for the frontend.**
The frontend has none. Recommended: Vitest as a development-only dependency, because it uses the existing Vite configuration and module resolution. The dependency-free alternative is Node's built-in runner with type stripping, which needs explicit file extensions in imports and so would force changes to the modules under test.

**D7. Recording eligibility independent of the voice room (Phase 6).**
Recommended. It removes a detour for solo work and the per-instance failure, at the cost of rethinking who is "armed" when nobody is in a call.

**D8. `MediaRecorder` kept as a labelled fallback.**
Recommended. The alternative is to refuse to record when the worklet cannot start, which is simpler to test but fails the musician at the worst moment.

**D9. Order of work.**
Recommended: Phases 1 → 2 → 3 → 4, then 5 and 6 in either order. Phase 3 can run alongside Phase 2 if two people are available.

---

## Appendix: statements to correct in existing documentation

| Where | Statement | Finding |
|---|---|---|
| `README.md:406` | Takes are "capped at 30 MB (about an hour)" | About 33 minutes at 128 kbps (S:24)  Corrected in Phase 2. |
| `website/index.html:817` | "records their own track in full quality, so a bad connection never ruins a take" | Lossy capture; a failed chunk is dropped (`studio.ts:163-169`) |
| `README.md:412` | Effects "render the same in export" | True by construction (shared graph builder) but untested, and not true of sample rate on 44.1 kHz devices |
| D:10 | Module comment says editing needs Manage Channels and presence in the studio | Editing needs a band role or Manage Projects, and no presence (D:157-166) |

These are corrected in the phase that changes the behaviour, or immediately where the text is simply wrong.
