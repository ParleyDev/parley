---
title: Voice and video
section: Talking
order: 70
summary: Join voice channels, call friends, share your screen, run stages and keep calls private.
covers:
  - frontend/src/components/VoiceView.tsx
  - frontend/src/components/VoiceCard.tsx
  - frontend/src/components/VoiceConnected.tsx
  - frontend/src/components/CallStatus.tsx
  - frontend/src/components/CallControls.tsx
  - frontend/src/components/CallExtras.tsx
  - frontend/src/components/CallLock.tsx
  - frontend/src/components/Captions.tsx
  - frontend/src/components/VideoTile.tsx
  - frontend/src/components/MiniCall.tsx
  - frontend/src/components/PhoneStage.tsx
  - frontend/src/components/DmCall.tsx
  - frontend/src/components/IncomingCall.tsx
  - frontend/src/components/DeviceMenu.tsx
  - frontend/src/components/SoundboardPicker.tsx
  - frontend/src/components/Activities.tsx
  - frontend/src/components/EntranceSound.tsx
  - frontend/src/components/AudioStats.tsx
  - frontend/src/pages/Overlay.tsx
---

![A voice channel with cameras on and the call controls](shot:voice)

## Joining a voice channel

Click a voice channel (the 🔊 ones), then **Join Voice**. You'll see who's there. Their picture lights up green when they talk.

The **Voice Connected** card above your panel shows you're in. From it you can:

- check the connection quality
- turn **noise suppression** on or off
- disconnect

You can keep chatting in text channels while you're in voice. If you wander off, a small call window follows you; click **Back to the call** to return.

> Tip: The first time, Parley asks your browser for the microphone. If nobody can hear you, check **User Settings → Voice & Video** and try the **Mic Test**.

You can drag the small call window to any corner and resize it from the grip on its corner; Parley remembers both. Point at it for **Mute**, **Stop Watching** and **Disconnect**. It also shows while you share your screen, with what you're sharing and how many people are watching. To turn it off, switch off **Float the call in a corner while I look elsewhere** in **User Settings → Voice & Video**. The channel name on the **Voice Connected** card also takes you back to the call.

## The call controls

| Button | Does |
|---|---|
| **Mute** | Turns your microphone off. The arrow beside it picks your microphone, speakers and volumes. |
| **Camera** | Turns your camera on. The arrow lets you preview it and pick which camera. |
| **Share Your Screen** | Shows a window, a tab or your whole screen. |
| **Reaction** | Floats an emoji over the call. |
| **Captions** | Live subtitles of what people say, if the server has them. |
| **Activities** | **Watch Together** (YouTube in sync), games such as **Tic-Tac-Toe**, and apps. |
| **Soundboard** | Plays one of the server's short sounds to everyone. |
| **More** | Grid view, whether to show your own camera and people without video. |
| **Disconnect** | Leaves the call. |

Click someone's video to focus on it, and double-click for full screen. When someone shares their screen, click **Watch Stream** to see it, and zoom in to read small text.

**Deafen** (the headphones in your panel) mutes everything you hear, and your microphone with it.

Everyone's picture is sized to fit the window, so there is nothing to scroll. When there are more people than fit, Parley shows those that fit and a **+N** tile; click it to **Show everyone**. Full screen shows the whole call with its controls. They fade when you stop moving the mouse and return when you move it; press <kbd>Esc</kbd> to leave.

A control you can't use right now stays where it is, dimmed. Point at it to see why: you may not have permission in this channel, a moderator may have muted you, or the call may still be connecting. Point at **Mute** to see its keyboard shortcut.

The arrow beside **Share Your Screen** sets the **Screen share quality** and whether to **Share sound**. While you're sharing, it shows what is going out and lets you **Share Something Else** without stopping.

## Calling someone

In a DM or group DM, click **Start Voice Call** or **Start Video Call** in the top bar. The other person sees an incoming call with **Join** and **Decline**. If they miss it, they'll see that you called.

You can also bring a friend into a voice channel you're in: **Invite to Voice** sends them a message with **Join**.

You can answer from the keyboard: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> joins and <kbd>Esc</kbd> ignores. **Ignore** stops the ringing for you without telling the caller; **Decline** tells them. If you're already in the call on another device, the DM shows **Join on this device**.

## If a call drops

If your connection wobbles, the call shows **Reconnecting…** and Parley gets you back in by itself. If it can't after a few tries, you leave the call and a **Call connection failed** card appears above your panel. Click **Try again** to rejoin, or **Dismiss**.

Parley also tells you when something changes during a call:

- **No microphone**: your microphone was unplugged. If you have another one, Parley switches to it and says so. If not, connect one and Parley picks it up.
- **New audio device**: you plugged in a headset or microphone. Click **Switch** to use it, or **Don't suggest this device again**.
- **You were in a call**: Parley reloaded or restarted in the middle of a call. Click **Rejoin** to go back. Parley never rejoins by itself.
- **Couldn't join the call**: Parley couldn't open your microphone, and says why. Fix it and click **Try again**, or click **Join without a microphone** to listen.

> Tip: **Can't connect** on someone's picture means Parley can't reach them directly, usually because of a firewall. Ask whoever runs your Parley to set up a relay server.

## Stages

Stages are for talks, Q&As and shows:

- **Speakers** are on stage. Everyone else is in the **audience** and listens.
- In the audience, click **Raise Hand** to ask to speak.
- Moderators can **Invite to speak** and **Move to audience**.
- Live stages from public servers show up in **Discover → Stages**.

## Private calls

Calls in DMs can be **end-to-end encrypted**: only the people in the call can hear or see it, not even the server. Turn it on with the lock button in the DM's top bar.

To be sure nobody is listening in, compare the **Safety code** shown in the call out loud. If everyone sees the same code, the call is private. Captions and clips are off in encrypted calls.

In a small call Parley connects you directly to the others, which lets them see your IP address. To prevent that, turn on **Hide my IP address in calls** in **User Settings → Voice & Video**: your calls then go through your Parley's relay, if it has one.

## Sounding your best

In **User Settings → Voice & Video**:

- **Input Mode**:
  - **Voice Activity** sends when you talk.
  - **Push to Talk** sends only while you hold a key. Set the key with **Record Keybind**. In a browser it works only while Parley's tab is in front; the desktop app hears it anywhere.
- **Input Sensitivity** sets how loud you need to be. Leave it on automatic unless people hear your keyboard.
- **Noise Suppression**: **Enhanced** removes keyboards, fans and background chatter. It runs on your own device.
- **Echo Cancellation** and **Automatic Gain Control** help on laptops and with speakers.
- **Test Video** previews your camera. Screen share quality is here too.

## Clips

Turn on **User Settings → Clips** to keep the last 15 seconds to a minute of a call. Then press **Save Clip** (or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>) to save it when something great happens.

## In-game overlay

The desktop app can show who's talking on top of a full-screen game. Turn it on in **User Settings → Advanced**, and show or hide it with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>.
