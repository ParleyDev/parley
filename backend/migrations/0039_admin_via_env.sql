-- Admins granted by ADMIN_EMAILS are tracked so removing the email demotes them again; console-granted admins are not touched.
ALTER TABLE users ADD COLUMN admin_via_env BOOLEAN NOT NULL DEFAULT false;
