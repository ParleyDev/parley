import { chromium } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
const api=(t,m,p,b)=>fetch(B+p,{method:m,headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined}).then(r=>r.json())
const a=await reg('alice'), b=await reg('bob')
const g=await api(a.token,'POST','/guilds',{name:'Mobile Test'}); const inv=await api(a.token,'POST',`/guilds/${g.id}/invites`,{})
await api(b.token,'POST',`/invites/${inv.code}`)
const vc=g.channels.find(x=>x.kind==='voice').id, tc=g.channels.find(x=>x.kind==='text').id
const browser=await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] })
const errors=[]
const open=async(tok,name,viewport,url)=>{const ctx=await browser.newContext({viewport,permissions:['microphone'],isMobile:viewport.width<500,hasTouch:viewport.width<500}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(name+': '+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(name+' console: '+m.text())}); await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),tok); await p.goto(url); return p}
const vis=(p,sel)=>p.locator(sel).first().isVisible().catch(()=>false)

// ---- Desktop: intentional join + VC chat
const pa=await open(a.token,'A',{width:1440,height:900},`${WEB}/channels/${g.id}/${vc}`)
const pb=await open(b.token,'B',{width:1440,height:900},`${WEB}/channels/${g.id}/${tc}`)
await pa.waitForSelector('text=Join Voice'); await pa.waitForTimeout(300)
console.log('A on VC page, auto-joined?', await pa.locator('text=Voice Connected').count()>0)
await pa.click(`aside a[href="/channels/${g.id}/${vc}"]`); await pa.waitForTimeout(400)
console.log('A clicked VC in sidebar, joined?', await pa.locator('text=Voice Connected').count()>0, 'join button visible:', await vis(pa,'text=Join Voice'))
// chat closed by default → open, send
await pa.click('main button[title="Show Chat"]'); await pa.waitForSelector('main textarea')
await pa.fill('main textarea','hello from voice chat'); await pa.press('main textarea','Enter'); await pa.waitForTimeout(500)
console.log('A sees own VC msg:', await pa.locator('main >> text=hello from voice chat').count())
// B on text channel → VC row shows unread
await pb.waitForTimeout(400)
console.log('B VC row unread (bold):', await pb.locator(`aside a[href="/channels/${g.id}/${vc}"] .font-semibold`).count())
await pb.click(`aside a[href="/channels/${g.id}/${vc}"]`); await pb.waitForSelector('text=Join Voice')
console.log('B chat toggle unread dot:', await pb.locator('main button[title="Show Chat"] .bg-danger').count())
await pb.click('main button[title="Show Chat"]'); await pb.waitForSelector('main >> text=hello from voice chat'); await pb.waitForTimeout(300)
console.log('B sees msg, dot cleared:', await pb.locator('main button[title="Hide Chat"] .bg-danger').count()===0)
await pb.fill('main textarea','reply in vc'); await pb.press('main textarea','Enter')
await pa.waitForSelector('main >> text=reply in vc'); console.log('A sees B reply')
// join via button; chat stays
await pa.click('text=Join Voice'); await pa.waitForSelector('text=Voice Connected')
console.log('A joined via button; chat still open:', await vis(pa,'main textarea'), 'tile:', await pa.locator('main .aspect-video').count())
await pa.screenshot({path:'14-vc-chat.png'})

// ---- Mobile
const pm=await open(b.token,'M',{width:390,height:844},`${WEB}/channels/@me`)
await pm.waitForSelector('text=Direct Messages'); await pm.waitForTimeout(300)
console.log('mobile @me: DM sidebar visible', await vis(pm,'text=Find or start a conversation'), 'Friends main hidden', !(await vis(pm,'input[placeholder*="Search people"]')))
await pm.screenshot({path:'15-m-home.png'})
await pm.click(`nav a[href="/channels/${g.id}"]`); await pm.waitForSelector('text=Text Channels'); await pm.waitForTimeout(300)
console.log('mobile guild tap: channel list visible', await vis(pm,'text=Text Channels'), 'chat hidden', !(await vis(pm,'textarea')))
await pm.screenshot({path:'16-m-channels.png'})
await pm.click(`aside a[href="/channels/${g.id}/${tc}"]`); await pm.waitForSelector('textarea'); await pm.waitForTimeout(300)
console.log('mobile text channel: chat visible', await vis(pm,'textarea'), 'sidebar hidden', !(await vis(pm,'text=Text Channels')))
await pm.fill('textarea','from phone'); await pm.press('textarea','Enter'); await pm.waitForSelector('main >> text=from phone')
await pm.screenshot({path:'17-m-chat.png'})
// members sheet
await pm.click('main button[title="Member List"]'); await pm.waitForTimeout(200)
console.log('mobile members sheet:', await vis(pm,'text=Members'), await pm.locator('aside >> text=alice').count())
await pm.screenshot({path:'18-m-members.png'})
await pm.click('aside button:has(svg.lucide-x)'); await pm.waitForTimeout(200)
// back to nav
await pm.click('main button[title="Channels"]'); await pm.waitForTimeout(300)
console.log('mobile back: sidebar visible', await vis(pm,'text=Text Channels'))
// voice channel on mobile
await pm.click(`aside a[href="/channels/${g.id}/${vc}"]`); await pm.waitForSelector('text=Join Voice'); await pm.waitForTimeout(200)
console.log('mobile VC: not auto joined', await pm.locator('text=Voice Connected').count()===0)
await pm.click('text=Join Voice'); await pm.waitForTimeout(1500)
console.log('mobile VC joined; tiles', await pm.locator('main .aspect-video').count(), 'A tiles', await pa.locator('main .aspect-video').count())
await pm.screenshot({path:'19-m-voice.png'})
await pm.click('main button[title="Show Chat"]'); await pm.waitForSelector('main textarea'); await pm.waitForTimeout(200)
await pm.fill('main textarea','phone in vc chat'); await pm.press('main textarea','Enter'); await pa.waitForSelector('main >> text=phone in vc chat')
console.log('mobile VC chat sent, A sees it; mobile chat header has mute+disconnect:', await pm.locator('main section button[title="Mute"]').count(), await pm.locator('main section button[title="Disconnect"]').count())
await pm.screenshot({path:'20-m-vc-chat.png'})
await pm.click('main section button[title="Close chat"]'); await pm.waitForTimeout(200)
console.log('mobile chat closed; controls visible', await vis(pm,'main button[title="Disconnect"]'))
// settings on mobile
await pm.click('main button[title="Disconnect"]'); await pm.click('main button[title="Channels"]'); await pm.click('button[title="User Settings"]'); await pm.waitForTimeout(300)
console.log('mobile settings: tabs', await vis(pm,'text=Voice & Video'))
await pm.click('text=Voice & Video'); await pm.waitForTimeout(300); await pm.screenshot({path:'21-m-settings.png'})
const hscroll = await pm.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)
console.log('horizontal overflow on mobile:', hscroll)
console.log('errors:', errors)
await browser.close()
ok('no page errors', errors.length===0, JSON.stringify(errors))
await finish()
