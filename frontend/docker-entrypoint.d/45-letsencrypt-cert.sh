#!/bin/sh
# Prefer a Let's Encrypt certificate when the certbot sidecar has issued one for TLS_HOSTNAME
# (/etc/letsencrypt is shared read-only). Copies it over the self-signed pair and keeps watching so a
# renewal is picked up with a graceful `nginx -s reload`, no restart needed.
set -e
CERT_DIR=/etc/nginx/certs
HOST="${TLS_HOSTNAME:-localhost}"
LIVE="/etc/letsencrypt/live/$HOST"

install_live() {
    if [ -s "$LIVE/fullchain.pem" ] && [ -s "$LIVE/privkey.pem" ]; then
        if ! cmp -s "$LIVE/fullchain.pem" "$CERT_DIR/cert.pem"; then
            cp "$LIVE/fullchain.pem" "$CERT_DIR/cert.pem"
            cp "$LIVE/privkey.pem" "$CERT_DIR/key.pem"
            return 0
        fi
    fi
    return 1
}

if install_live; then
    echo "Using Let's Encrypt certificate for $HOST"
fi

# Background watcher: every 10 minutes, pick up a renewed certificate and reload nginx.
(
    while sleep 600; do
        if install_live; then
            echo "Let's Encrypt certificate for $HOST renewed; reloading nginx"
            nginx -s reload || true
        fi
    done
) &
