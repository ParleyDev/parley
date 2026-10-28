# Parley: Admin access controls, user search scoping, and server deletion

Parley is a Discord-like app with servers, channels, channel permissions/overrides,
DMs, group chats, and Discord-style moderation tooling. User account deletion
(soft delete → anonymize to `deleted_user_*` tombstone) is already implemented;
follow its conventions and don't regress it.

This work has three goals:

1. **Admin access:** Replace the admin "Message search" tool, which today lets any
   admin read any message (DMs, group chats, servers) if they know what to search for,
   with case-based, least-privilege, fully audited access.
2. **User search:** Keep user-facing message search working, strictly scoped to
   what each user can currently access.
3. **Server deletion:** Implement server deletion and T&S takedowns using a
   tombstone pattern.

## Step 1: Explore, report, and propose (no code yet)

Explore the repo and report back:

- How the admin panel authenticates and authorizes admins today
- Where the admin message search lives (API + UI), and **every** admin endpoint that
  can return message content, attachments, or user PII (endpoint inventory)
- Where user-facing message search lives, and whether it shares code with admin
  search (service, query builder, search index, endpoint)
- How messages, channels, channel permission overrides, DMs, group chats, servers,
  memberships, bans, reports, invites, webhooks, and billing/entitlements are modeled
- Whether there is a search index (Elasticsearch/OpenSearch/Meilisearch/etc.) and
  how it's kept in sync
- Whether any audit logging exists
- Whether message forwarding exists, and whether forwards are copies or references
- How the existing account-deletion job and tombstone rendering work

Then write a short design doc covering:

- Data model changes and migrations
- Permission list and role → permission mapping
- Endpoint inventory with the permission each endpoint will require
- How admin and user search paths will be separated
- Server deletion states and the finalize job
- Phase 0 migration plan

**Wait for my approval before implementing.** Implement each phase as its own PR.

---

## Phase 0: Immediate admin lockdown (first PR, ship ASAP)

- Restrict the existing admin search endpoint to a single `SUPER_ADMIN_TEMP` permission.
- Require a free-text justification on every admin search.
- Log every admin query (admin id, query, filters, timestamp, justification) and
  every result opened (message ids) to a new audit log table.
- **This must not affect user-facing search.** If the two share code, split the
  admin path out first. Include tests proving user search is unchanged.

## Phase 1: Roles and permissions (RBAC)

- Roles: `SUPPORT`, `MODERATOR`, `TS_LEAD`, `LEGAL`, `SUPER_ADMIN`, `AUDITOR`.
- Use granular permissions, mapped to roles in one place, e.g.:
  `account.metadata.read`, `account.pii.reveal`, `conversation.metadata.read`,
  `report.context.read`, `report.context.expand`, `content.search.public`,
  `content.search.private`, `content.action` (delete/ban/suspend),
  `content.export`, `case.approve`, `admin.roles.manage`, `audit.read`.
- Target mapping:

| Capability | Support | Moderator | T&S Lead | Legal | Super Admin | Auditor |
|---|---|---|---|---|---|---|
| Account metadata | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Account PII | Masked; reveal is logged | ❌ | ✅ | ✅ | ❌ | — |
| DM/GC/server metadata | ❌ | Case-bound | ✅ | Case-bound | ❌ | — |
| Reported message + context window | ❌ | ✅ | ✅ | ✅ | ❌ | — |
| Expand context | ❌ | Request | Approve | Case-bound | ❌ | — |
| Search public server content | ❌ | Case-bound | ✅ | Case-bound | ❌ | — |
| Search DM / group content | ❌ | ❌ | Two-person approved, time-boxed | Legal hold / lawful request only | ❌ | — |
| Content actions (delete/ban/suspend) | ❌ | ✅ | ✅ | ❌ | ❌ | — |
| Export | ❌ | ❌ | ❌ | Approved + logged | ❌ | — |
| Manage roles/admins | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| Read audit log | ❌ | Own actions | Own team | ✅ | ✅ | ✅ |
| Modify audit log | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

- Enforce authorization **server-side on every endpoint.** Hiding UI is not enough.
- `SUPER_ADMIN` manages roles but has **no content permissions** by default.
- Role/permission changes are audit-logged.

## Phase 2: Cases

- Add a `Case` entity: id, type (`report` | `investigation` | `legal`), subject
  (user / conversation / server), opened_by, justification, status, scope
  (conversation ids + time range), expires_at.
- **All admin content access must reference a case id. No case, no content.**
- A user report automatically creates a case. Moderators see the reported message
  plus N messages before/after (configurable, default 20) from that conversation only.
- Expanding context, or any access inside a DM or group chat, requires approval from
  a `TS_LEAD` who is **not** the requester. The grant is limited to case scope and
  expires (default 72h).

## Phase 3: Replace admin message search

- Remove global free-text search over all messages.
- Admin search is always scoped to either (a) public/discoverable servers, or
  (b) the approved scope of an open case.
- Results show metadata first (sender, conversation, timestamp). Opening content is
  a separate, logged action.
