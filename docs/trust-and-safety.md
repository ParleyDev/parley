# Parley – Trust & Safety, Moderation & Ban System

## Objective

Investigate, evaluate, and implement a comprehensive Trust & Safety and enforcement system for Parley, using Discord's publicly observable moderation and enforcement behaviour as a reference.

This is not a request to blindly recreate Discord's implementation. The objective is to understand the existing Parley architecture, identify functional and architectural gaps, and implement a coherent, scalable, maintainable enforcement system that fits the project's existing design principles.

**Do not begin by writing code. Investigate first.**

---

## Phase 1 – Existing Architecture Investigation

Thoroughly inspect the Parley codebase.

Identify and document:

1. User identity and account management.
2. Authentication and authorization.
3. Session and connection management.
4. Community membership and permission systems.
5. Community moderation capabilities.
6. Existing ban, kick, mute, timeout, and restriction functionality.
7. Messaging and message deletion capabilities.
8. Voice communication and connection lifecycle.
9. API structure and internal service boundaries.
10. Database architecture, entities, relationships, and migrations.
11. Event-driven infrastructure, message buses, and background processing.
12. Administrative interfaces and moderation tooling.

Determine exactly how existing restrictions are enforced.

For example:
- Does banning a user prevent authentication?
- Can a banned user maintain an existing authenticated session?
- Can a banned user continue using an existing voice connection?
- Are restrictions checked when joining communities?
- Are restrictions checked when sending messages?
- Are restrictions enforced consistently across all application services?
- Are expired restrictions automatically removed?
- Is there an audit trail?
- Can enforcement actions be reversed?

Do not assume functionality exists simply because an entity, API endpoint, or UI component exists. Trace the actual execution paths.

### Deliverable

Create an architecture investigation document describing the current implementation, relevant code locations, data flows, existing functionality, and identified limitations.

---

## Phase 2 – Discord Behavioural Comparison

Research Discord's publicly available Trust & Safety documentation, developer documentation, API documentation, and observable account enforcement behaviour.

Distinguish between:

- Officially documented behaviour.
- Behaviour observable through public APIs.
- Reasonable architectural inference.
- Unknown or undocumented implementation details.

Do not present assumptions about Discord's internal systems as established facts.

Investigate the following capabilities:

### A. Community-level enforcement

- Permanent community bans.
- Temporary community bans.
- Kicking members.
- Muting and timeouts.
- Message removal.
- Community-specific restrictions.
- Ban appeals and revocation where applicable.

### B. Platform-level enforcement

- Account warnings.
- Graduated account restrictions.
- Temporary suspensions.
- Permanent platform bans.
- Account standing and violation history.
- Expiration of violations.
- Enforcement escalation.
- Session and token invalidation.
- Reinstatement following successful appeals.

### C. Account abuse and ban evasion

Investigate publicly documented approaches to identifying related accounts and potential ban evasion.

Consider possible signals:

- IP address history.
- Session and device identifiers.
- Registration patterns.
- Account relationships.
- Behavioural patterns.
- Historical enforcement associations.

Do not assume Discord uses every signal.

For Parley, evaluate the privacy, security, false-positive, and operational implications of each approach.

Account correlation must not automatically imply guilt. Shared IP addresses, households, workplaces, and public networks must not be treated as sufficient evidence of ban evasion.

### D. Enforcement lifecycle

Investigate:

- Violation recording.
- Moderation cases.
- Evidence preservation.
- Enforcement decisions.
- Temporary restrictions.
- Expiration and escalation.
- Appeals and reversals.
- Audit history.

### Deliverable

Produce a comparison matrix showing:

| Capability | Discord behaviour | Current Parley implementation | Gap | Recommendation |
|---|---|---|---|---|

Cite official Discord documentation wherever available. Clearly label inferred behaviour.

---

## Phase 3 – Proposed Parley Architecture

Based on the investigation, design a Trust & Safety architecture that integrates naturally with Parley's existing implementation.

Avoid unnecessary microservices, infrastructure, dependencies, or architectural rewrites.

Prefer existing patterns and conventions.

The architecture should distinguish three enforcement scopes:

### 1. Community enforcement

Controlled by authorized community moderators.

