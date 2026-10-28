# Account deletion: soft delete, then anonymize (tombstone)

Status: implemented (migration `0129_account_deletion.sql`, `backend/src/routes/deletion.rs`).

Decisions: owned servers and apps block the request until they're transferred or deleted; only accounts deleted
while suspended or banned from a server keep a keyed email hash, for 90 days; moderation records stay as anonymous
records; admin "Delete user" anonymizes at once, and "Purge" is a separate hard delete.

## Today

- `DELETE /users/@me` (password + 2FA) and the admin "Delete user" both call `admin::delete_account`, which
  **hard-deletes the user row**. 85 foreign keys point at `users(id)`: 70 cascade and 15 set null. A delete
  therefore also erases the user's messages, reactions, attachments, owned servers, apps and bots, invites and
  so on.
- Some user IDs live in columns with no foreign key and survive a delete: `admin_audit` / `guild_audit`
  (`actor_id`, `target_id`), `guild_member_log.user_id`, `guild_members.inviter_id`, `reports.resolved_by`,
  `channel_overwrites` / `notification_settings.target_id`.
- Copies of names live outside `users`: `admin_audit` / `guild_audit.actor_name` / `target_name`,
  `reports.target_username`, `guild_members.nickname`, `user_notes.nickname`,
  `user_role_connections.platform_username`.
- `POST /users/@me/disable` sets `disabled_at`. A disabled account can't sign in until it's restored.

**Auth.** Login creates a `sessions` row (with `ip` and `user_agent`) and a 30-day JWT carrying `sid`. Every
request checks the session row (cached briefly in the hub), and the check rejects `revoked_at`,
`suspended_at` and `disabled_at`. Other credentials: `oauth_tokens` / `oauth_codes`, `mcp_grants` /
`mcp_codes`, `passkeys`, `mfa_backup_codes`, `qr_logins` (`ip`, `device`), `email_tokens`.

**Push.** `push_tokens` (mobile) and `web_push_subs` (browsers).

**Files.** Avatars, banners, emoji and stickers live in `images` (`owner_id`), stored at `UPLOAD_DIR/<id>`.
Message attachments live in `attachments` (`uploader_id`). `users.avatar_history` lists old avatar URLs.
`data_exports` holds zip files of the user's own data.

**Background work.** There's no job queue. Long-running `tokio::spawn` loops in `main.rs` (orphan sweeps,
status expiry, thread auto-archive and others) run on **both** backend replicas, so any job must be safe to
run concurrently.

**Purchases.** Parley has no payments, purchases, receipts or entitlement tables. Cosmetics are free picks
stored on the user row (frame, effect, nameplate, decoration, house). Badges are computed, not owned.

## Data model

Migration:

```sql
ALTER TABLE users
  ADD COLUMN account_state TEXT NOT NULL DEFAULT 'active'
    CHECK (account_state IN ('active', 'pending_deletion', 'deleted')),
  ADD COLUMN deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN deletion_scheduled_for TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ALTER COLUMN email DROP NOT NULL,          -- unique index allows many NULLs
  ALTER COLUMN password_hash DROP NOT NULL;
CREATE INDEX users_deletion_due ON users (deletion_scheduled_for) WHERE account_state = 'pending_deletion';
```

- **Grace period:** `ACCOUNT_DELETION_GRACE_DAYS` (environment), default 14, between 0 and 365.
- **Placeholder username:** `deleted_user_` followed by 12 random characters from `[a-z0-9]`, from the
  OS random generator (not derived from the ID, email or old name). It's retried if it collides.
- **`deletion_email_blocks`:** `(email_hash, expires_at)`, an HMAC-SHA256 of the lower-cased email keyed by the
  server secret. It's written only for the ban-evasion case and checked at sign-up and email change.
- **Reserved prefix:** registration and username changes refuse names starting with `deleted_user_`.
- **Display name:** always "Deleted User".
- **No mapping:** nothing records the old identity.

## Flow

