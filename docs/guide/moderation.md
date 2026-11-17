---
title: Moderation and safety
section: Running a server
order: 130
summary: Keep your server friendly with AutoMod, timeouts, bans, reports, raid protection and the audit log.
covers:
  - frontend/src/components/modals/settings/SafetyTab.tsx
  - frontend/src/components/modals/settings/AutomodTab.tsx
  - frontend/src/components/modals/settings/AuditLogTab.tsx
  - frontend/src/components/modals/settings/BansTab.tsx
  - frontend/src/components/modals/settings/ReportsTab.tsx
  - frontend/src/components/modals/BanMember.tsx
  - frontend/src/components/modals/TimeoutMember.tsx
  - frontend/src/components/modals/ModView.tsx
  - frontend/src/components/modals/Report.tsx
  - frontend/src/components/AgeSafety.tsx
  - frontend/src/components/Captcha.tsx
---

## Dealing with someone

Right-click a person (or press and hold on a phone) for these options:

| Option | What happens |
|---|---|
| **Timeout** | They can read but can't post, react, or join voice for 60 seconds up to a week. **Remove Timeout** ends it early. |
| **Kick** | Removes them. They can come back with a new invite. |
| **Ban** | Removes them and stops them coming back. You can also delete their messages from the last few days, up to 7. |
| **Moderator View** | Their history in your server: warnings, timeouts and notes. You can **Warn** them, or **Quarantine** them while you look into something. |

Always add a reason. It's kept in the audit log, so the rest of the team knows what happened.

Unban people under **Server Settings → Bans**. Banned members can appeal, if the server allows it. Appeals wait there for you to accept or deny.

To clear a spam flood, type `/purge 50` to delete the last 50 messages, or `/purge 50 @someone` to delete only theirs (up to 100 at a time).

## AutoMod

**Server Settings → AutoMod** catches problems automatically, even when no moderator is around. Rules can:

- **Block words**: a list of words or phrases. Use `*` as a wildcard.
- **Block mention spam**: messages that ping too many people at once.
- **Block links**: links to any site except the ones you allow.
- **Filter nicknames** that break your rules.

For each rule, choose what happens:

- block the message, optionally with a message of your own to the sender
- send an alert to a moderators' channel
- time the person out

You can also exempt roles or channels, like a channel where your moderators discuss bad words. People who can manage the server are never filtered.

## Safety Setup

**Server Settings → Safety Setup** has the big switches:

- **Verification level**: what a newcomer needs before they can post. **Low** requires a verified email. **Medium** also requires a Parley account older than 5 minutes. **High** also requires 10 minutes in your server. Members with any role skip it.
- **Raid protection**: notices a sudden rush of new accounts and alerts your moderators.
- **Pause invites** and **Pause DMs between members**: emergency brakes during a raid.
- **Explicit image filter**: scans pictures posted in the server.
- **Two-factor authentication for moderators**: moderators must have 2FA turned on, so a stolen password can't be used against the server.
- **AI summaries**: turn the Summaries button on or off.

## Reports

When members **Report Message** or **Report User** and tick the box to tell this server's moderators too, the report lands under **Server Settings → Reports**. **Jump** to see it in context, then **Resolve** or **Dismiss** it.

## The audit log

**Audit Log** records who changed what: roles, channels, bans, kicks, timeouts, deleted messages and settings. Filter by person or by kind of action. It's the first place to look when something changes and nobody knows why.

## Reporting to Parley

Some things go beyond one server, like threats, illegal content or spam across many servers. Every report goes to the admins who run your Parley server. Ticking the box also sends it to that server's moderators.
