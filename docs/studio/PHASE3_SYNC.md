# Parley Studio: Phase 3 results (project safety and synchronisation)

| | |
|---|---|
| Date | 2026-11-14 |
| Plan | [DAW_COMPLETION_PLAN.md](DAW_COMPLETION_PLAN.md), Phase 3 |
| Tracker | `parley-pods.10` |

Every result here is *measured* by a suite in `frontend/e2e/suites/` against a running stack (headless browsers, one
backend instance unless it says otherwise). What was not measured is listed in section 5 and is not claimed.

## 1. What changed

- **Edits wait for the server instead of being lost.** The DAW keeps an outbox of edit batches
  (`frontend/src/lib/daw.ts`). One batch is in flight at a time, in the order the edits were made. A batch that gets
  no answer (no network, a server error, a timeout) stays and is tried again with backoff (0.5 s to 8 s), at once when
  the browser reports the network back or the socket reconnects. Nothing is reloaded over edits that are waiting: when
  the project is taken from the server again, or another member's edit arrives, the waiting edits are put back on top.
- **A refused edit goes alone.** A batch the server answers with a refusal (4xx other than 408, 425, 429) is dropped,
  the member is told why, it leaves the undo history, and the project is taken from the server again with the edits
  still waiting on top. The edits before and after it are kept.
- **The member can see it.** The transport shows *All changes saved*, *Saving…*, or *Offline (n)* with the number of
  edits waiting (`data-daw-sync`, `data-daw-unsent`). The browser asks before the page is closed while any are
  waiting.
- **A reconnect brings the project up to date.** A resumed socket replays what was missed. A fresh one (`READY`)
  takes the open project again, with its comments, takes, versions and console; if the server does not answer yet it
  is asked again every 2 s until it does.
- **Events that cross are put in order.** An edit event that arrives before the one it follows is held for up to
  400 ms; if its predecessor does not come, the project is taken from the server. Within one backend instance a
  per-project lock keeps commit and broadcast in version order.
- **Versions keep their audio.** Deleting a take leaves in place any audio that a clip, a sampler, or a *saved
  version* still refers to (`AUDIO_IN_USE` in `backend/src/routes/studio.rs`).
- **One tempo.** The tempo and time signature are the project's. The console reads them from the project
  (`studio_config.bpm` and `beats` are no longer read when a project exists); setting them on the console sets the
  project. A take's count-in and click use the tempo in force where the take starts (`tempo_at`).
- **Who may change what.** Renaming a project and changing its tempo, time signature or tempo map through an edit
  needs the same right as through the project's settings (engineers and Manage Projects). An edit that carries them
  unchanged is anyone's in the band. A rename through an edit renames the channel in the same transaction. In the
  DAW, the tempo controls are disabled for members who may not change them.
- **Who hears of it.** Band, console and arming changes and project renames were sent to every member of the server;
  they now go only to those who can view the project's channel.
- **Smaller fixes.** A band role is refused for a member who may not speak in the channel *before* anything is
  stored. Two takes cannot be open in one project: a unique index decides when two start at once (migration `0160`,
  which also ends any extra open take already there, keeping the newest).

## 2. Acceptance criteria

| Criterion (plan) | Result | Where |
|---|---|---|
| Edits made during a 30 s network outage are all present on the server afterwards, in order, with no reload | 12 dependent edits (a track, a clip on it, ten moves and renames) made offline, held 30 s; afterwards the server is 12 versions on, the last state stands, and the page fetched the project 0 times. Another member's two edits made during the outage are in the open project as well | `studiosync` 2 |
| After a backend restart, an open project shows edits made by another user in the meantime without any action | `docker restart` of the backend with the project open: two edits made while it was down are saved once it is back, and another member's edit made after the restart appears in the open project | `studiosync` 6 (with `STUDIO_RESTART_CMD`) |
| A version saved before a take was deleted restores with all its clips | A recorded take's clips deleted, then the take; its audio is still served; restoring the version brings back every clip with its audio, on the timeline | `studiodaw2` |
| A member without view permission on a private project receives no event that names it | A member denied View on the project's channel, on a socket of their own, receives nothing naming the project, its channel or its contents during: band change, console change, arming, rename (both routes), edits, version restore, comment, take start and stop. A member who can see it receives them | `studioprojects` |
| An artist cannot rename the project by any route | `PATCH` and the edit route both answer 403, including inside a batch of otherwise allowed edits (none of which is kept); tempo, time signature and tempo map likewise | `studioprojects` |

Also measured:

