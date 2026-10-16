import { chromium } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
const a=await reg('alice'), b=await reg('bob')
const g=await call(a.token,'POST','/guilds',{name:'Avatars'}); const inv=await call(a.token,'POST',`/guilds/${g.id}/invites`,{}); await call(b.token,'POST',`/invites/${inv.code}`)
const tc=g.channels.find(x=>x.kind==='text').id
await call(a.token,'POST',`/channels/${tc}/messages`,{content:'hi from alice'})
const dm=await call(a.token,'POST','/users/@me/channels',{recipient_id:b.user.id}); await call(a.token,'POST',`/channels/${dm.id}/messages`,{content:'dm from alice'})
await call(a.token,'POST','/users/@me/relationships',{user_id:b.user.id}); await call(b.token,'PUT',`/users/@me/relationships/${a.user.id}`)
const browser=await chromium.launch()
const ctx=await browser.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage()
const errors=[]; p.on('pageerror',e=>errors.push('pageerror: '+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text().slice(0,300))})
await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),b.token)
const check=async(label,url,sel,pre)=>{ await p.goto(url); if(pre){ await p.waitForTimeout(500); await pre() } await p.waitForSelector(sel,{timeout:10000}); await p.waitForTimeout(300); await p.click(sel); await p.waitForTimeout(600); const dlg=await p.locator('[role=dialog]').count(); const body=(await p.locator('body').innerText()).length; console.log(label, 'url=',p.url().replace(`${WEB}`,''), 'dialog=',dlg, 'bodyTextLen=',body, errors.length?errors.join(' | '):''); errors.length=0; await p.keyboard.press('Escape') }
await check('chat avatar', `${WEB}/channels/${g.id}/${tc}`, 'main .group button:has(img), main .group button:has(div.rounded-full) >> nth=0')
await check('member list avatar', `${WEB}/channels/${g.id}/${tc}`, '[data-member-list] button:has-text("alice")')
await check('DM chat avatar', `${WEB}/channels/@me/${dm.id}`, 'main .group button >> nth=0')
await check('friends row avatar', `${WEB}/channels/@me`, 'main button:has(div.rounded-full) >> nth=0', ()=>p.click('button:has-text("All")'))
await browser.close()
ok('no page errors', errors.length===0, JSON.stringify(errors))
await finish()
