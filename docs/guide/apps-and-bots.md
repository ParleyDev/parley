---
title: Apps, bots and AI assistants
section: Running a server
order: 140
summary: Add bots to your server, use their commands, and connect an AI assistant to your account.
covers:
  - frontend/src/pages/AppDirectory.tsx
  - frontend/src/pages/OAuth.tsx
  - frontend/src/pages/McpAuthorize.tsx
  - frontend/src/components/modals/AppModal.tsx
  - frontend/src/components/modals/Application.tsx
  - frontend/src/components/modals/Activity.tsx
  - frontend/src/components/modals/settings/AuthorizedAppsTab.tsx
  - frontend/src/components/modals/settings/IntegrationsTab.tsx
  - frontend/src/components/modals/settings/ApplicationsTab.tsx
---

**Apps** add features to Parley. A **bot** is an app that joins a server like a member: it can welcome people, run games, play music or post updates.

## Finding apps

Open the **App Directory** from Discover (**Browse the App Directory**) or from **User Settings → Authorized Apps**. Search or browse by category. A **Verified** badge means Parley has checked who made it.

## Adding a bot to your server

1. Click **Add to Server** on the app, or open the invite link its maker gives you.
2. Pick a server where you have **Manage Server** permission. A link made for one server has it picked already.
3. Check the permissions it asks for. Untick any it doesn't need.
4. Click **Authorise**.

Then click **Go to the server**. If you started on the app's own website, Parley takes you back there instead.

The bot gets a role of its own. You can change its permissions in **Server Settings → Roles**. To remove a bot, use **Server Settings → Integrations**, or kick it like any member.

## Apps just for you

Some apps can be added to your own account with **Add to My Apps**. Then you can use them anywhere: in any server or DM. They also show up under **Apps** when you right-click a message or a person.

## Using commands

Type `/` at the start of the message box. Parley's own commands come first, then the commands of every app you can use there. Pick one, fill in its options, and press <kbd>Enter</kbd>. Some apps open a form or reply only to you.

## AI assistants

You can let an AI assistant, such as Claude, ChatGPT or Cursor, read and send messages for you. Ask it things like "what did I miss?" or "reply to Sam that I'm running late".

1. Open **User Settings → Authorized Apps** and copy the address under **AI assistants (MCP)**.
2. In your assistant, add it as a custom connector (it may be called a *remote MCP server*).
3. Parley opens a page asking what the assistant may do: **Read**, **Notifications**, **Send messages** or **Manage servers**. Pick only what you need, then approve.

> Heads up: Anything the assistant sends appears under your name. With **Manage servers** it could delete messages or remove people, so only allow that if you really mean to.

To stop it, click **Disconnect** next to the assistant in **Authorized Apps**.

## Tools for admins

Some tools that work on your instance, such as Profile Studio for making profile cosmetics, sign in the same way. When you sign in from the tool, Parley opens a page asking to let it **Manage cosmetics**: add cosmetics to the instance and change existing ones. It only works if your account can manage the instance, and the tool never sees your password.

> Heads up: Anything it adds or changes shows for everyone at once. Only allow tools you trust.

To stop it, click **Disconnect** next to the tool in **Authorized Apps**.

## Making your own

Want to build a bot? Create an app in **User Settings → Applications**, and read [the developer docs](https://app.runparley.com/developers).
