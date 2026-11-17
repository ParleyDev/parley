---
title: Joining and creating servers
section: Getting started
order: 30
summary: Join with an invite, find communities in Discover, or start a server of your own.
covers:
  - frontend/src/pages/Invite.tsx
  - frontend/src/components/InviteLanding.tsx
  - frontend/src/components/InviteCard.tsx
  - frontend/src/components/DirectoryView.tsx
  - frontend/src/pages/Discover.tsx
  - frontend/src/pages/GuildPreview.tsx
  - frontend/src/pages/Template.tsx
  - frontend/src/components/modals/JoinGuild.tsx
  - frontend/src/components/modals/CreateGuild.tsx
  - frontend/src/lib/templates.ts
  - frontend/src/components/modals/Onboarding.tsx
  - frontend/src/components/modals/Welcome.tsx
  - frontend/src/components/modals/Rules.tsx
---

A **server** is a community's home: its channels, its members and their roles. You can be in as many as you like.

## Joining with an invite

Someone sends you an invite link, such as `app.runparley.com/invite/parley`. Open it to see the server's name, icon and how many people are there, then click **Accept Invite**.

- **No account yet?** The invite page signs you up first, then brings you straight in. Some servers let you read a preview before you join.
- **Invite pasted in a chat?** It shows as a card with a **Join** button.
- **Got just the code?** Click **Add a Server** (+) in the server list, then **Join a Server**, and paste the link or code.

If an invite doesn't work, it may have expired or been used up, or the server may have paused new members for now. Ask for a new one.

## Finding servers in Discover

Click the compass at the bottom of the server list:

- **Home** shows featured servers and lets you browse by category.
- **Servers** lets you search everything that's listed publicly.
- **Stages** shows live stage events you can drop in on and listen to.

Click a server to look around in preview mode. You can read its public channels before you commit. When you're ready, click **Join** in the bar at the top.

Some servers have a **directory channel** listing other servers you can join, such as a school's club servers.

## Your first minutes in a server

Servers can ask a few things of new members:

- **Onboarding questions.** Pick what you're interested in, and the server shows you the right channels and gives you matching roles. You can usually skip.
- **A welcome screen** suggesting where to start.
- **Rules to accept.** Until you click **I agree**, a bar above the message box offers **View rules**.
- **Safety checks.** Some servers want a verified email, or ask newcomers to wait a few minutes before posting. The message box says what's needed.

## Creating your own server

1. Click **Add a Server** (+) at the bottom of the server list.
2. Choose how to start:
   - **Create My Own**: an empty server.
   - **Use a Template**: copy the setup of an existing server, from Parley or Discord. See [Starting from a template](#starting-from-a-template).
   - **Start from a template**: Gaming, Friends, Study Group, School Club, Local Community or Artists & Creators. Each comes with sensible text and voice channels.
3. Give it a name and an icon, then click **Create**.

Now invite people. Click the server name, then **Invite People**. To set it up properly, see [Server settings](server-settings).

## Starting from a template

A **server template** copies a server's setup into a new server of your own: its roles, categories, channels, permissions and a few settings. Messages, members and emoji never come along.

Click **Add a Server** (+), then **Use a Template**, and give it any of these:

- **A Parley template link**, like `app.runparley.com/template/…`. It can be from this Parley server or from another one.
- **A template file** (`.json`): click **Choose a file**, or drop the file onto the dialog.
- **A Discord template link** (`discord.new/…`), or its code.

Parley shows what the template brings first: its channels and roles. Name your server, pick an icon and click **Create Server**.

> Tip: Moving a community from Discord? In Discord, open **Server Settings → Server Template**, click **Generate Template** and copy the link. Paste it here.

To share your own server's setup, see [Server templates](server-settings#server-templates).

## Leaving a server

Right-click the server and choose **Leave Server**. Your messages stay. You can come back with a new invite, unless you were banned.