- PII is masked by default. "Reveal" is a separate, logged action.
- Tombstoned users display as `deleted_user_*` with no way to resolve the original identity.

## Phase 4: Audit log

- Append-only: no update/delete through the app; enforce at DB level if possible
  (e.g. revoke UPDATE/DELETE for the app role, or use a separate store).
- Record: actor, role, action, target ids, case id, justification, timestamp, IP/user agent.
- `AUDITOR` gets a read-only view filterable by admin, case, target, and date.
- Retention configurable; audit logs retained longer than case data.

---

## Phase 5: User-facing search (must keep working)

The admin changes apply **only** to admin access. Regular users must still be able to
search messages in conversations they can currently access.

- Separate code paths: user search is authorized by membership + channel permissions;
  admin search by role + case.
- User search scope:
  - Servers they're a member of, and within those, **only channels their roles can
    read** (respect private channels and permission overrides, using the same
    permission resolution as the normal message view)
  - DMs they're a participant in
  - Group chats they're currently a member of
- Enforce scope **inside the search query** (filter by accessible conversation/channel
  ids before results are returned). Never fetch broadly and post-filter, because that
  leaks counts, pagination totals, and timing.
- Derive authorization from the authenticated session, never from conversation ids
  sent by the client.
- If a search index is used: propagate membership/permission changes promptly,
  document maximum staleness, and do a final authorization check of returned message
  ids against the live DB before responding.
- Behavior rules:
  - Left, kicked, or banned from a server or group chat → immediate loss of access to
    its history, search results, and message links. Their own past messages remain,
    attributed to them.
  - Channel permission changes → search reflects current permissions.
  - Deleted messages → never returned.
  - Messages from tombstoned users → returned, displayed as `deleted_user_*`.
  - Blocked users → match the normal message view's behavior.
  - Servers pending deletion, deleted, or taken down → never returned.
- User search is normal product use: **not** admin-audit-logged, but rate-limited.

## Phase 6: Server deletion

### Owner-initiated deletion

- Require re-auth (+2FA if enabled) and typing the server name to confirm.
- Immediately: hide the server from all members, remove it from server lists and
  search, invalidate invites, disable webhooks/bots/integrations, and cancel
  recurring billing tied to the server.
- Status = `PENDING_DELETION`, `deletion_scheduled_for` = now + 7 days (configurable).
  Only the owner can restore during the grace period.
- Finalize job (scheduled, idempotent, safe to re-run): **hard-delete** messages,
  attachments (including storage objects), channels, threads, roles, permission
  overrides, emojis, stickers, invites, webhooks, integrations, and memberships;
  remove the server's documents from the search index.
- Keep a tombstone row with only: id, status = `DELETED`, deleted_at, deletion_type
  (`owner` | `takedown`). No name, icon, description, or owner.
- Message links, replies, invite links, and notifications referencing the server
  render "This server is no longer available" instead of erroring.

### T&S takedown (separate flow)

- Requires an appropriate admin permission and a case.
- Immediate removal; the owner **cannot** restore. Members see a
  "removed for violating guidelines" state.
- Content retained for a configurable investigation/appeal window (default 90 days),
  accessible only via the case-based admin permissions above, then hard-deleted by
  the same finalize job.

### Preservation

- Before finalizing, if an open case or legal hold references the server, snapshot
  **only in-scope content** into case storage under case retention. Everything else is
  deleted on schedule.
- Keep only legally required financial records for purchases tied to the server.

### Ownership and account deletion

- Block account deletion while the user owns any servers; prompt them to transfer
  ownership or delete each server first. Integrate this with the existing
  account-deletion flow.

### Forwarded messages

- If forwarding exists, report how forwards are stored and propose whether forwarded
  copies survive server deletion. **Confirm with me before implementing.**

---

## Global constraints

- No "log in as user" / impersonation feature.
- No bulk export except via `LEGAL` with an approved case, logged.
- All new jobs are idempotent; all new config values (grace periods, context window,
  grant expiry, retention) are configurable.
- Don't regress existing account deletion or tombstone rendering.

## Tests (required)

**Admin**
- Role × endpoint authorization matrix test covering every admin endpoint
- Case expiry; two-person approval cannot be self-approved
- Audit entries written for every content access, PII reveal, and role change
- Audit log cannot be modified through the app

**User search**
- Regression: search still works for member servers, readable channels, DMs, and group chats
- Negative: no results from non-member servers, unreadable private channels, DMs the
  user isn't in, group chats they left, servers they were banned from, or by passing
  someone else's conversation id
- Counts/pagination don't reveal hidden messages
- Phase 0 lockdown doesn't affect user search
- Tombstoned-user messages render as `deleted_user_*`

**Server deletion**
- Grace-period restore by owner; non-owner cannot restore
- Finalize idempotency
- After finalize, no content via API, search index, or storage
- Dangling references render "no longer available"
- Takedown cannot be restored by owner; retention window respected
- Legal-hold snapshot limited to case scope
- Account deletion blocked while owning servers
- Loss of access immediately after leave/kick/ban
