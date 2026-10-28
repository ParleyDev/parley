# Admin access controls, user search scoping, and server deletion

Status: proposal, awaiting approval (spec: `docs/parley-admin-search-server-deletion-prompt.md`).

## What exists today

**Admin auth.** One boolean, `users.is_admin`, or an email listed in `ADMIN_EMAILS` (persisted as the flag),
checked by `users::require_admin` / `ensure_admin`. There are no roles: every admin can do everything. The only
special access outside `/admin` is the WebSocket handler marking admins for the client (no content access).

**Admin endpoints.** Every one is gated only by `require_admin`.

| Endpoint | Returns or does | Content / PII exposure |
|---|---|---|
| `GET /admin/messages?q=&user_id=` (`moderation.rs::find_messages`) | Full-text search over **every message on the instance** (servers, DMs, group chats), 50 per page | **All message content** |
| `GET /admin/users/:id/content` | A user's last 50 messages (any channel), their attachments and images, totals | **Message content, files** |
| `DELETE /admin/users/:id/messages`, `/uploads` | Purge a user's messages or uploads | Content action |
| `DELETE /admin/messages/:id` (`reports.rs`) | Delete any message anywhere | Content action |
| `GET /admin/reports`, `PATCH /admin/reports/:id` | Reports with a **snapshot of the reported message's text**; resolve or dismiss, with optional notices | Content (reported message) |
| `GET /admin/users` | Search and filter users: **email**, last seen, 2FA, **filter by IP** | **PII** |
| `GET /admin/users/:id/sessions`, `DELETE …/sessions[/:sid]` | Devices with **IP and user agent**; log out | **PII** |
| `PATCH /admin/users/:id`, `POST /admin/users/bulk`, `DELETE /admin/users/:id`, `POST …/purge` | Make or remove admin, suspend, clear 2FA, quotas, delete, purge | Account actions, role change |
| `GET/DELETE /admin/mail[/:id]`, `GET/PUT /admin/mail/settings` | Outgoing mail log: **recipient addresses and full bodies** | **PII** |
| `GET /admin/guilds`, `DELETE /admin/guilds/:id` | Servers with owner and counts; **hard-delete a server** | Metadata, content action |
| `GET/POST/PATCH /admin/discovery…` | Review Discover listings | Public metadata |
| `GET/PATCH /admin/applications…` | Apps and bots, verification | Metadata |
| `GET /admin/audit` | Admin audit log | Audit |
| `GET /admin/stats`, `GET/PUT /admin/settings`, `/admin/blocked-domains…`, `POST /admin/maintenance/sweep-images`, `POST /admin/deletions/run` | Instance operations | None |

**User search.** `GET /search` (`routes/search.rs`).
- The scope comes from the session: the servers you're in, the channels `perms::visible_channels` says you can read
  (the same resolution as the message view), and the DMs and group chats you're a member of (`channel_members`).
- It's enforced **inside the SQL** (`m.channel_id = ANY(scope)`), so totals and pagination never include hidden
  messages.
- **It shares no code with admin search** except the small `tsquery()` text helper.
- **No search index:** Postgres full-text (`messages.search` tsvector), so membership and permission changes apply
  immediately.
- Leaving or being kicked or banned removes `guild_members` / `channel_members` rows, so access is gone at once.
  Deleted messages are hard-deleted, so they can't match.

**Models.**
- **Servers:** `guilds`, `channels` (one table for text, voice, category, thread, DM and group; `guild_id` NULL for
  DMs and groups) and `channel_overwrites`.
- **Members:** `guild_members`, `channel_members` (DM and group membership), `guild_bans`.
- **Moderation and links:** `reports` (with a text snapshot), `invites`, `webhooks`.
- **No billing or entitlements.**
- Server deletion today is a **hard `DELETE FROM guilds`** (cascading to channels, messages, roles and so on) by the
  owner or an admin. There's no grace period or tombstone, and attachment files on disk are left for the orphan sweep.