Examples:
- Kick.
- Temporary ban.
- Permanent ban.
- Mute or timeout.
- Message removal.
- Community-specific restrictions.

Community enforcement must never automatically result in platform-wide enforcement.

### 2. Platform enforcement

Controlled exclusively by authorized Parley administrators and designated Trust & Safety personnel.

Examples:
- Warning.
- Feature restrictions.
- Messaging restrictions.
- Temporary suspension.
- Permanent account suspension.
- Account reinstatement.

Community moderators must not have the authority to apply platform-level enforcement.

### 3. Infrastructure-level abuse prevention

Examples:
- Rate limiting.
- Registration throttling.
- Spam prevention.
- Automated abuse detection.
- Temporary network restrictions.

Infrastructure restrictions should be independently managed and should not automatically create permanent account violations.

---

## Phase 4 – Functional Requirements

The implementation should support the following concepts, adapting names and structures to existing Parley conventions.

### Moderation cases

A moderation case represents an investigation or collection of related moderation activity.

It should support:
- Unique identifier.
- Subject account.
- Community association, when applicable.
- Case status.
- Assigned moderator or administrator.
- Reason and policy category.
- Supporting evidence.
- Related violations.
- Related enforcement actions.
- Creation and resolution timestamps.

### Violations

Violations represent recorded policy breaches.

They should support:
- Unique identifier.
- User association.
- Policy category.
- Severity.
- Description.
- Evidence references.
- Associated moderation case.
- Creation timestamp.
- Expiration timestamp, where applicable.
- Review and appeal status.

A violation and an enforcement action must be separate concepts.

For example, a user may have an active violation even after the temporary restriction associated with it has expired.

### Enforcement actions

Support:
- Warnings.
- Message removal.
- Community mute.
- Community kick.
- Community ban.
- Platform feature restriction.
- Platform suspension.
- Permanent platform ban.

Each action should include:
- Subject user.
- Enforcement scope.
- Optional community association.
- Reason.
- Issuing administrator or moderator.
- Creation timestamp.
- Expiration timestamp, if applicable.
- Revocation information.
- Related moderation case.

Historical enforcement records should be auditable and should not simply disappear when revoked or expired.

### Account standing

Implement an account-standing model derived from active violations and restrictions.

Suggested states:

- Good.
- Limited.
- Restricted.
- At Risk.
- Suspended.
- Permanently Banned.

These states should be configurable and calculated from enforcement and violation data rather than becoming an independent source of truth.

Do not implement a simplistic fixed-strike system.

Severity, violation history, policy category, and context should influence enforcement recommendations.

### Appeals

Support:
- Appeal submission.
- Appeal status.
- Original enforcement reference.
- User explanation.
- Reviewer assignment.
- Reviewer decision.
- Decision rationale.
- Enforcement reversal or modification.

Where practical, appeals should be reviewed by someone other than the original decision-maker.

A successful appeal must trigger recalculation of account standing and any affected restrictions.

---

## Phase 5 – Centralized Enforcement

This is a critical architectural requirement.

All relevant Parley services must respect the same enforcement decisions.

Investigate and implement enforcement checks across:

- Authentication and account access.
- Existing authenticated sessions.
- Community joining.
- Community membership.
- Message creation.
- Message editing, where applicable.
- Voice channel connections.
- Existing voice connections.
- File and attachment uploads.
- Friend requests.
- Community creation.
- Other relevant user-facing functionality discovered during investigation.

An account suspension must not merely prevent a new login while leaving existing connections operational.

Enforcement changes must propagate to active sessions and connections.

Prefer the existing event infrastructure.

Potential domain events include:

- UserRestrictionApplied.
- UserRestrictionExpired.
- UserRestrictionRevoked.
- UserSuspended.
- UserUnsuspended.
- UserBanned.
- UserUnbanned.
- ViolationRecorded.
- AppealResolved.

Use reliable event processing, idempotency, and appropriate retry mechanisms.

Caches may be used for performance, but the authoritative enforcement state must remain in persistent storage.

---

## Phase 6 – Ban Evasion Detection

Design this as a future-extensible capability.

Do not introduce invasive device fingerprinting or sophisticated behavioural surveillance without a clear justification.

Start with a privacy-conscious account correlation framework.

