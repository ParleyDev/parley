---
title: Friends and direct messages
section: Talking
order: 60
summary: Add friends, chat one-on-one or in small groups, and handle message requests.
covers:
  - frontend/src/components/DmSidebar.tsx
  - frontend/src/components/DmProfilePanel.tsx
  - frontend/src/components/HomeView.tsx
  - frontend/src/components/RequestsView.tsx
  - frontend/src/components/UserContextMenu.tsx
  - frontend/src/components/GroupIcon.tsx
  - frontend/src/components/modals/NewDm.tsx
  - frontend/src/components/modals/GroupMembers.tsx
  - frontend/src/components/modals/LeaveGroups.tsx
---

Click **Direct Messages** at the top of the server list to see your friends and private conversations.

## Adding friends

1. Click **Friends**, then **Add Friend**.
2. Type their exact username. You can add a short note so they know who you are.
3. They'll see your request under **Pending** and can accept it.

You can also right-click anyone, or open their profile, and choose **Add Friend**.

The friends list has tabs for **Online**, **All**, **Pending** and **Blocked**. **Active Now** shows friends who are in a call or streaming. For each friend you can:

- **Message** or **Wave**
- **Notify When Online**, to get a heads-up when they come online
- **Remove Friend** or **Block**

On anyone's profile you can set a **friend nickname** and a **note**. Only you see them.

## Direct messages

Click a friend and **Message**, or use **+** beside *Direct Messages* to start a new conversation. The top bar of a DM has:

- **Start Voice Call** and **Start Video Call**. See [Voice and video](voice-and-video#calling-someone).
- **Pinned Messages**, **Search**, and the other person's profile on the right

Right-click a conversation to **Pin Conversation** (it stays at the top), mute it, or **Close DM**. Closing just hides it until there's a new message.

## Group DMs

A group DM is a small private chat for up to 10 people, with no server needed.

- Start one with **+** and **Create a group DM**, then pick friends.
- Add more people later with **Add Friends to Group** in the top bar, or share an invite link that lasts 24 hours.
- Anyone can rename the group or change its icon. The owner can remove people and hand over ownership.
- Calling a group rings everyone, so Parley checks with you first.

## Message requests

Messages from people who aren't your friends go to **Message Requests**, so strangers can't land straight in your DMs. For each request, choose **Accept**, **Ignore** or **Block**.

Messages that look like spam are kept separately under **Spam**. If one is fine, mark it **Not spam**.

Choose who can message you in **User Settings → Content & Social**. See [Settings](settings#content-and-social).

## Blocking

**Block** someone from their profile or by right-clicking them:

- They can't message you, and you can't message them.
- Their messages in shared servers collapse into *blocked message*. You can still click **Show** to read one.

To undo it, use **Unblock** in the **Blocked** tab of your friends list.

## When a message can't be delivered

If a message can't be delivered (say they only accept DMs from friends), it stays red in the chat with **Retry** and **Delete**. Parley's helper explains why.