**Audit.** `admin_audit` (instance) and `guild_audit` (per server) are written by `audit::record` and
`audit::guild`. They're ordinary tables: the app could update or delete rows (it currently only scrubs names on
account deletion), and they have no case, justification, IP or user-agent columns.

**Forwarding.** `POST /channels/:id/messages/:mid/forward` makes a **copy**: a new message by the forwarder, with the
same text, sticker and **duplicated attachment files**, plus `forwarded_from` (the original message's ID, no foreign
key). Copies already survive deletion of the original.

**Account deletion.** This is already built (`routes/deletion.rs`, `docs/account-deletion.md`):
- a grace period, then an idempotent finalize job (`FOR UPDATE SKIP LOCKED`, one transaction per account);
- the tombstone keeps the ID, with the username `deleted_user_*` and the display name "Deleted User", rendered from
  `deleted: true`;
- it's already **blocked while the user owns servers**.

## Phase 0: lock down admin search (first PR)

1. **Gate.** `GET /admin/messages` and `GET /admin/users/:id/content` (both return arbitrary message content)
   require a new permission, `super_admin_temp`. It's held in a new `admin_roles` table (below) and **granted to no
   one by default**. A migration grants it to existing admins only if you say so; otherwise admins keep everything
   else but lose these two until Phase 3 replaces them.
2. **Justification.** Both take a required `justification` (at least 10 characters).
3. **Logging.** Every query is written to a new append-only `admin_access_log`: admin, role, action
   (`content.search` / `content.open`), query, filters, justification, result message IDs, IP, user agent and time.
   Opening a result (`GET /admin/messages/:id/open`, new) is logged separately, as the spec asks.
4. **User search is untouched.** It's already a separate path. Phase 0 adds regression tests that run the user search
   suite before and after, and a negative test showing that admin lockdown doesn't change `/search` results or totals.
5. **The admin console UI** asks for the justification before searching, and hides the tool without the permission.
   The server enforces it regardless.

## Phase 1: roles and permissions

**Tables:**
- `admin_roles (user_id, role, granted_by, granted_at)`, many roles per person. Roles: `SUPPORT`, `MODERATOR`,
  `TS_LEAD`, `LEGAL`, `SUPER_ADMIN`, `AUDITOR`.
- `is_admin` remains only as "may open the console"; `ADMIN_EMAILS` grants `SUPER_ADMIN`.

**Permissions** are one Rust enum mapped to roles in **one function** (`admin_perms.rs`), mirrored to the client for
display only:

| Permission | Support | Moderator | T&S Lead | Legal | Super Admin | Auditor |
|---|---|---|---|---|---|---|
| `account.metadata.read` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `account.pii.reveal` (email, IP, mail log) | logged reveal | | ✓ | ✓ | | |
| `conversation.metadata.read` | | case | ✓ | case | | |
| `report.context.read` | | ✓ | ✓ | ✓ | | |
| `report.context.expand` | | request | approve | case | | |
| `content.search.public` | | case | ✓ | case | | |
| `content.search.private` (DM / group) | | | two-person, time-boxed | legal case | | |
| `content.action` (delete, ban, suspend, purge, takedown) | | ✓ | ✓ | | | |
| `content.export` | | | | approved case | | |
| `case.approve` | | | ✓ | | | |
| `admin.roles.manage` | | | | | ✓ | |
| `audit.read` | | own | own team | all | all | all |
| `instance.manage` (settings, mail settings, discovery, apps, maintenance) | | | | | ✓ | |

- Every admin handler calls `require_perm(state, uid, Perm::X, case: Option<CaseId>)`. The deny-all default (no
  roles, no access) is covered by an authorization-matrix test (role × endpoint).
- Role changes are audited. `SUPER_ADMIN` has no content permissions.
- **Small instances:** a one-admin instance can't satisfy two-person approval, so DM and group content is simply
  unreachable there. That's by design.
