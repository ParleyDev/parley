# Age checks

Parley does not ask anyone for a date of birth. It treats every account as a possible minor until something says
otherwise: age-restricted channels and adults-only servers stay closed to it, and messages from people it has not
added arrive as requests with pictures, files and link previews hidden. This page is about the "something says
otherwise" part, which is yours to set up.

It is guidance, not legal advice. Whether a method here meets a law that applies to you (for example a rule that
demands a particular standard of age assurance before showing adult content) is something to check with whoever
advises you. Staff confirmation in particular is only as good as your own check.

## What counts as confirmed

**Admin Console → Age Checks → What counts as confirmed** sets the weakest proof that opens restricted places:

| Setting | Who gets in |
|---|---|
| The member saying so | Anyone who clicks "I am 18 or older". This is how Parley worked before age checks. It is not proof. |
| Staff confirmation | People a member of your staff confirmed, and people a verification service confirmed. |
| A verification service only | Only people the service below confirmed. |

An instance that already had members when it was upgraded starts on the first setting, so nobody was locked out by
the upgrade. A new instance starts on **Staff confirmation**. Raise it when you are ready; records that no longer
count stay on file and count again if you lower it.

A member who says they are **under 18** is never let in, whatever else is on record, until a member of staff
removes that mark (with a reason, kept in the audit log).

## Staff confirmation

For an instance with no verification service. A member asks from **User Settings → My Account → Age**, or from the
lock on a restricted channel. The request appears under **Admin Console → Age Checks**. A trust-and-safety lead or
super admin confirms it with a note of how they checked ("known in person", "video call"), or declines it. To
confirm someone who has not asked, or to withdraw a confirmation, open their account under **Users**.

- No document and no date is stored. The record is who confirmed, when, the note, and an optional end date.
- Do not ask for identity documents to be sent through Parley.
- An administrator may confirm their own account. It is marked as such in the audit log.
- Turn **Staff may confirm ages** off to leave only a verification service. With that off and no service, restricted
  places are closed to everyone.

## A verification service

Optional. A service that checks a person's age and tells Parley only whether they meet it. Parley supports two
ways to connect one, and neither needs a paid vendor.

A check is started by the member, is tied to their account and to the age asked for, can be used once, and lapses
after 15 minutes. One result at the service confirms one Parley account: the service's own id for the person is
kept only as a hash, to refuse a second account using the same result. A service that is down confirms nobody;
restricted places are never opened as a fallback.

### OpenID Connect

For a service that signs people in with OpenID Connect and can state an "over 18" claim.

| Field | What to enter |
|---|---|
| Issuer | The `iss` the service puts in its tokens. |
| Sign-in address | Its authorization endpoint. |
| Token address | Its token endpoint. |
| Client ID, Client secret | From registering Parley with the service. |
| Claim that must be true | The name of the boolean claim. `{n}` is replaced by the age: the default `age_over_{n}` asks for `age_over_18`. |
| Scope | Defaults to `openid`. Add what the service needs to release the claim. |

Register this redirect address with the service: `https://<your Parley address>/api/age/callback`.

Parley sends the member to the sign-in address with a one-time `state` and `nonce`, exchanges the returned code at
the token address, and accepts the ID token only if its issuer, audience (your client ID), nonce and expiry are
right and the claim is `true`.

### An adapter you run

For a service with its own API. You run a small web service between it and Parley.

When a member starts a check, Parley calls your adapter:

```
POST <adapter address>
Authorization: Bearer <shared token>
Content-Type: application/json

{ "transaction": "<id>", "threshold": 18, "return_url": "https://<your Parley address>/?age=back" }
```

The adapter answers `200` with where to send the member:

```json
{ "url": "https://verify.example/start/abc" }
```

When the service has an answer, the adapter reports it to Parley:

```
POST https://<your Parley address>/api/age/adapter/callback
Authorization: Bearer <shared token>
Content-Type: application/json

{ "transaction": "<the same id>", "met": true, "reference": "<your service's id for this result>", "expires_at": "2027-11-21T00:00:00Z" }
```

`reference` is required when `met` is true. `expires_at` is optional; without it, **A confirmation lasts** applies.
The adapter must not keep or log what the service showed it about the person.

## Restricting a channel or a server

- A channel or a category: **Edit Channel → Age-Restricted**. A category passes it to its channels, and a thread
  follows its channel.
- A whole server: **Server Settings → Safety Setup → Everything in this server is 18+**. New members must be
  confirmed before they can join.

Nothing in the permission system gets round it: an owner or an administrator who is not confirmed sees the channel
locked too, and cannot turn the restriction off.

For an account that is not confirmed, a restricted channel is still in the channel list, with a lock. Nothing else
reaches it: not messages, pins, search results, live events, notifications, thread or forum previews, voice, or
files. A file in a restricted channel is served only to a signed-in session that meets the age, so a copied link
to it does not work for anyone else.

## What is kept

One row per confirmation: the account, the age, how strong the proof is, who or what gave it, when, and when it
ends or was withdrawn. An existing date of birth was converted on upgrade (to "said they are under 18" or to a
self-declared record) and its year was discarded; the day and month are kept as an optional birthday that only the
member sees. Backups taken before the upgrade still hold the old dates until they rotate out.