**1. Request.** Settings › Account › Account Removal › Delete Account, or the web page below.
- The user re-authenticates with their password and, if 2FA is on, a code (`check_password_and_factor`).
- A confirmation screen lists what happens and the date it becomes final. Then
  `POST /users/@me/deletion` runs, in one transaction:
  - sets `account_state = 'pending_deletion'`, `deletion_requested_at = now()` and
    `deletion_scheduled_for = now() + grace`;
  - revokes every session (`revoked_at = now()`, and the hub's session cache drops them); deletes
    `oauth_tokens`, `oauth_codes`, `mcp_grants`, `mcp_codes`, `qr_logins`, `push_tokens` and
    `web_push_subs`;
  - evicts the user from voice and sends `SESSION_REVOKED` to every open client.
- **Hidden during the grace period:**
  - their profile endpoints answer as unavailable;
  - they show as offline, disappear from member lists, search, mention suggestions, Discover and
    friend lists;
  - others can't DM, friend or invite them;
  - their existing messages still show their name, because they may come back.
- Refused while they own a server or an app/bot (see the open questions).

**2. Grace period.**
- A correct password (and 2FA) for a pending account doesn't start a session. Login answers
  `403 {code: "pending_deletion", scheduled_for, restore_ticket}`. The ticket is short-lived and is only
  accepted by `POST /auth/restore`.
- The client shows: "Your account is scheduled for deletion on <date>. Restore it?" with **Restore** and
  **Keep it deleted**.
- Restore clears the three deletion fields, sets `active` and starts a normal session.
- Push tokens and connected apps don't come back: the user signs in to those again.

**3. Finalize: `deletion::finalize_due`.**
- A loop on every replica, every 10 minutes (and once at startup), takes due accounts with
  `SELECT id FROM users WHERE account_state = 'pending_deletion' AND deletion_scheduled_for <= now()
  ORDER BY 1 LIMIT 20 FOR UPDATE SKIP LOCKED`. Two replicas never take the same user.
- Each user is scrubbed in **one transaction** that ends with `account_state = 'deleted'`. If anything fails,
  nothing changes and the next run tries again.
- Files are removed after the commit, from a list gathered inside the transaction. A missing file counts as
  done. A crash between commit and unlink leaves orphans, which the existing `images::sweep_orphans` already
  removes.
- **Re-running:** a `deleted` account is never taken again, and calling `finalize(user)` directly on one does
  nothing. Tests cover both.
- After the commit: `USER_UPDATE` with the tombstone to everyone who shared a server or DM, plus
  `GUILD_MEMBER_REMOVE` for each server.
- An admin's "Delete user" deletes the servers and apps they own, then finalizes at once, with no grace period.
  `POST /admin/users/:id/purge` is the old hard delete, for spam, and is what the test suite's cleanup uses.
- `POST /admin/deletions/run` finalizes every due account immediately, for operators and tests.

## What gets scrubbed vs kept

**`users` row** (same primary key, so every foreign key stays valid):

| Kept | Scrubbed |
| --- | --- |
| `id`, `created_at` (not personal; needed for ordering) | `username` → placeholder; `display_name` → "Deleted User" |
| `account_state = 'deleted'`, `deleted_at` | `email`, `email_verified_at`, `password_hash` → NULL |
| `bot = false`, `webhook = false` | `totp_secret`, `totp_pending`, `totp_enabled_at`, `totp_last_step` → NULL |
| | `avatar_url`, `banner_url`, `avatar_history`, `bio`, `pronouns`, `custom_status`, `custom_activity`, `birthdate`, `house` → NULL or empty |
| | theme and name colours, `name_style`, `avatar_decoration`, `clan_tag`, `clan_tag_guild`, `panels`, `profile_frame`, `nameplate`, `profile_effect`, `entrance_sound` → defaults |
| | `notif_prefs`, `client_settings`, `guild_layout`, `pinned_channels`, `ignored_users`, `online_alerts`, `friend_request_from`, `sensitive_media` and the privacy flags → defaults |
| | `is_admin`, `admin_via_env` → false; `active_at`, `notify_mailed_at`, `username_changed_at`, `suspended_at`, `disabled_at`, `status_expires_at`, `dm_spam_until` → NULL; `status` → `offline` |

**Deleted (personal, or useless without the person):**
- credentials and tokens: `sessions` (with their IP and user-agent), `oauth_tokens`, `oauth_codes`,
  `mcp_grants`, `mcp_codes`, `qr_logins` (IP and device), `passkeys`, `webauthn_challenges`,
  `mfa_backup_codes`, `email_tokens`, `push_tokens`, `web_push_subs`;
- linked accounts: `connections`, `user_role_connections`, `user_app_installs`;
- personal state: `data_exports` (and its files), `notification_settings`, `read_states`, `bookmarks`,
  `user_notes` (both written by and about them), `relationships` (both directions), `user_reviews` (by and
  about them), `activities`, `presence`, `listen_along`, `stream_previews`;
- family: `family_links`, `family_codes`;
- membership: `guild_members`, `thread_members`, group-DM `channel_members` (a group they own passes to a
  remaining member), `event_rsvps`, `guild_applications`, `ban_appeals`, `poll_votes` (the vote count drops by
  one);
- logs: `mail_log` rows sent to their address;
- **files:** their avatar, banner and avatar-history images (rows and files). Images they made for servers
  (emoji, stickers, sounds) stay with the server, credited to "Deleted User".

**Kept, pointing at the tombstone:**
- **content:** `messages` (shown as "Deleted User" with the default avatar), `attachments` and their
  files (they're part of conversations), `reactions`, threads they started, and pins;
- **1:1 DMs:** the DM channel and its `channel_members` row stay, so the other person keeps the history.
  It reads as a conversation with "Deleted User" and can't receive new messages;
- **moderation and audit**, needed by server moderators and instance admins:
  - `guild_bans`, `member_warnings` and `reports`, by ID only;
  - `guild_member_log`, `guild_audit` and `admin_audit`, by ID only;
  - the name copies in `guild_audit` / `admin_audit` `actor_name` / `target_name` and
    `reports.target_username` → "Deleted User";
- `messages.author_override`: unaffected. It holds webhook personas, never a user's identity.

**Purchases and entitlements.** There are none today, so nothing financial is kept. If payments are added
later: invoices kept for tax law stay in their own table, keyed by the tombstone ID, with only what the law
requires (amount, currency, date, country, provider reference). No name, email or address beyond what the
payment provider must hold.

## Clients

- Users gain `deleted: true`. For message authors it comes from the reserved username prefix, so no message query
  had to change.
- Wherever a user shows (messages, replies, mentions, member and friend lists, DMs, reactions tooltips,
  search, audit log, profiles), a deleted user renders as **Deleted User** with the default avatar.
  - No profile card: the popout shows "This account was deleted".
  - No nameplate, decoration, frame, effect or badges.
  - Not mentionable and not in autocomplete.
  - The message box in a DM with them is replaced by "You can't send messages to this user."
- One helper (`displayUser(u)`) feeds every component, so new views get it automatically.

## Web deletion path (Google Play)

- **Page:** `https://app.runparley.com/delete-account`, a public page in the web client. It explains what's
  deleted and when, signs you in (password, 2FA or passkey), then shows the same confirmation and request.
  It works for people who no longer have the app installed.
- **Links:** linked from the website footer and from the app's store listing.

## Re-registration

Deleted usernames and emails are freed at finalize (the email becomes NULL and the name the placeholder), so
anyone can register them again. No hash is kept by default. See the open questions about evading a ban.

## Tests

- Backend unit tests: placeholder format and randomness, the reserved prefix, the scrub field list.
- End-to-end suite `deleteme` (55 checks):
  1. Request: needs a password and 2FA; sessions and push tokens die immediately; the profile is hidden.
  2. Login during grace: shows the restore prompt; restoring works.
  3. Finalize: a scheduled date in the past is picked up. Every field above is scrubbed, files are gone and
     related rows are deleted.
  4. Content stays and renders as "Deleted User" in messages, DMs, reactions and member lists; the old
     username and email can be registered again.
  5. Running finalize again changes nothing.
  6. The web `/delete-account` page works end to end.

## Open questions

1. **Owned servers and apps.** Discord makes you transfer or delete owned servers first. I'd do the same:
   refuse the request and list the servers and apps, with Transfer and Delete buttons. Today's hard delete
   silently deletes them. The alternative is deleting them at finalize. Which do you want?
2. **Ban evasion.** Should an account deleted while suspended, or while banned from servers, keep a keyed
   hash of its email for a limited time (say 90 days) to block re-registration? I'd recommend no hash for
   normal deletions and this one narrow case only. Or none at all, as you specified.
3. **Moderation records.** Keep bans, warnings and reports as anonymous records tied to the tombstone ID
   (my recommendation), or delete them too?
4. **Admin delete.** Make the admin "Delete user" an immediate tombstone and keep hard purge as a separate,
   clearly labelled action?
