import { chromium } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
const a=await reg('alice'); await call(a.token,'PATCH','/users/@me',{theme_primary:'#8b2f3a',theme_accent:'#c0405a',status:'invisible'})
const g=await call(a.token,'POST','/guilds',{name:'Panel'}); const tc=g.channels.find(x=>x.kind==='text').id
const browser=await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] }); const errors=[]
const ctx=await browser.newContext({viewport:{width:1440,height:900},permissions:['microphone']}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc}`); await p.waitForTimeout(1000)
const panel=p.locator('[data-user-panel]'); const pb=await panel.boundingBox(); const aside=await p.locator('aside').first().boundingBox()
ok('card floats across the server column and the sidebar, ~56px tall', pb.x>=4 && pb.x<72 && pb.x+pb.width>aside.x+aside.width-16 && pb.x+pb.width<=aside.x+aside.width && pb.height>=52 && pb.height<=64, JSON.stringify({pb,aside}))
ok('the name is visible (not squeezed out) and truncates with room', (await p.locator('[data-panel-self] .text-\\[16px\\]').boundingBox()).width>=110, String((await p.locator('[data-panel-self] .text-\\[16px\\]').boundingBox())?.width))
ok('avatar is 40px', (await p.locator('[data-panel-self] img, [data-panel-self] div.rounded-full').first().boundingBox()).width===40)
ok('name 16px bold, status line shows Invisible', (await p.locator('[data-panel-self] .text-\\[16px\\]').evaluate(n=>getComputedStyle(n).fontSize))==='16px' && (await p.locator('[data-panel-status]').innerText())==='Invisible')
ok('card tinted with the profile theme', (await panel.evaluate(n=>n.style.background)).includes('rgb(139, 47, 58)') || (await panel.evaluate(n=>n.style.background)).includes('#8b2f3a'))
ok('three 36px controls with chevrons on mic and headphones', await p.locator('[data-control]').count()===3 && (await p.locator('[data-control="Mute"]').boundingBox()).height===36 && await p.locator('[data-control-menu]').count()===2)
await p.screenshot({ path: '68-self-panel.png', clip:{x:0,y:700,width:360,height:200} })
await p.click('[data-control-menu="Mute"]'); await p.waitForTimeout(500)
ok('mic chevron opens the Input Device menu with a Default entry + Voice Settings', await p.locator('[data-device-menu="input"]').count()===1 && await p.locator('[data-device-menu="input"] [data-device-option]').count()>=1 && await p.locator('[data-device-menu="input"] button:has-text("Video Settings")').count()===1)
await p.screenshot({ path: '69-device-menu.png', clip:{x:0,y:560,width:360,height:340} })
const opts=await p.locator('[data-device-menu="input"] [data-device-option]').count()
if (opts>1) { await p.locator('[data-device-menu="input"] [data-device-option]').nth(1).click(); await p.waitForTimeout(200); ok('picking a device saves it', (await p.evaluate(()=>JSON.parse(localStorage.getItem('parley.voiceSettings')||'{}').inputDeviceId||'')).length>0) } else { await p.keyboard.press('Escape'); await p.mouse.click(700,300); ok('picking a device saves it (no extra devices in CI; skipped)', true) }
await p.waitForTimeout(200); await p.click('[data-control-menu="Deafen"]'); await p.waitForTimeout(400)
ok('headphones chevron opens the Output Device menu', await p.locator('[data-device-menu="output"]').count()===1); await p.mouse.click(700,300); await p.waitForTimeout(200)
await p.click('[data-control="Mute"]'); await p.waitForTimeout(200); ok('mute toggles', await p.locator('[data-control="Unmute"]').count()===1)
await p.click('[data-panel-self]'); await p.waitForTimeout(300); ok('clicking the self area opens the status menu', await p.locator('[data-set-status]').count()===1)
ok('no page errors', errors.length===0, errors.join('|'))
await browser.close(); await finish()