- **Existing admins:** proposed migration default is `SUPER_ADMIN` plus `TS_LEAD` for every current admin, so report
  handling keeps working. Your call.

## Phase 2: cases

**Tables:**
- `cases`: `id`, `type` (`report` / `investigation` / `legal`), `subject_kind` and `subject_id` (user,
  conversation or server), `opened_by`, `justification`, `status` (`open` / `closed`), `scope_channel_ids[]`,
  `scope_from` / `scope_to`, `expires_at`, `created_at`.
- `case_grants`: `case_id`, `kind` (`expand` / `private_access` / `export`), `requested_by`, `approved_by`
  (a `CHECK` makes it differ from `requested_by`), `expires_at` (default 72h, `CASE_GRANT_HOURS`), `revoked_at`.

**Behaviour:**
- **A report opens a case automatically** (backfilled for open reports).
- Moderators see the reported message plus N before and after (`REPORT_CONTEXT_WINDOW`, default 20), from that
  channel only.
- Any other content endpoint requires a `case_id` whose scope includes the channel and time, and whose grant (where
  needed) is approved and unexpired. **No case, no content.**

## Phase 3: replace admin message search

- `GET /admin/messages` is removed.
- `GET /admin/cases/:id/search` searches only inside the case scope; `GET /admin/search/public` covers only Discover
  servers (case-bound for moderators).
- **Results are metadata only:** sender (masked), conversation, time. `POST /admin/cases/:id/messages/:mid/open`
  returns content and is logged. PII is masked by default; `POST /admin/users/:id/reveal` returns it and is logged.
- Tombstoned users stay `deleted_user_*`; nothing can resolve them.
- `GET /admin/users/:id/content` is replaced by case-scoped equivalents.

## Phase 4: audit log

- **New table:** `admin_access_log` (from Phase 0) becomes *the* audit log for console actions, with `actor`,
  `roles`, `action`, `target_ids`, `case_id`, `justification`, `ip`, `user_agent` and `at`. `admin_audit` is migrated
  into it.
- **Append-only, enforced in the database:** a trigger rejects `UPDATE` and `DELETE` (`RAISE EXCEPTION`), and the
  app's role gets `REVOKE UPDATE, DELETE` where the deployment allows it.
- **Retention:** `AUDIT_RETENTION_DAYS` (default 2555, about 7 years) is pruned by a job running as a separate
  maintenance role. Case data uses `CASE_RETENTION_DAYS` (default 365).
- **Account deletion conflict.** Account deletion currently rewrites names in `admin_audit` / `guild_audit`. Under an
  append-only log I'd **stop storing names there at all**: store IDs only and resolve names at read time, so a
  deleted user reads as `deleted_user_*` without rewriting history.
- **Auditor UI:** a read-only view filtered by admin, case, target and date.

## Phase 5: user search

It already meets the spec; the work is tests and two gaps:
- add the `guild_state = 'active'` filter, so servers pending deletion or taken down are excluded;
- add a rate limit (`rl_search`).

Tests cover:
- the positive cases: member servers, readable channels, DMs, groups;
- the negative cases: non-member servers, private channels, others' DMs, left groups, banned servers, a forged
  `channel_id` or `guild_id`;
- totals and pagination;
- tombstoned authors render as `deleted_user_*`;
- loss of access right after leave, kick or ban.

## Phase 6: server deletion

**`guilds` gets:**
- `state` (`active` / `pending_deletion` / `taken_down` / `deleted`);
- `deletion_requested_at`, `deletion_scheduled_for`, `deleted_at`;
- `deletion_type` (`owner` / `takedown`);
- `takedown_case_id`.

**Owner deletion:**
- **Request** (`POST /guilds/:id/deletion`) needs the password, a 2FA code and the typed server name.
- **Immediately:** the state changes; the server disappears for members (`GUILD_DELETE`); it's left out of lists,
  Discover and search; invites are invalidated and webhooks, bots and integrations disabled; voice is evicted.
