# Reaching Parley from outside your network

Choose one approach:

| Approach | Ports to open | Trusted HTTPS | Good for |
|---|---|---|---|
| [Tailscale](#tailscale) | none | yes (`*.ts.net`) | Friends and family you can invite to your tailnet |
| [Cloudflare Tunnel](#cloudflare-tunnel) | none | yes | Public access behind CGNAT, or without a static IP |
| [Caddy](#caddy) | 80, 443 | yes (automatic) | A new reverse proxy with the least config |
| [Nginx Proxy Manager](#nginx-proxy-manager) | 80, 443 | yes | A web UI; common on Unraid and NAS setups |
| [Traefik](#traefik) | 80, 443 | yes | You already run Traefik with Docker labels |
| [Built-in Let's Encrypt](#built-in-lets-encrypt) | 80, 443 | yes | No separate proxy, and Parley is the only site on the host |

The same rules apply to all of them:

- **Point the proxy at the frontend's HTTP port** (`http://<host>:3000`, or `http://frontend:80` on a shared Docker network). Never point it at the backend.
- **Pass WebSockets on `/ws`.** Without them the page loads, but messages never arrive.
- **Set `X-Forwarded-For`.** Rate limits are per client IP. Without the header, every user shares the proxy's IP.
- **Allow large request bodies.** Attachments can be large, so set the proxy's limit to at least your biggest expected upload.
- **Set `APP_URL` to the public URL**, for example `https://chat.example.com`, then run `docker compose up -d`.
- **Keep the frontend ports private.** When the proxy runs directly on the host (not in a container), set `WEB_PORT=127.0.0.1:3000`. In every setup, forward only the proxy's ports on your router. Clients that reach port 3000 directly could send a forged `X-Forwarded-For` and get around the rate limits.

For port forwarding, forward TCP 80 and 443 from your router to the proxy host. Voice and video media is peer-to-peer and doesn't pass through the proxy. Users behind strict NATs need a TURN server (`ICE_SERVERS`).

---

## Tailscale

Install Tailscale on the Parley host and run `tailscale up`. Then, in the admin console, enable **MagicDNS** and **HTTPS Certificates** (DNS page). Then:

```bash
sudo tailscale serve --bg 3000
```

Parley is now available at `https://<machine-name>.<tailnet>.ts.net` with a valid certificate, only to devices in your tailnet. Set `APP_URL` to that address. Share the machine with friends from the Tailscale admin console (Machines → Share). To make it public on the internet instead, use `tailscale funnel --bg 3000`.

## Cloudflare Tunnel

You need a domain on Cloudflare. No ports are opened on your router.

1. Cloudflare dashboard → Zero Trust → Networks → **Tunnels** → Create a tunnel → *Cloudflared*. Copy the token.
2. Add a **Public hostname**: `chat.example.com`, service type `HTTP`, URL `frontend:80`.
3. In `.env`, set:
   ```ini
   TUNNEL_TOKEN=eyJ...
   APP_URL=https://chat.example.com
   WEB_PORT=127.0.0.1:3000
   WEB_TLS_PORT=127.0.0.1:3443
   ```
4. Run `docker compose --profile tunnel up -d`.

Cloudflare terminates TLS, forwards WebSockets, and sets `X-Forwarded-For`. On the Free plan, uploads over **100 MB** are rejected.

## Caddy

Install Caddy on the host (`apt install caddy`, or use the `caddy` container). Then write `/etc/caddy/Caddyfile`:

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Run `sudo systemctl reload caddy`. Caddy fetches and renews the certificate itself, passes WebSockets, and sets `X-Forwarded-For`. It has no default body size limit.

## Nginx Proxy Manager

Hosts → Proxy Hosts → **Add Proxy Host**:

- **Details tab:** domain `chat.example.com`; scheme `http`; forward hostname or IP: the Parley host's LAN IP (or `frontend`, if NPM shares a Docker network with the stack); port `3000` (or `80` when using `frontend`); turn on **Websockets Support** and **Block Common Exploits**.
- **SSL tab:** Request a new SSL certificate; turn on **Force SSL** and **HTTP/2 Support**.
- **Advanced tab:**
  ```nginx
  client_max_body_size 4100m;
  proxy_request_buffering off;
  proxy_read_timeout 3600s;
  ```

## Traefik

Add the Traefik network and labels to the `frontend` service in `compose.yaml`. This example assumes your Traefik has an entrypoint named `websecure` and a certificate resolver named `le`, and is attached to an external network named `proxy`:

```yaml
services:
  frontend:
    # remove the `ports:` block, or bind it to 127.0.0.1
    networks: [default, proxy]
    labels:
      - traefik.enable=true
      - traefik.docker.network=proxy
      - traefik.http.routers.parley.rule=Host(`chat.example.com`)
      - traefik.http.routers.parley.entrypoints=websecure
      - traefik.http.routers.parley.tls.certresolver=le
      - traefik.http.services.parley.loadbalancer.server.port=80

networks:
  proxy:
    external: true
```

Traefik handles WebSockets and `X-Forwarded-For` without extra settings, and has no body size limit unless you add a buffering middleware.

## Built-in Let's Encrypt

This option lets the Parley frontend own ports 80 and 443 itself:

```ini
TLS_HOSTNAME=chat.example.com
APP_URL=https://chat.example.com
LETSENCRYPT_EMAIL=you@example.com
WEB_PORT=80
WEB_TLS_PORT=443
```

```bash
docker compose --profile letsencrypt up -d
```

The `certbot` container gets a certificate on its first start and renews it twice a day. The frontend picks up new certificates within ten minutes. While testing, set `LETSENCRYPT_STAGING=1` to avoid Let's Encrypt's rate limits. Port 80 on `chat.example.com` must reach this host for the HTTP-01 challenge.

## Dynamic IP at home

If your ISP changes your public IP, keep a DNS record pointed at it with a DDNS client. Options include your router's built-in DDNS, the `ddclient` package, or a container such as `favonia/cloudflare-ddns`. Tailscale and Cloudflare Tunnel don't need DDNS.
