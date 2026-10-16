import { WEB, API_ORIGIN, ok, finish } from '../lib.mjs'

// Liveness endpoints used by the Docker healthchecks and load balancers.
let r = await fetch(`${WEB}/healthz`); ok('frontend /healthz answers ok', r.status === 200 && (await r.text()) === 'ok' && (r.headers.get('content-type') || '').startsWith('text/plain'))
r = await fetch(`${API_ORIGIN}/health`); ok('backend /health answers ok', r.status === 200 && (await r.text()) === 'ok')
r = await fetch(`${WEB}/.well-known/acme-challenge/probe-${Date.now()}`); ok('ACME challenge path is served by nginx (404 for an unknown token, not the SPA)', r.status === 404 && !(await r.text()).includes('<div id="root"'))
r = await fetch(`${WEB}/api/instance`); ok('the API is reachable through the nginx proxy', r.status === 200 && typeof (await r.json()).registration_enabled === 'boolean')
await finish()
