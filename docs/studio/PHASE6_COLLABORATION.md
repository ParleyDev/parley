# Parley Studio: Phase 6 results (collaboration hardening)

| | |
|---|---|
| Date | 2026-11-14 |
| Plan | [DAW_COMPLETION_PLAN.md](DAW_COMPLETION_PLAN.md), Phase 6 |
| Tracker | `parley-pods.17` |

Every result here is *measured* by a suite in `frontend/e2e/suites/` against a running stack of two backend
instances on one database with headless browsers, or by the unit tests. What was not built or not measured is listed
in section 5 and is not claimed. Nothing in this phase has had a manual pass.

## 1. What changed

### Editing together

- **Lists are edited by item.** Notes of a clip, points of an automation curve, effects of a track, a bus or the
  master, and markers were each one field, replaced whole: two members adding to one list at once left the list of
  whoever came second. They are now sent as what was added, changed and removed (`notes`, `auto`, `fx.put`,
  `fx.del`, `marker.put`, `marker.del`), and the server merges them into the list as it is then. The editor still
  writes whole lists; `itemize` in `frontend/src/lib/dawops.ts` turns each into its difference from the project as
  it is on the page before it is sent. The server still takes whole lists, as before.
- **An item that is gone stays gone.** A change to a note, an effect or a marker that someone else removed meanwhile
  is dropped, not turned into a new one.
- **Undo leaves what someone else changed since.** An undo (and a redo) is compared, field by field and item by
  item, with the project as it is now: what is still as this member left it is taken back, a field someone else has
  changed keeps their value, and a clip or track they deleted stays deleted (`settle` in `dawops.ts`). The editor
  says so: "Someone changed that since: their change was kept", or "…part of that…" when the rest was taken back.
  The comparison is with the value as the server stored it (rounded or held within bounds), not as it was typed.
- **A batch of edits is applied once.** Each batch goes under an id; the server keeps the ids it has applied for a
  day (`studio_op_batches`) and answers a repeat with `repeat: true` and no change. A batch sent again because its
  answer was lost no longer undoes what another member did in between (`parley-pods.11`).
- **Solo is each member's own.** It is kept on the device, by project, never sent, and not in what is exported
  (the mix, the stems, DAWproject). The server stores no solo and ignores one it is sent; the migration clears the
  ones that were stored. Mute is still shared.
- **A track can be protected** by its owner or an engineer (track menu): only its owner and the engineers then
  change it, its clips, its notes, its automation and its effects. The server refuses anyone else with 403; the
  editor does not make the edit and says why. A lock shows on the track for everyone.

### Recording without the voice room

- **Who records is decided by the band, not by the call.** A take is started by an engineer (or by any band member,
  alone) with the project open; no one needs to be in the project's voice room. The take counts in the owners of
  armed tracks and whoever is in the room, less those the console disarmed. A track is recorded into by its owner
  while it is armed, on whichever backend instance they are connected to: the server checks band role and the armed
  track, not the room's members (which only the instance they are connected to knows).
- **Outside a call the input is the device itself**, with no processing, opened when the take starts and closed when
  it ends. Nothing is opened because a page is open. In a call nothing changed.
- **The audience records nothing and starts nothing**, in the room or out of it.

### Listening in

- **Whoever can see a project can open its editor**, read-only: they play it for themselves, follow the shared
  playback and its stop, see the band's edits as they are made, and comment. A line under the editor says so. Their
  edits are not made (and they are told why); the server refuses them and their transport commands with 403. They
  have no record button.

### Versions and media

- **The server saves a version by itself** while a project is being edited: when an edit arrives and none was saved
  for `STUDIO_AUTOSAVE_SECS` (600 by default). They are named "Autosave" with the time, marked as automatic in the
  list, and pruned apart from the ones members save (20 of them; a member's are never pushed out by the server's).
- **Take audio is served in ranges** (`Range`, `If-Range`, 206, 416) with an `ETag`. A take that can no longer change
  is cached by the browser for good (`private, immutable`); one still being received is checked each time.
- **Files of takes that no track owns any more** (its row went while the file could not be removed) are removed
  after a day, hourly.

### DAWproject

- **Clip gain is exported.** The format has no place for it, so a clip's audio is written at its level (a file per
  level). Where that would clip the file, the audio is written as it is and the track's comment says what the gain
  was and where.
- **The devices Parley exports are imported**: the equaliser, the compressor and the limiter come back as effects of
  their track or the master with their settings. Of an equaliser with several bands of a kind the first of each is
  read.
- **Solo is not written**, and nothing comes in soloed.

## 2. Acceptance criteria

