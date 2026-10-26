// Smarter DM spam filter: content signals (shorteners, masked links, scam wording, blocked sites) and behaviour
// (the same text to many people, others marking the sender as spam), with the reasons shown in the Spam folder.
import { chromium } from 'playwright'
import { WEB, S, reg, call, ok, finish, openDms } from '../lib.mjs'
const [spammer, r1, r2, r3, r4, r5] = await Promise.all(['spammer', 'ra', 'rb', 'rc', 'rd', 're'].map((n) => reg(n)))
await openDms(r1, r2, r3, r4, r5)
const send = async (to, content) => { const dm = await call(spammer.token, 'POST', '/users/@me/channels', { recipient_id: to.user.id }); await call(spammer.token, 'POST', `/channels/${dm.id}/messages`, { content }); await new Promise((r) => setTimeout(r, 300)); return dm }
const stateOf = async (to, dm) => (await call(to.token, 'GET', '/users/@me/channels')).find((x) => x.id === dm.id)

console.log('-- content')
const d1 = await send(r1, 'heyy check this https://bit.ly/x1')
const v1 = await stateOf(r1, d1)
ok('a shortened link goes to Spam, with the reason', v1.request_state === 'spam' && v1.spam_reasons.some((r) => r.includes('shortened')), JSON.stringify(v1.spam_reasons))
const d2 = await send(r2, '[https://github.com/login](https://evil.example/steal)')
ok('a masked link goes to Spam', (await stateOf(r2, d2)).spam_reasons.some((r) => r.includes('different site')))
const d3 = await send(r3, 'good morning, how are you?')
ok('a normal hello stays a message request', (await stateOf(r3, d3)).request_state === 'pending')

console.log('-- behaviour')
const blast = 'Join my awesome community, everyone welcome'
for (const to of [r3, r4, r5]) await send(to, blast)
const r6 = await reg('rf'); await openDms(r6)
const d6 = await send(r6, blast)
const v6 = await stateOf(r6, d6)
ok('the same text to many people goes to Spam', v6.request_state === 'spam' && v6.spam_reasons.some((r) => r.includes('many people')), JSON.stringify(v6))
ok('and others having marked them as spam counts too', v6.spam_reasons.some((r) => r.includes('Spam')))

const browser = await chromium.launch(); const errors = []
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((x) => localStorage.setItem('parley.token', x), r1.token)
await p.goto(`${WEB}/channels/@me/requests`); await p.waitForSelector('[data-spam-folder]'); await p.click('[data-spam-folder] summary')
ok('the Spam folder says why', (await p.locator(`[data-request="${d1.id}"] [data-spam-reasons]`).innerText()).includes('shortened'))
ok('no page errors', errors.length === 0, errors.join(' | '))
await browser.close(); await finish()