- The grace period is `SERVER_DELETION_GRACE_DAYS` (7). **Only the owner restores**
  (`POST /guilds/:id/restore`, visible to them under Settings › Servers pending deletion).

**Takedown:**
- `POST /admin/guilds/:id/takedown` needs `content.action` and a case.
- The server is gone for members, who see "removed for violating guidelines". The owner can't restore.
- Content is kept for `TAKEDOWN_RETENTION_DAYS` (90), reachable only through that case.

**Finalize** (`finalize_due_guilds`, same pattern as accounts: `SKIP LOCKED`, one transaction, idempotent):
- **hard-delete** messages, threads, channels, overwrites, roles, emoji, stickers, sounds, invites, webhooks,
  integrations, memberships, bans, events and reports' guild links; delete attachment and image files after the
  commit;
- delete the `guilds` row itself and keep a `guild_tombstones` row with only `id`, `deleted_at` and
  `deletion_type`. (As built: a separate tombstone table instead of NULLing name, icon, description and owner on
  `guilds`, so no code that loads a server ever meets a half-empty row.)
- Before finalizing, if an open case or legal hold references the server, copy **only the in-scope messages and
  attachments** into `case_snapshots` (case retention).

**Dangling references:** message links, replies, invites and notifications pointing at a deleted or taken-down server
return `410 {code: "server_unavailable"}`. Clients render "This server is no longer available".

**Account deletion** already blocks while the user owns servers, and its blocker list would also show servers that are
pending deletion.

## Forwarded messages (decided: they survive)

Forwards are **independent copies**: the forwarder's own message, with duplicated files, in another conversation. I
propose they **survive** server deletion (they belong to the conversation they were forwarded into, like a quote). The
`forwarded_from` pointer is cleared at finalize and the forward renders as "Forwarded from a server that's no longer
available". The alternative is deleting every forward whose source was in the server, which reaches into other
people's DMs and other servers.

## Decisions taken

1. Phase 0: only `ADMIN_EMAILS` admins held `SUPER_ADMIN_TEMP`; the role was removed in Phase 3.
2. Phase 1: existing admins became `SUPER_ADMIN` + `TS_LEAD`.
3. Forwards survive with the pointer cleared (`forwarded_unavailable`).
4. Audit rows store IDs only; names are resolved at read time.
5. One-admin instances have no break-glass: DM and group content stays unreachable without a second T&S lead.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `REPORT_CONTEXT_WINDOW` | 20 | Messages shown either side of a reported one |
| `CASE_GRANT_HOURS` | 72 | How long an approved grant lasts |
| `CASE_EXPIRY_DAYS` | 30 | How long a case stays usable |
| `AUDIT_RETENTION_DAYS` | 2555 (min 365) | Console audit retention |
| `RL_SEARCH` | 30/60 | User message searches per user per minute |
| `SERVER_DELETION_GRACE_DAYS` | 7 | Owner restore window |
| `TAKEDOWN_RETENTION_DAYS` | 90 | Taken-down content kept for its case |

## Open questions (resolved)


1. **Phase 0 access.** Should existing admins get `super_admin_temp`, so admin search keeps working (justified and
   logged), or should nobody have it until Phase 3?
2. **Phase 1 defaults.** Should current admins become `SUPER_ADMIN` + `TS_LEAD`, so reports keep working?
3. **Forwards.** Survive with the pointer cleared (my recommendation), or deleted with the server?
4. **Audit names.** Is it OK to stop storing names in audit rows (IDs only, names resolved at read time), so the log
   can be truly append-only alongside account anonymization?
5. **One-admin instances.** These can't do two-person approval, so DM and group content stays unreachable there. Is
   that acceptable, or do you want a configurable break-glass that's loudly logged?