| Criterion (plan) | Result | Where |
|---|---|---|
| Two users adding notes to the same clip, or points to the same lane, at the same time both keep their additions | One member offline adds a note, a point, an effect and a marker while the other, online, adds the same kinds to the same clip, curve, track and project. After the first reconnects all are there on the server (3 notes, 2 points in order, 2 effects, 2 markers) and both pages show the same project. A change to one effect leaves the other member's change to another; a note removed by one is not brought back by the other adding one | `studiocollab`, "two people, the same lists"; `cargo test` (merge of notes, points, effects, markers); `dawops.test.ts` (`itemize`) |
| Undo after another user changed the same field does not overwrite their change and says so | Undo of a fader the other member has moved since: theirs is kept, the message is shown, nothing is sent. Undo of an edit of two fields of which they changed one: the other is taken back, theirs kept, the message says "part". Undo of a move of a clip they deleted: it stays deleted on the server and on both pages | `studiocollab`, "undo next to someone else"; `dawops.test.ts` (`settle`) |
| One user's solo does not change what another hears or what is exported | A solo is in no shared lane (server and the other page), and the server stores none it is sent. Rendered on the soloing member's page: what they hear is one of two equal tracks, the exported mix has both (energy ratio 2 within 0.05); the other member's render equals the full mix within 2%. The solo is still on after a reload. DAWproject has no `solo="true"` with a track soloed | `studiocollab`, "solo is mine"; `dawproject` |
| A protected track rejects edits from other artists on the server | Its owner protects it in the editor; everyone sees the lock. Another artist's changes to the track, its clip, a new clip on it, its effects, its automation, its protection and its deletion are each refused with 403; in the editor the edit is not made and they are told. The engineer and the owner still change it; other tracks stay open | `studiocollab`, "a protected track" |
| A take can be recorded by a band member who is connected to a different backend instance from the engineer | **At the API, not by a browser on the second instance.** With a take started on one instance and no one in a call, the artist registers a track for their armed lane on the other instance (201); the listener is refused there (403), and an artist recording onto someone else's lane is refused. Both browsers in the recording checks were connected to the first instance | `studiocollab`, "recording with no call" |
| A listener can open the project, follow shared playback and comment, and cannot edit | The listener's page shows the editor with the read-only line and no record button; an edit is not made and they are told; the server refuses the edit and a transport command (403); they see an edit by the band arrive, their comment is stored, and their page follows the shared play and stop | `studiocollab`, "the listener" |

Also measured:

| | Result | Where |
|---|---|---|
| Recording with no call (Chromium) | A take the engineer starts, with no one in a call, records the artist's armed track: the file is whole against the tone that was fed in, 24-bit at 48 kHz, and is a clip on the artist's lane. The artist whose track is not armed and the listener record nothing. An artist records a take alone with no call | `studiocollab` |
| Who the server lets start and record | The listener cannot start a take or record into one; an artist cannot record onto another's lane nor onto their own while it is not armed | `studiocollab` |
| A deleted clip against an offline move of it | Stays deleted, for both; a marker deleted is not brought back by a rename of it | `studiocollab` |
| A batch sent twice | Applied once: one version, `repeat: true` the second time | `studiocollab` |
| Ranges | The whole file with `Accept-Ranges` and a tag; a range and a suffix range are those bytes (206); past the end is 416; a copy still good is 304 | `studiocollab`; `cargo test` |
| DAWproject | A clip at half level has its audio written at half level (peak ratio 0.5 within 0.01); a level that would clip is left out and the track says so; EQ, compressor and master limiter come back set as they were; nothing comes in soloed | `dawproject` (28 checks) |
| When an automatic version is due | Not for an untouched project; when none was saved; not at 599 s, at 600 s | `cargo test` |

Unit tests: `npm test` (82, were 57), `cargo test` (95, were 87). Gates: `npx tsc -b`, `npx oxlint src` (warnings
only, none new), `npm run build`, `node scripts/i18n-keys.mjs`.

Suites on Chromium: `studiocollab` (56), `dawproject`, `dawedit`, `dawengine`, `dawdrag`, `studio`, `studioaudio`,
`studioconsole`, `studiodaw`, `studiodaw2`, `studiolive`, `studioprojects`, `studiorender`, `studiotakes`,
`studiorecord`, `studiosync`, `calle2ee`, `unreadwhere` pass. `dawengine` and `hifi` each failed once and passed
when run again (section 3). `uilayout` fails (section 3).

On WebKit: `studiocollab` (46: the recording checks need a microphone and are left out), `dawproject`, `dawedit`,
`dawengine`, `dawdrag`, `studiorender`, `studiosync` pass. `studio`, `studioconsole`, `studiodaw`, `studiodaw2`,
`studiolive`, `studioprojects`, `studiotakes` skip themselves on WebKit (they need a voice room and a microphone).

