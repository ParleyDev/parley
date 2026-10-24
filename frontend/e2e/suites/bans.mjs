// Bans + ownership transfer + emoji overlay checks.
import { chromium } from 'playwright'
import { B as API, S, WEB, ok as check, finish, track } from '../lib.mjs'
const browser = await chromium.launch()
const errors = []
let fail = 0
const reg = async (n) => { const r = await fetch(API+'/auth/register', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email:`${n}${S}@x.io`, username:`${n}${S}`, display_name:n[0].toUpperCase()+n.slice(1), password:'password1' }) }); const x = await r.json(); track(x.user); return { token: x.token, id: x.user.id, name: n[0].toUpperCase()+n.slice(1) } }
const call = async (u, method, path, body) => { const r = await fetch(API+path, { method, headers: { authorization: 'Bearer '+u.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json() } catch {}; return { status: r.status, body: j } }
const page = async (u, vp = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 500, isMobile: vp.width < 500 })
  const p = await ctx.newPage()
  p.on('pageerror', e => errors.push(u.name+':'+e.message))
  await p.goto(`${WEB}/login`)
  await p.evaluate((t) => localStorage.setItem('parley.token', t), u.token)
  await p.goto(`${WEB}/channels/@me`); await p.waitForTimeout(600)
  return p
}
try {
  const alice = await reg('alice'), bob = await reg('bob'), carol = await reg('carol')
  // Alice creates a server; bob + carol join.
  const g = (await call(alice, 'POST', '/guilds', { name: 'Ban Land' })).body
  const inv = (await call(alice, 'POST', `/guilds/${g.id}/invites`, {})).body
  await call(bob, 'POST', `/invites/${inv.code}`); await call(carol, 'POST', `/invites/${inv.code}`)
  const general = g.channels.find(c => c.kind === 'text')

  console.log('-- REST: bans')
  check('bob cannot list bans (no BAN_MEMBERS)', (await call(bob, 'GET', `/guilds/${g.id}/bans`)).status === 403)
  check('bob cannot ban carol', (await call(bob, 'PUT', `/guilds/${g.id}/bans/${carol.id}`, { reason: 'x' })).status === 403)
  check('owner cannot be banned', (await call(bob, 'PUT', `/guilds/${g.id}/bans/${alice.id}`, {})).status === 403)
  // Give bob a Moderator role with BAN_MEMBERS.
  const role = (await call(alice, 'POST', `/guilds/${g.id}/roles`, { name: 'Moderator' })).body
  await call(alice, 'PATCH', `/guilds/${g.id}/roles/${role.id}`, { permissions: (1<<1) | (1<<2) })
  await call(alice, 'PATCH', `/guilds/${g.id}/members/${bob.id}`, { roles: [role.id] })
  check('mod still cannot ban owner', (await call(bob, 'PUT', `/guilds/${g.id}/bans/${alice.id}`, {})).status === 400)
  check('mod cannot ban self', (await call(bob, 'PUT', `/guilds/${g.id}/bans/${bob.id}`, {})).status === 400)

  const bp = await page(bob), cp = await page(carol)
  await cp.goto(`${WEB}/channels/${g.id}/${general.id}`); await cp.waitForTimeout(500)
  check('carol sees the server before ban', await cp.locator('aside >> text=Ban Land').count() === 1)

  // Bob bans carol via the UI (profile card → Ban → reason → confirm).
  await bp.goto(`${WEB}/channels/${g.id}/${general.id}`); await bp.waitForTimeout(600)
  await bp.click('aside >> text=Carol'); await bp.waitForTimeout(300)
  await bp.click('[data-profile-popout] button[title="More"]'); await bp.waitForTimeout(200)
  check('popout menu shows Ban for mod', await bp.locator('[data-profile-menu] [role=menuitem]:has-text("Ban Carol")').count() === 1)
  await bp.click('[data-profile-menu] [role=menuitem]:has-text("Ban Carol")'); await bp.waitForTimeout(300)
  check('ban modal opened', await bp.locator('[role=dialog] h2:has-text("Ban Carol")').count() === 1)
  await bp.fill('[role=dialog] textarea', 'spamming invites')
  await bp.click('[role=dialog] button:has-text("Ban")'); await bp.waitForTimeout(600)
  const bans = (await call(bob, 'GET', `/guilds/${g.id}/bans`)).body
  check('ban recorded with reason + moderator', bans.length === 1 && bans[0].user_id === carol.id && bans[0].reason === 'spamming invites' && bans[0].moderator_name === 'Bob', JSON.stringify(bans))
  check('carol removed from members', (await call(alice, 'GET', `/guilds/${g.id}/members`)).body.every(m => m.user_id !== carol.id))
  await cp.waitForTimeout(500)
  check('carol client dropped the server', await cp.locator('aside >> text=Ban Land').count() === 0 && cp.url().includes('/channels/@me'))
  check('mod list hides carol', await bp.locator('aside >> text=Carol').count() === 0)
  // Carol cannot rejoin.
  check('invite preview says banned', (await call(carol, 'GET', `/invites/${inv.code}`)).body.banned === true)
  const rejoin = await call(carol, 'POST', `/invites/${inv.code}`)
  check('accept invite refused while banned', rejoin.status === 400 && /banned/i.test(rejoin.body.error), JSON.stringify(rejoin))
  await cp.goto(`${WEB}/invite/${inv.code}`); await cp.waitForTimeout(600)
  check('invite page shows banned message', await cp.locator('text=You are banned from this server').count() === 1)

  // Bans tab for alice: list, revoke.
  const ap = await page(alice)
  await ap.goto(`${WEB}/channels/${g.id}/${general.id}`); await ap.waitForTimeout(600)
  await ap.click('aside button:has-text("Ban Land")'); await ap.click('button:has-text("Server Settings")'); await ap.waitForTimeout(400)
  await ap.click('[role=dialog] button:has-text("Bans")'); await ap.waitForTimeout(500)
  check('bans tab lists carol with reason', await ap.locator('[role=dialog] [data-ban] >> text=spamming invites').count() === 1)
  await ap.screenshot({ path: '35-bans.png' })
  await ap.click('[role=dialog] button[title="Revoke ban"]'); await ap.waitForTimeout(300)
  await ap.click('[role=dialog] button:has-text("Revoke Ban")'); await ap.waitForTimeout(600)
  check('ban list empty after revoke', (await call(alice, 'GET', `/guilds/${g.id}/bans`)).body.length === 0)
  check('carol can rejoin after unban', (await call(carol, 'POST', `/invites/${inv.code}`)).status === 200)
  check('no-reason ban of a non-member works (pre-emptive)', (await call(alice, 'PUT', `/guilds/${g.id}/bans/${(await reg('dave')).id}`)).status === 201)
  check('unban unknown → 404', (await call(alice, 'DELETE', `/guilds/${g.id}/bans/${alice.id}`)).status === 404)

  console.log('-- REST: ownership')
  check('non-owner cannot transfer', (await call(bob, 'POST', `/guilds/${g.id}/owner`, { user_id: bob.id })).status === 403)
  check('cannot transfer to self', (await call(alice, 'POST', `/guilds/${g.id}/owner`, { user_id: alice.id })).status === 400)
  check('cannot transfer to non-member', (await call(alice, 'POST', `/guilds/${g.id}/owner`, { user_id: '00000000-0000-0000-0000-000000000000' })).status === 400)
  // UI: alice opens Server Settings → Transfer Ownership → pick bob → ack → transfer.
  // The revoke confirm replaced the settings modal, so reopen it.
  await ap.click('aside button:has-text("Ban Land")'); await ap.click('button:has-text("Server Settings")'); await ap.waitForTimeout(400)
  await ap.click('[role=dialog] button:has-text("Overview")'); await ap.waitForTimeout(300)
  check('overview shows owner card', await ap.locator('[role=dialog] >> text=You own this server').count() === 1)
  await ap.click('[role=dialog] button:has-text("Transfer Ownership")'); await ap.waitForTimeout(400)
  check('transfer modal opened', await ap.locator('[role=dialog] h2:has-text("Transfer Ownership")').count() === 1)
  check('transfer disabled until pick + ack', await ap.locator('[role=dialog] button:has-text("Transfer Ownership")').isDisabled())
  await ap.click('[role=dialog] button:has-text("Bob")')
  await ap.check('[role=dialog] input[type=checkbox]')
  await ap.screenshot({ path: '36-transfer.png' })
  await ap.click('[role=dialog] button:has-text("Transfer Ownership")'); await ap.waitForTimeout(700)
  const g2 = (await call(alice, 'GET', `/guilds/${g.id}`)).body
  check('owner_id now bob', g2.owner_id === bob.id)
  await ap.click('aside button:has-text("Ban Land")'); await ap.waitForTimeout(300)
  check('alice menu now offers Leave Server', await ap.locator('button:has-text("Leave Server")').count() === 1 && await ap.locator('button:has-text("Delete Server")').count() === 0)
  await ap.keyboard.press('Escape')
  await bp.click('aside button:has-text("Ban Land")'); await bp.waitForTimeout(300)
  check('bob menu now offers Delete Server (live GUILD_UPDATE)', await bp.locator('button:has-text("Delete Server")').count() === 1)
  await bp.keyboard.press('Escape')
  await bp.waitForTimeout(300)
  check('crown moved to bob in member list', await bp.locator('aside button:has-text("Bob") svg.lucide-crown').count() === 1 && await bp.locator('aside button:has-text("Alice") svg.lucide-crown').count() === 0)
  check('alice cannot transfer again', (await call(alice, 'POST', `/guilds/${g.id}/owner`, { user_id: alice.id })).status === 403)
  check('old owner has no ban power now', (await call(alice, 'PUT', `/guilds/${g.id}/bans/${bob.id}`, {})).status === 403)
  check('new owner can ban the old owner', (await call(bob, 'PUT', `/guilds/${g.id}/bans/${alice.id}`, { reason: 'bye' })).status === 201)

  console.log('-- emoji overlay')
  for (const [tag, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const p = await page(bob, vp)
    await p.goto(`${WEB}/channels/${g.id}/${general.id}`); await p.waitForTimeout(600)
    if (tag === 'mobile') { await p.click('aside >> text=general').catch(()=>{}); await p.waitForTimeout(300) }
    for (let i = 0; i < 14; i++) { await p.fill('textarea', 'line '+i); await p.keyboard.press('Enter'); await p.waitForTimeout(80) }
    await p.waitForTimeout(300)
    await p.click('[data-emoji-button]'); await p.waitForTimeout(600)
    const cb = await p.locator('[data-expression-picker]').boundingBox()
    check(`${tag}: composer picker is on screen`, cb && cb.width > 250 && cb.x >= 0 && cb.x + cb.width <= vp.width && cb.y >= 0 && cb.y + cb.height <= vp.height, JSON.stringify(cb))
    const cells = await p.locator('[data-emoji-grid] [data-emoji-btn]').evaluateAll(bs => bs.map(b => b.getBoundingClientRect()).filter(r => r.width >= 28).length)
    check(`${tag}: emoji cells have room`, cells > 100, String(cells))
    await p.fill('[data-emoji-search]', 'fire'); await p.waitForTimeout(150); await p.click('[data-emoji-btn=":fire:"]'); await p.waitForTimeout(100); await p.keyboard.press('Escape'); await p.waitForTimeout(150)
    check(`${tag}: picking inserts emoji`, (await p.inputValue('textarea')).includes('🔥'))
    await p.fill('textarea', '')
    await p.waitForSelector('[data-expression-picker]', { state: 'detached', timeout: 5000 }).catch(() => {})
    const last = p.locator('text=line 13').last()
    if (tag === 'mobile') await last.tap(); else await last.hover()
    await p.waitForTimeout(200)
    await p.locator('button[title="Add Reaction"]').last().click(); await p.waitForTimeout(300)
    await p.waitForTimeout(300)
    const rb = await p.locator('[data-expression-picker]').last().boundingBox()
    check(`${tag}: reaction picker fully on screen`, rb && rb.y >= 0 && rb.y + rb.height <= vp.height && rb.x >= 0 && rb.x + rb.width <= vp.width, JSON.stringify({ rb }))
    await p.screenshot({ path: `37-react-${tag}.png` })
    await p.fill('[data-emoji-search]', 'thumbs up'); await p.waitForTimeout(150); await p.click('[data-emoji-btn=":thumbs_up:"]'); await p.waitForTimeout(400)
    check(`${tag}: reaction applied`, await p.locator('text=line 13').last().locator('..').locator('..').locator('button:has-text("👍")').count() >= 1)
    await p.context().close()
  }
} catch (e) { check('no exception', false, e.message.split('\n')[0]) }
check('no page errors', errors.length === 0, JSON.stringify(errors))
await browser.close()
await finish()
