---
title: Channels, threads and forums
section: Talking
order: 40
summary: The kinds of channel, threads for side conversations, forums, communities and events.
covers:
  - frontend/src/components/ChatView.tsx
  - frontend/src/components/ChatPane.tsx
  - frontend/src/components/ForumView.tsx
  - frontend/src/components/ThreadPanel.tsx
  - frontend/src/components/CommunityPage.tsx
  - frontend/src/components/CommunityBanner.tsx
  - frontend/src/components/HeaderBits.tsx
  - frontend/src/components/modals/CreateChannel.tsx
  - frontend/src/components/modals/CreateThread.tsx
  - frontend/src/components/modals/NewPost.tsx
  - frontend/src/components/modals/BrowseChannels.tsx
  - frontend/src/components/modals/BrowseCommunities.tsx
  - frontend/src/components/modals/FollowChannel.tsx
  - frontend/src/components/modals/Events.tsx
  - frontend/src/components/AgeSafety.tsx
  - frontend/src/components/AgeChecks.tsx
---

Every server is split into **channels**, each for one topic or activity. Channels are grouped under collapsible **categories**.

## Kinds of channel

| Icon | Kind | What it's for |
|---|---|---|
| `#` | **Text** | The everyday chat: messages, pictures, GIFs, links. |
| 📢 | **Announcement** | Important news. Other servers can **Follow** it to get the posts in a channel of their own. |
| 🔊 | **Voice** | Drop in and talk, with video and screen sharing. Each one has its own text chat too. |
| 🎙 | **Stage** | Talks and events: a few speakers, everyone else listens and can raise a hand. |
| 💬 | **Forum** | Organised posts with titles and tags instead of one running chat. |
| 🖼 | **Media** | A forum where every post leads with a picture or video, shown as a gallery. |
| 📚 | **Directory** | A list of other servers members can browse and join. |
| 🎚 | **Recording Studio** | Make music together. See [Studio](studio). |

A small lock on a channel means it's **private**: only some roles or people can see it.

Some channels show a notice before you go in:

- **Age-restricted** channels are only for people confirmed as 18 or older. If you are confirmed, you get a warning once and then go in. If you are not, the channel shows a lock with the ways to be confirmed. See [Your age](settings#your-age).
- **Spoiler** channels keep pictures and videos hidden until you click them.
- **Slowmode** channels let each person post only every so often. The message box tells you how long to wait.

## Choosing which channels you see

Big servers can be a lot. Open the server menu (click the server name) and choose **Browse Channels**. Tick the channels you want in your list and untick the rest. Servers may also offer roles you can pick yourself there.

Other tidy-ups:

- **Pin Channel** (right-click a channel) keeps it at the top of the list.
- **Hide Muted Channels** (server menu) takes muted channels out of the list.
- Right-click a category to collapse it, or all of them.

## Threads

A thread is a side conversation that branches off one message, so the main channel stays readable.

- **Start one** from a message's menu with **Create Thread**, or with the **Threads** button in the top bar. Give it a name and choose when it hides after going quiet (1 hour to 1 week).
- **Private Thread** keeps it to the people you add (and moderators).
- A thread shows as a card under its first message. Click **View Thread** to open it beside the chat.
- **Join** a thread to follow it and get its notifications. **Leave** it to stop.
- Whoever started a thread can close, archive or lock it. **Show archived** in the Threads list finds old ones.

## Forums

A forum channel is a list of posts, like a message board. Each post is its own thread.

- Click **New Post** and give it a title, a message, any tags, and files if you want.
- Switch between **List** and **Gallery**, sort by **Latest activity** or **Newest posts**, and filter by tag.
- **Search posts** finds posts by title.
- Read the **Post guidelines** if the forum has them. Some forums require a tag on every post.

## Announcement channels

Posts in an announcement channel can be **Published** from the message menu. That sends them to every channel following it, even in other servers.

To get a server's announcements in your own server, click **Follow** in the channel's top bar. Then pick your server and channel. You need permission to manage channels in your server.

## Communities

Very large servers can be organised into **communities**: groups of channels with their own page, header image and managers.

- **Browse Communities** in the channel list shows them all. Click **Follow** on the ones you care about.
- Following decides what shows in your channel list and what counts as unread. It doesn't change what you're allowed to see.
- Click a community's name to open its page: what it's about, links, channels and who runs it.

> Admins: Community managers edit the page with **Edit**: the header image, icon, description and links. The header has its own layout editor (**Adjust**) with Fill or Fit, alignment and zoom. It previews on a phone, a laptop and a wide screen, because the header stretches the width of the window.

## Events

The **Events** row above the channels lists the server's upcoming events. Live ones say **Happening now**. Click **Interested** to RSVP, and Parley reminds you 10 minutes before the start.