Potential signals:
- IP address associations.
- Existing session metadata.
- Registration timing and patterns.
- Previously established account associations.
- Repeated abuse patterns.

Requirements:

1. Distinguish account correlation from confirmed ban evasion.
2. Never automatically ban accounts solely because they share an IP address.
3. Record the signals and confidence associated with an investigation.
4. Apply appropriate retention limits.
5. Restrict access to sensitive correlation data.
6. Provide a mechanism for authorized human review.
7. Design for future automated detection without making it a mandatory dependency.

---

## Phase 7 – Administrative and User Experience

Investigate the existing Parley administrative and moderation interfaces.

Identify what needs to be added or modified.

At minimum, consider:

### Administrative moderation console

- Search users.
- View account standing.
- View violation history.
- View active restrictions.
- Create moderation cases.
- Review evidence.
- Apply and revoke enforcement actions.
- View enforcement history.
- Review appeals.

### Community moderation interface

- Member moderation history, within appropriate permission boundaries.
- Kick and ban controls.
- Temporary ban duration.
- Ban reason.
- Unban functionality.
- Relevant audit history.

### User-facing enforcement experience

Users should be able to understand:
- What happened.
- Which policy was violated.
- What restrictions were applied.
- How long restrictions last.
- Whether an appeal is available.
- How to submit an appeal.

Suspended users should retain access to an appropriately restricted account experience where technically feasible, including access to their suspension information and appeals.

---

## Phase 8 – Security and Abuse Resistance

Pay particular attention to:

- Authorization boundaries.
- Privilege escalation.
- Moderator abuse.
- Unauthorized platform enforcement.
- Race conditions during enforcement.
- Expired restriction handling.
- Session invalidation.
- Event delivery failures.
- Audit-log integrity.
- Sensitive data exposure.
- Evidence access permissions.
- Appeal manipulation.
- Administrative action attribution.

Platform-wide enforcement must require explicit platform-level authorization.

Community-level permissions must never be sufficient to issue platform-level enforcement.

Audit records should be append-only or otherwise protected against unauthorized alteration.

---

## Phase 9 – Implementation

Only after completing the investigation, comparison, and architectural design should implementation begin.

Implementation principles:

1. Follow existing Parley coding conventions.
2. Reuse existing infrastructure wherever reasonable.
3. Avoid unnecessary dependencies.
4. Avoid introducing microservices unless the existing architecture justifies them.
5. Maintain backward compatibility where practical.
6. Provide database migrations.
7. Include appropriate unit and integration tests.
8. Update API contracts and documentation.
9. Ensure existing community functionality continues working.
10. Implement incrementally, keeping the application buildable throughout.

Do not silently remove or replace existing functionality.

If an architectural change is necessary, explain why before making a disruptive change.

Do not leave placeholder implementations that appear functional but do not actually enforce restrictions.

---

## Phase 10 – Verification and Final Report

Test the complete enforcement lifecycle.

At minimum, verify:

- A community ban prevents rejoining that community.
- A community ban does not prevent access to unrelated communities.
- A platform suspension prevents new authenticated access.
- Existing authenticated sessions are invalidated.
- Existing voice connections are terminated.
- Restricted messaging operations are rejected.
- Temporary restrictions expire correctly.
- Revoked restrictions cease being enforced.
- Violations remain historically recorded after restrictions expire.
- Successful appeals reverse the appropriate enforcement.
- Community moderators cannot issue platform bans.
- Unauthorized users cannot access moderation evidence.
- Multiple concurrent enforcement requests do not create inconsistent state.
- Event processing failures do not silently leave restrictions unenforced.

### Final deliverables

Produce:

1. Existing architecture investigation.
2. Discord versus Parley comparison matrix.
3. Proposed architecture and design decisions.
4. Database and entity changes.
5. Implemented backend functionality.
6. API changes.
7. Administrative and moderation UI changes.
8. Automated tests.
9. Migration instructions.
10. Updated technical documentation.
11. Outstanding gaps and recommended future improvements.

For every significant implementation decision, document the rationale.

**Success criteria:** Parley has a coherent, centralized, auditable enforcement system that supports community moderation, platform-wide Trust & Safety, temporary restrictions, permanent bans, appeals, and future abuse detection without compromising the existing architecture or introducing unnecessary complexity.