-- Ignore (hide someone's messages and notifications without blocking them) and friend-online alerts, per account.
ALTER TABLE users
  ADD COLUMN ignored_users UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN online_alerts UUID[] NOT NULL DEFAULT '{}';
