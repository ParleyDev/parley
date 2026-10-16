import { chromium } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
const a=await reg('alice'), b=await reg('bob')
const g=await call(a.token,'POST','/guilds',{name:'Roles'}); const inv=await call(a.token,'POST',`/guilds/${g.id}/invites`,{}); await call(b.token,'POST',`/invites/${inv.code}`)
for (const n of ['Admin','Moderator','Helper','Artist','Gamer','Streamer','Dev','Bot']) await call(a.token,'POST',`/guilds/${g.id}/roles`,{name:n})
const tc=g.channels.find(x=>x.kind==='text').id
const browser=await chromium.launch(); const errors=[]
for (const [tag,vp] of [['d',{width:1440,height:900}],['m',{width:390,height:844}]]) {
  const ctx=await browser.newContext({viewport:vp, hasTouch: tag==='m', isMobile: tag==='m'}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(e.message))
  await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),a.token)
  await p.goto(`${WEB}/channels/${g.id}/${tc}`); await p.waitForTimeout(700)
  if (tag==='m') { await p.click('button[title="Member List"]'); await p.waitForTimeout(300) }
  await p.click('aside button:has-text("bob"), [class*="sheet"] button:has-text("bob"), button:has-text("bob") >> nth=0'); await p.waitForTimeout(500)
  // Roles live in the full profile: popout → … → View Full Profile.
  await p.click('[role=dialog] button[title="More"]'); await p.waitForTimeout(200); await p.click('[role=menuitem]:has-text("View Full Profile")'); await p.waitForTimeout(500)
  await p.click('[role=dialog] button[title="Add role"]'); await p.waitForTimeout(400)
  await p.screenshot({path:`38-rolepop-${tag}.png`})
  const pop=await p.locator('[data-role-picker]').boundingBox()
  const dlg=await p.locator('[role=dialog]').boundingBox()
  console.log(tag,'pop',pop,'dialog',dlg)
  // Is the popover's last item actually visible (not clipped)?
  const vis = await p.evaluate(()=>{const items=[...document.querySelectorAll('[data-role-picker] button')]; const last=items.at(-1); if(!last) return null; const r=last.getBoundingClientRect(); const el=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return last.contains(el)||el===last})
  const inView = pop && pop.y >= 0 && pop.y + pop.height <= vp.height && pop.x >= 0 && pop.x + pop.width <= vp.width
  console.log(tag,'last item hit-testable:',vis,'fully in viewport:',inView)
  await p.click('[data-role-picker] button:has-text("'+(tag==='d'?'Bot':'Dev')+'")'); await p.waitForTimeout(400)
  console.log(tag,'assigned via picker:', (await call(a.token,'GET',`/guilds/${g.id}/members`)).find(m=>m.user_id===b.user.id).roles.length === (tag==='d'?1:2))
  await ctx.close()
}
console.log('errors',errors); await browser.close()
ok('no page errors', errors.length===0, JSON.stringify(errors))
await finish()