## 3. Found on the way

- **A member with the editor open and a track armed is recorded when a take starts**, and that now includes a page
  opened again while a take is still running: it punches in. `studiotakes` reopened a page during a live take and
  found the take "no longer kept on the device" for this reason; the suite now ends the take first. The only
  prompt is the browser's for the microphone (`parley-pods.24`).
- **A solo sent to the server by a suite no longer does anything**: `studiorender` set solo through the API; it now
  sets it in the page, where it lives.
- **An instrument note played while the project plays was 10% under the stopped one's energy once** on Chromium
  (the limit is 8%), in one run of three. Not explained (`parley-pods.26`).
- **`hifi` reported mono for a stereo call once**, in a run that followed the recording suites; alone it passes.
  Not looked into further; nothing in this phase touches a call's audio path.
- **`uilayout` fails at the studio's pre-join splash**: someone who edits or manages projects gets the editor in
  place of the splash while the console is open, which is its default. The condition is older than this phase and
  was not changed by it; the suite was not run at the earlier commit to confirm that it failed there too
  (`parley-pods.28`).

## 4. Behaviour that differs from before

- **Solo is no longer shared.** Soloing a track changes what this member hears on this device and nothing else.
  Solos that were stored are cleared by the migration. Exports never follow a solo.
- **Recording does not need the voice room.** A band member with the project open and a track of theirs armed is
  recorded when an engineer starts a take, whether or not either is in a call. With no track of their own yet, a
  member outside a call is recorded only in a take they started themselves.
- **Starting a take from outside the room no longer joins the room.**
- **Whoever can see a project sees its editor**, read-only, where they used to see the room alone. They join the
  call from the button in the header.
- **Undo can do less than it did**: it does not take back what someone else has changed since, and says so.
- **Versions appear in the list that no one saved**, marked as automatic.
- **A track can refuse an edit** from a band member who is not its owner or an engineer.
- **DAWproject export writes more audio files** when clips have gains (one per level).

## 5. Not built, not verified, and known limits

- **No version is saved when a session ends.** The plan asked for one then and at an interval; the interval is
  built, and only checked when an edit arrives (`parley-pods.21`). That a version is saved after the interval was
  not run end to end (the test stack's interval is fixed when it starts): the rule is unit-tested, the saving is
  not.
- **No peaks cache** (`parley-pods.22`). Waveforms are still drawn from the decoded audio in the browser.
- **The take limit is as it was**: 30 minutes, not raised and not by duration (`parley-pods.23`).
- **Recording across instances was checked at the API only.** No browser recorded while connected to the second
  instance, so a take's events crossing instances to a recording page were not observed in this phase
  (`studiosync` covers project events across instances).
- **Recording with no call was run on Chromium only**, with a synthetic input. WebKit's headless build has no
  microphone here.
- **No notice before a microphone opens for a take someone else started** outside a call, beyond the browser's own
  permission (`parley-pods.24`).
- **Tracks of armed owners who are not there show as recording** during a take: the take counts their owners in
  without knowing whether they have the project open (`parley-pods.27`).
- **The input level of an armed track is shown in a call only.** Outside one the input is not opened before a take,
  so there is no level to show.
- **Conflict rules are by field and by item, not by intent.** Two members moving the same note, or the same fader,
  at once: the later one is kept. An undo that finds part of its edit changed takes back the rest, which can leave
  a state neither member made.
- **Solos do not follow a member to another device or browser**, and are not in versions.
- **Protection is per track.** There is no protection of the master, of markers or of the tempo, and no lock on a
  clip.
- **Old pages.** The server answers and broadcasts an item edit as the clip, track or project it left, which a
  page loaded before this version reads as it always did; such a page still sends whole lists, with the old
  last-writer result for its own edits, and still shows and sends solo (which the server now drops). This was not
  run against an old build.
- **DAWproject**: devices other than the three written are not read; an equaliser's further bands of a kind are
  left out; a clip whose gain would clip its file comes back at unity with a comment. The round trip was run
  against Parley's own files only, not against files from other programs.
- **The orphan sweep was not run end to end** (it acts on files a day old); the rule that tells a take's file by its
  name is unit-tested.
- **Manual matrix (P1-17) not done** (`parley-pods.25`): nothing was tried on Firefox, on iOS or Android, or in the
  desktop shells; the suites run on headless Chromium and WebKit. The two-musician pass of Journey B from a
  written script was not done either.
- **Not deployed.** Migration `0161` has run on the test database only.
