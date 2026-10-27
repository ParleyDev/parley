-- Log in with a QR code: a signed-out screen shows one, you scan it on a device where you're signed in and approve.
CREATE TABLE qr_logins (
    id          UUID PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scanned', 'approved', 'denied', 'used')),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    device      TEXT NOT NULL DEFAULT '',
    ip          TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
