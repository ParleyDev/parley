---
title: Studio
section: Making music
order: 150
summary: Record, arrange and mix songs together in a Recording Studio channel, live or in your own time.
covers:
  - frontend/src/components/StudioView.tsx
  - frontend/src/components/StudioConsole.tsx
  - frontend/src/components/ProjectSession.tsx
  - frontend/src/components/Daw*.tsx
  - frontend/src/lib/daw.ts
  - frontend/src/lib/studio.ts
---

A **Recording Studio** channel is a music workspace inside your server. Each **project** is a song, with its own multitrack editor, takes, comments, versions and chat. Band members can record together live, or add parts whenever they have time.

![A project open in the studio](shot:studio)

## Starting a project

Open a Recording Studio channel and click **New Project**. Give it a name and a tempo. You need the **Create Projects** permission.

Already started a song somewhere else? **Import** opens `.dawproject` files from Bitwig, Studio One, Cubase and others, as well as Parley's own `.parley-project` files.

## Recording

1. Set up your audio in the **Audio** panel: your output, and **Recording latency**. Click **Measure** so your takes line up with the beat.
2. Add a track: **audio** for a microphone or instrument, or **MIDI** with a built-in synth, drum kit or sampler.
3. Arm the track and press record. **Record the band** records everyone in the session from the playhead; **Record alone** records just you. A take can be up to 30 minutes.

No MIDI keyboard? Play notes with your computer keys: <kbd>A</kbd> to <kbd>K</kbd> are the white notes, and <kbd>Z</kbd> and <kbd>X</kbd> change octave.

## Arranging and editing

| Keys | Does |
|---|---|
| <kbd>Space</kbd> | Play or stop |
| <kbd>Home</kbd> | Back to the start |
| <kbd>L</kbd> | Loop on or off |
| <kbd>S</kbd> | Split the clip at the playhead |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Duplicate |
| <kbd>Q</kbd> | Quantise (snap notes to the grid) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo / redo |
| <kbd>Tab</kbd> | Switch between the arrangement and the mixer |

Double-click a MIDI clip to open the **piano roll**. There are also a metronome and count-in, markers, tempo changes, and automation lanes for volume and effects.

In the **mixer**, every track has volume, pan, solo, mute, effects and sends.

## Effects

Each track, bus and the master has an effects rack: EQ, filter, compressor, gate, limiter, reverb, delay, drive and chorus. Click **+ Effect** to add one. Effects play top to bottom; hover one to move it or remove it.

Click an effect to open its window. You can open as many windows as you like and drag them anywhere; click a window to bring it to the front. Each window shows what the effect does:

- **EQ** and **filter**: the frequency curve over the sound's spectrum. Drag the dots on the curve to shape it. On the filter, drag up or down for more or less resonance, or use the mouse wheel.
- **Compressor**, **gate** and **limiter**: how loud goes in versus how loud comes out, a dot showing where your sound is now, the last few seconds of level, and how much is being turned down.
- **Reverb**: the shape of the tail. **Delay**: each echo fading away. **Drive**: the distortion curve, with the sound before and after. **Chorus**: the sweep.

While the song plays, the views and the **In** and **Out** meters move with the sound.

To change a setting:

- Drag a knob up or down. Hold <kbd>Shift</kbd> for fine control.
- Use the mouse wheel or the arrow keys.
- Type a value under the knob, such as `2.5k` or `25%`.
- Double-click a knob to put it back to its default.

The power button in the window's title bar turns the effect off and on. The arrow resets all its settings.

## Working as a band

- **Band**: everyone is an **Engineer** (can change anything) or an **Artist** (records their own parts). **Protect this track** stops others editing your part.
- **Sessions**: an engineer clicks **Start session** to work live together. Everyone hears what anyone plays.
- **Takes**: every recording is kept. Pick the best one with **Use take**.
- **Comments**: leave notes at a point in the song, like "drums drag here", and **Resolve** them when done.
- **Versions**: **Save version** before big changes, and **Restore** if you don't like where it went.

Listeners who aren't in the band can still play the song, follow along and comment.

Lost your connection? Keep working. Your changes are saved and sent when you're back online.

## Sharing the result

The **Export** panel can:

- export the mix as WAV, FLAC or MP3
- export **stems** (each track separately, zipped)
- **Post the mix to a channel** for everyone to hear
- save the project as `.dawproject` to open in another music app
