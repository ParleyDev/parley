# Abuse and bans

Servers moderate themselves: AutoMod, raid protection, verification levels, timeouts, kicks and bans all belong to
a server's own moderators. This page is about what the instance does across every server and direct message,
which only its staff can do.

## Acting on an account

Open the account under **Admin Console → Users**. The **Bans & limits** card takes a reason, an action, a length
and a note (kept with the action and in the audit log). Staff who can act on content (moderators and
trust-and-safety leads) can use it.

| Action | What it does |
|---|---|
| **Limited (soft ban)** | The account carries on where it already is: its servers, its friends, the conversations it has. It cannot start anything new: no first message to someone it is not friends with, no friend requests, no joining or creating servers, no new invites. Its **My Account** page says so and until when. |
| **Silenced** | For a confirmed spammer. Its first messages to people who have not accepted it, and its friend requests, look sent to it and reach nobody. It is not told. People who already accepted it still hear from it. |
| **Suspended** | It cannot sign in, and every session ends. With a number of days it is a temporary ban that ends by itself. |
| **Hard ban** (a tick on a suspension) | Also remembers the account's email address and the network addresses it used in the last 30 days, as keyed hashes. That email address cannot register again, including the same mailbox written another way (dots and `+tags` on the big providers). A new account from one of those networks registers normally and is put in front of you as a possible return. Networks are shared, so a match never blocks by itself. |

Everything is reversible: **Lift** on the account, or under **Admin Console → Bans & Limits → In force now**.
Lifting a hard ban frees the email address.

### Someone who says they are under 13

Parley does not ask ages at sign-up, so this is handled when it comes up. If someone says, in text or in voice,
even as a joke, that they are under 13, choose the reason **Says they are under 13**. The account is suspended with
no end date, and signing in tells its owner why and to contact you. It is lifted only by a member of staff, with a
note of what showed the account holder is 13 or older.

Check what the law where you operate asks of you about children's accounts before relying on this alone.

## What Parley notices by itself

**Admin Console → Bans & Limits → Waiting for review** lists what it noticed:

| Noticed | When |
|---|---|
| The same message sent to many places | The same text (ignoring case, spacing and numbers) in 5 or more channels or conversations within 10 minutes. |
| Links from a new account to many places | An account under 7 days old posting links in 4 or more places within 10 minutes. |
| Mass mentions | An account under 30 days old mentioning 30 or more people or roles within a minute. |
| A new account messaging many people | An account under 7 days old opening 20 or more new conversations within 10 minutes. |
| A new account sending many friend requests | An account under 7 days old sending 15 or more within 10 minutes. |
| Reported by several people | 5 or more different people reporting one account within a day. |
| Signed up from the network of a banned account | See hard bans above. |

For the first five, Parley also **limits the account for three days**, and says so in the queue. **Keep it** if it
was right, **Undo the action** if it was not. It never silences or suspends by itself, and it never acts on
several reports or a network match: those are only listed. Staff, bots and guests are not watched.

Turn **Limit accounts automatically** off and everything is only listed.

Only counts and digests of text are kept for this, for a day.

## Rate limits on starting things

Per account: 30 friend requests an hour, 30 new conversations in 10 minutes, 30 invites created and 30 accepted an
hour, 60 reactions in 30 seconds, 20 forwards a minute, 10 threads or forum posts a minute. These sit beside the
existing limits on messages, uploads, sign-ups and reports.

An assistant connection (MCP) acts as its member and goes through the same checks and limits. One request may
carry at most 25 calls, and a connection is held to 240 calls a minute.

## Blocked links and threat feeds

**Admin Console → Blocked Links** is the list of domains that cannot be linked to: a message with such a link is
refused, and the site gets no link preview.

Add domains by hand, or add a **threat feed**: the address of a plain-text list of malicious domains that someone
else keeps up to date. Parley fetches each feed every 6 hours.

- Accepted lines: a bare domain, a hosts-file line (`0.0.0.0 bad.example`), or an address with no path.
- A line that names one page of a site is skipped. Blocking a whole site because one page on it was bad would
  block shared hosts wholesale, so feeds of page addresses contribute little.
- A short list of sites everybody shares (large code hosts, cloud drives, social networks) is never blocked,
  whatever a feed says.
- A feed never removes or overrides a domain you added yourself.
- If a feed cannot be fetched, what it listed last time stays blocked.

The suggested feed is URLhaus from abuse.ch. Check a feed's terms of use before adding it.

## Pausing a server's invites

`POST /api/admin/servers/<id>/invites-paused` with `{ "paused": true }` stops new members joining a server that is
being used to gather people, without taking it down. The server's own **Pause invites** switch does the same.
