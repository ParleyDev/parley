#!/bin/sh
# Generate a self-signed certificate if none was mounted, so HTTPS (required for microphone access
# off-localhost) works out of the box. Mount real certs at /etc/nginx/certs/{cert,key}.pem to override.
set -e
CERT_DIR=/etc/nginx/certs
mkdir -p "$CERT_DIR"
if [ ! -s "$CERT_DIR/cert.pem" ] || [ ! -s "$CERT_DIR/key.pem" ]; then
    HOST="${TLS_HOSTNAME:-localhost}"
    echo "Generating self-signed TLS certificate for CN=$HOST (mount real certs at $CERT_DIR to override)"
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -subj "/CN=$HOST" \
        -addext "subjectAltName=DNS:$HOST,DNS:localhost,IP:127.0.0.1" \
        -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" >/dev/null 2>&1
fi
