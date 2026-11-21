---
title: Notifications and your inbox
section: Talking
order: 80
summary: Control what pings you, catch up on unreads, mentions, bookmarks and reminders.
covers:
  - frontend/src/components/NotifMenu.tsx
  - frontend/src/components/InboxButton.tsx
  - frontend/src/components/Toasts.tsx
  - frontend/src/components/modals/GuildNotifications.tsx
  - frontend/src/components/modals/settings/NotificationsTab.tsx
  - frontend/src/lib/notify.ts
---

## Unread messages

- A channel with new messages turns **bold**.
- A server with new messages gets a small dot.
- A red number means someone mentioned you or sent you a DM.

Inside a channel, a bar at the top shows how many new messages there are, and a **New** line marks where they start.

To clear unread marks:

- Press <kbd>Esc</kbd> to mark the channel read, or <kbd>Shift</kbd>+<kbd>Esc</kbd> for the whole server.
- Or right-click a channel, server or DM and choose **Mark As Read**.

To come back to something later, use **Mark Unread** on a message.

In a channel with new messages, click the bar to go to the first one, or **Mark As Read** to go to the newest message and clear the **New** line. <kbd>Shift</kbd>+<kbd>Page Up</kbd> goes to the oldest unread message.

## Choosing what notifies you

Right-click a server, category, channel or DM (or use the server menu) for two choices:

- **Mute**: for 15 minutes, 1 hour, 8 hours, 24 hours or **Until I turn it back on**. Muted places stop showing unread marks, but a direct mention of you still gets through.
- **Notification Settings**:
  - **All Messages**
  - **Only @mentions**
  - **Nothing**
  - **Use Server Default** (channels only)

For a whole server, open the server menu and choose **Notification Settings**. As well as the above, you can:

- ignore `@everyone`, `@here` and role mentions
- turn off highlights and new-event alerts
- choose whether your phone gets push notifications for that server
- set different rules for particular channels

> Tip: For a busy server, set the server to **Only @mentions**, then switch the one or two channels you really care about to **All Messages**.

## Your inbox

The inbox button at the top right (<kbd>Ctrl</kbd>+<kbd>I</kbd>) collects everything waiting for you:

| Tab | What's in it |
|---|---|
| **Unreads** | Channels with new messages. **Mark all read** clears them. |
| **Mentions** | Every time someone mentioned you, for the last 30 days. |
| **Bookmarks** | Messages you saved, which you can sort into folders. |
| **Reminders** | Messages you asked to be reminded about. |
| **Highlights** | Things that stood out in your servers over the last two days. |
| **Scheduled** | Messages you've scheduled. Send them now, edit or delete them. |

## Desktop, phone and email notifications

In **User Settings → Notifications**:

- **Enable Desktop Notifications** pops up a notice for new messages.
- **Push notifications on this browser** keeps them coming even when Parley's tab is closed. You can reply or mark them read from the notification.
- **Unread Message Badge** shows a count on the tab or app icon.
- **Notify me when someone replies to my message** treats replies like mentions.
- **Phones:** with the Parley app installed, your phone stays quiet while you're active on a computer. **Send a test notification to my phones** checks it's working.
- **Email notifications** send at most one email an hour, and only while you're offline.
- **Sounds:** choose which sounds play, and how loud.

Event reminders arrive 10 minutes before events you marked **Interested**.