| | Result | Where |
|---|---|---|
| A refused edit between two good ones | The refused one is reverted on screen and leaves the undo history; the other two are on the server; the member is told | `studiosync` 3 |
| Socket dropped and resumed | The missed edit is replayed; the project is not fetched | `studiosync` 4 |
| Socket back fresh while the network is away | The open project, its comments and its take list are taken again once the server answers | `studiosync` 4 |
| Events out of order | Version n+2 then n+1: both applied in order, nothing fetched. n+5 alone: project fetched after the wait | `studiosync` 5 |
| Two engineers start a take at once | Of four simultaneous requests one starts, three are answered 409; one take is open | `studioprojects` |
| Count-in at the tempo where the take starts | 120 BPM with 60 from bar 3: one bar of count-in is 2000 ms from the start, 4000 ms from 8 s | `studioprojects`; `tempo_at` unit test |
| Console tempo after a version restore | Reads the restored project's tempo | `studioprojects` |
| Band role without Speak | 400, and the member is in neither list | `studioprojects` |

`studiosync` needs no microphone and passes on Chromium and WebKit (WebKit with a 10 s outage and the restart).

Unit tests: `cargo test` (87, with `tempo_at`), `npm test`. Gates: `npx tsc -b`, `npx oxlint src` (warnings
only, none new), `npm run build`. Regression on Chromium: `studio`, `studioaudio`, `studioconsole`, `studiodaw`,
`studiodaw2`, `studiolive`, `studioprojects`, `studiorender`, `studiotakes`, `dawdrag`, `dawproject` pass;
`studiorecord` see section 3. On WebKit: `dawdrag`, `dawproject`, `studiorender`, `studiosync`.

## 3. Found on the way

- **A fresh socket could arrive before the server answered requests.** WebKit's offline mode does not stop
  WebSockets, which showed it: `READY` came, the project fetch failed, and nothing tried again, so the open project
  stayed stale until the next edit. The fetch is now repeated until it is answered. The same happens for real when a
  proxy accepts sockets before the API is up.
- **`studiorecord` is not steady on this machine.** Run three times with a minute of noise it failed twice and
  passed once: each failure was one block of 128 samples of silence in the stored take, everything after it in
  place. Nothing in this phase touches recording. It was followed up in Phase 4
  ([PHASE4_MIX_EXPORT.md](PHASE4_MIX_EXPORT.md), section 3): the browser had not run the audio thread for that
  block. The recorder now counts such blocks and tells the member, and the suite checks every sample outside them.


## 4. Behaviour that differs from before

- An edit made without a connection is no longer undone with an error; it stays on screen, counted in the transport,
  and is saved when the server answers. The error toast is kept for edits the server refuses.
- A member who may not change the tempo sees the tempo controls disabled, and an edit that changes it is refused
  (it was accepted before through the edit route).
- Setting the tempo on the console of a project changes the project's tempo for everyone, with a new project version.
- Deleting a take whose audio a saved version uses keeps the audio file; the take leaves the list as before.
- A second take started while one is open is answered 409 in every case (two at the same instant could both start).
- Members who cannot view a project's channel no longer receive its band, console, arming and rename events.
  Clients that relied on them for a channel they cannot see get nothing; none in this repository did.

## 5. Not verified, and known limits

- **A batch sent again after its answer was lost** is applied a second time. Edits are whole-item puts, so the second
  application normally changes nothing, but if another member changed the same item in between, their change is
  overwritten by the repeat (`parley-pods.11`). Not tested; needs an idempotency key per batch.
- **Waiting edits live in memory.** The browser asks before closing, but a crash or a forced close loses them
  (`parley-pods.12`). The plan spoke of sending them as the page is hidden; that was not built: only the question
  before closing is.
- **Two backend instances.** The per-project lock orders events within one instance. Across instances the client's
  400 ms reorder window and the fetch after it are what restore order (`parley-pods.13`). The reorder path is tested
  with injected events; no suite ran two instances editing one project.
- **The visibility test was not run against the old code.** It shows that a hidden member receives nothing now and
  that a visible member receives the events; it was not checked that the same test fails before the change.
- **`studio_config.bpm` and `beats`** are still written for a project (so that an older client reads something
  sensible) and no longer read. They can be dropped once no client reads them.
- **Outages longer than 30 s**, and outages during a recording, were not exercised. Take upload has its own retry
  from Phase 2 and was not changed.
- **No manual pass.** Nothing here was tried by hand in a desktop or mobile browser, in the desktop app, or on a
  real unreliable network; the browsers were headless Chromium and WebKit on one machine. Firefox was not run.
