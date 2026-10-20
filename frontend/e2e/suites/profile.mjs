import { chromium } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
import { FIX } from '../lib.mjs'
import { regLower, callS } from '../lib.mjs'
const a=await regLower('alice'), b=await regLower('bob')
const g=(await callS(a.token,'POST','/guilds',{name:'Profiles'})).body; const inv=(await callS(a.token,'POST',`/guilds/${g.id}/invites`,{})).body; await callS(b.token,'POST',`/invites/${inv.code}`)
const tc=g.channels.find(x=>x.kind==='text').id
// REST validation
let r=await callS(a.token,'PATCH','/users/@me',{theme_primary:'red'}); ok('bad colour -> 400', r.status===400)
r=await callS(a.token,'PATCH','/users/@me',{pronouns:'x'.repeat(41)}); ok('long pronouns -> 400', r.status===400)
r=await callS(a.token,'PATCH','/users/@me',{banner_url:'data:image/png;base64,'+'A'.repeat(1100*1024)}); ok('banner >1MB -> 400', r.status===400)
r=await callS(a.token,'PATCH','/users/@me',{theme_primary:'#1abc9c',theme_accent:'#9b59b6',pronouns:'she/her',bio:'**Bold** and *italic* with `code` and https://example.com'})
ok('profile saved', r.status===200 && r.body.theme_primary==='#1abc9c' && r.body.theme_accent==='#9b59b6' && r.body.pronouns==='she/her')
r=await callS(b.token,'GET',`/users/${a.user.id}`); ok('public user exposes theme/pronouns', r.body.theme_accent==='#9b59b6' && r.body.pronouns==='she/her')
r=await callS(a.token,'PATCH','/users/@me',{theme_accent:''}); ok('empty string clears accent', r.status===200 && r.body.theme_accent===null)
await callS(a.token,'PATCH','/users/@me',{theme_accent:'#9b59b6'})

const browser=await chromium.launch()
const errors=[]
const open=async(tok,name,url)=>{const ctx=await browser.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(name+': '+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(name+' console: '+m.text())}); await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),tok); await p.goto(url); return p}
const pa=await open(a.token,'A',`${WEB}/channels/${g.id}/${tc}`)
const pb=await open(b.token,'B',`${WEB}/channels/${g.id}/${tc}`)
await pa.waitForSelector('textarea'); await pb.waitForSelector('textarea')
// Alice edits in Profiles tab: upload banner, toggle gradient, set bio
await pa.click('button[title="User Settings"]'); await pa.click('[role=dialog] nav button:has-text("Profiles")'); await pa.waitForSelector('h1:has-text("Profiles")')
await pa.setInputFiles('[data-banner-input]', `${FIX}/pic.png`)
await pa.waitForSelector('[role=dialog] img[src^="/api/images/"]'); ok('banner preview appears (uploaded)', true)
const bannerUrl = await pa.evaluate(()=>document.querySelector('[role=dialog] img[src^="/api/images/"]').getAttribute('src')); const bl=Number((await fetch(`${WEB}`+bannerUrl)).headers.get('content-length')); ok('banner resized under 900KB ('+Math.round(bl/1024)+'KB)', bl>0 && bl < 900*1024)
await pa.fill('input[placeholder="Add your pronouns"]','they/them')
await pa.fill('[role=dialog] textarea[placeholder^="Tell people"]','__underlined__ ~~gone~~ > quoted')
ok('preview card shows pronouns live', await pa.locator('text=they/them').count()>=1)
ok('preview renders markdown', await pa.locator('main, [role=dialog] >> s:has-text("gone")').count()>=1 || await pa.locator('s:has-text("gone")').count()>=1)
await pa.screenshot({path:'30-profiles-tab.png'})
await pa.click('button:has-text("Save Changes")'); await pa.waitForSelector('text=Profile saved')
r=await callS(b.token,'GET',`/users/${a.user.id}`); ok('saved banner + pronouns via UI', !!r.body.banner_url && r.body.pronouns==='they/them')
await pa.keyboard.press('Escape')
// Bob opens alice's profile from member list
await pb.waitForTimeout(500)
await pb.click('aside button:has-text("alice")'); await pb.waitForSelector('[role=dialog] >> text=they/them')
const bg = await pb.locator('[role=dialog] [data-profile-card]').first().evaluate(el=>getComputedStyle(el).backgroundImage)
ok('bob sees gradient card: '+bg.slice(0,40), bg.includes('linear-gradient'))
console.log('banner div style:', String(await pb.evaluate(()=>document.querySelector('[role=dialog] .h-28')?.getAttribute('style'))).slice(0,80)); r=await callS(b.token,'GET',`/users/${a.user.id}`); console.log('api banner len:', r.body.banner_url?.length)
ok('bob sees banner image', await pb.locator('[role=dialog] div[style*="background-image"]').count()===1)
ok('bob sees underline + strike in bio', await pb.locator('[role=dialog] s:has-text("gone")').count()===1 && await pb.locator('[role=dialog] u:has-text("underlined")').count()===1)
await pb.screenshot({path:'31-profile-modal.png'})
console.log('errors:', errors)
await browser.close()
ok('no page errors', errors.length===0, JSON.stringify(errors))
await finish()
