// The versioned API (/api/v1) and the public API reference (/api/v1/openapi.json and /developers).
import { chromium } from 'playwright'
import { B, WEB, S, reg, ok, finish } from '../lib.mjs'
const a = await reg('alice')
const V1 = B.replace(/\/api$/, '/api/v1')
console.log('-- versioning')
const me1 = await (await fetch(`${V1}/users/@me`, { headers: { Authorization: 'Bearer ' + a.token } })).json()
ok('/api/v1 is the same API', me1.id === a.user.id)
const spec = await (await fetch(`${V1}/openapi.json`)).json()
ok('the OpenAPI document needs no login', spec.openapi === '3.1.0' && spec.servers[0].url === '/api/v1')
ok('it covers messages, webhooks and interactions', !!spec.paths['/channels/{channel_id}/messages']?.post && !!spec.paths['/webhooks/{webhook_id}/{token}']?.post && !!spec.paths['/interactions/{interaction_id}/{token}/callback']?.post)
ok('and lists the OAuth2 scopes', Object.keys(spec.components.securitySchemes.oauth2.flows.authorizationCode.scopes).includes('role_connections.write'))
const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (x) => errors.push(x.message))
await p.goto(`${WEB}/developers`); await p.waitForSelector('[data-dev-endpoint]')
ok('/developers shows the reference without signing in', await p.locator('[data-dev-group="Webhooks"]').count() === 1)
await p.fill('[data-dev-search]', 'callback')
ok('search narrows it', await p.locator('[data-dev-endpoint]').count() === 1)
ok('no page errors', errors.length === 0, errors.join(' | '))
void S
await browser.close(); await finish()
