import { chromium } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
import { regLower, callS } from '../lib.mjs'
const a=await regLower('alice'), b=await regLower('bob')
const g=(await callS(a.token,'POST','/guilds',{name:'Names'})).body; const inv=(await callS(a.token,'POST',`/guilds/${g.id}/invites`,{})).body; await callS(b.token,'POST',`/invites/${inv.code}`)
const tc=g.channels.find(x=>x.kind==='text').id
let r=await callS(a.token,'PATCH','/users/@me',{name_primary:'#e91e63',name_accent:'#3498db'}); ok('user name gradient saved', r.status===200 && r.body.name_primary==='#e91e63' && r.body.name_accent==='#3498db')
r=await callS(a.token,'PATCH','/users/@me',{name_accent:'zzz'}); ok('bad name colour -> 400', r.status===400)
r=await callS(a.token,'POST',`/guilds/${g.id}/roles`,{name:'Rainbow',color:'#f1c40f',color_accent:'#1abc9c'}); const role=r.body; ok('role with gradient created', r.status===201 && role.color_accent==='#1abc9c')
r=await callS(a.token,'PATCH',`/guilds/${g.id}/roles/${role.id}`,{color_accent:null}); ok('role accent cleared via null', r.status===200 && r.body.color_accent===null)
await callS(a.token,'PATCH',`/guilds/${g.id}/roles/${role.id}`,{color_accent:'#1abc9c'})
const dm=(await callS(a.token,'POST','/users/@me/channels',{recipient_id:b.user.id})).body
await callS(a.token,'POST',`/channels/${dm.id}/messages`,{content:'dm hello'})
await callS(a.token,'POST',`/channels/${tc}/messages`,{content:'guild hello'})

const browser=await chromium.launch()
const errors=[]
const open=async(tok,name,url)=>{const ctx=await browser.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(name+': '+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(name+' console: '+m.text())}); await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),tok); await p.goto(url); return p}
const pb=await open(b.token,'B',`${WEB}/channels/@me/${dm.id}`)
await pb.waitForSelector('main >> text=dm hello')
const styleOf = async (p, sel) => p.locator(sel).first().evaluate(el=>{const cs=getComputedStyle(el); return {bg:cs.backgroundImage, fill:cs.webkitTextFillColor, color:cs.color}})
let st=await styleOf(pb,'main button:has-text("alice") span'); ok('DM author uses user gradient: '+st.bg.slice(0,30), st.bg.includes('linear-gradient') && st.fill==='rgba(0, 0, 0, 0)')
st=await styleOf(pb,`aside a[href="/channels/@me/${dm.id}"] span.truncate`); ok('DM sidebar name gradient', st.bg.includes('linear-gradient'))
await pb.screenshot({path:'32-name-dm.png'})
// guild: no coloured role yet -> user style; then assign Rainbow -> role gradient wins
await pb.goto(`${WEB}/channels/${g.id}/${tc}`); await pb.waitForSelector('main >> text=guild hello'); await pb.waitForTimeout(400)
st=await styleOf(pb,'main button:has-text("alice") span'); ok('guild author falls back to user gradient', st.bg.includes('233, 30, 99'))
await callS(a.token,'PATCH',`/guilds/${g.id}/members/${a.user.id}`,{roles:[role.id]}); await pb.waitForTimeout(500)
st=await styleOf(pb,'main button:has-text("alice") span'); ok('role gradient overrides live: '+st.bg.slice(0,40), st.bg.includes('241, 196, 15') && st.bg.includes('26, 188, 156'))
st=await styleOf(pb,'aside button:has-text("alice") span.truncate'); ok('member list uses role gradient', st.bg.includes('241, 196, 15'))
await pb.click('aside button:has-text("alice")'); await pb.waitForSelector('[role=dialog] h2')
st=await styleOf(pb,'[role=dialog] h2 span'); ok('profile modal name uses role gradient in server', st.bg.includes('241, 196, 15'))
await pb.screenshot({path:'33-name-guild.png'})
await pb.keyboard.press('Escape')
// solid role colour (no accent) -> plain colour
await callS(a.token,'PATCH',`/guilds/${g.id}/roles/${role.id}`,{color_accent:null}); await pb.waitForTimeout(400)
st=await styleOf(pb,'main button:has-text("alice") span'); ok('solid role colour when accent removed', st.bg==='none' && st.color==='rgb(241, 196, 15)')
// Profiles tab UI: set name colour + gradient and see preview
const pa=await open(a.token,'A',`${WEB}/channels/@me`)
await pa.waitForSelector('text=Add Friend'); await pa.click('button[title="User Settings"]'); await pa.click('[role=dialog] nav button:has-text("Profiles")'); await pa.waitForSelector('text=Name colour')
ok('name gradient toggle present and on', await pa.locator('[role=dialog] >> text=Gradient name').count()===1)
await pa.screenshot({path:'34-name-settings.png'})
// Roles tab UI: gradient toggle
await pa.goto(`${WEB}/channels/${g.id}/${tc}`); await pa.waitForSelector('textarea'); await pa.click('aside button:has-text("Names")'); await pa.click('text=Server Settings'); await pa.click('[role=dialog] nav button:has-text("Roles")'); await pa.click('[role=dialog] >> text=Rainbow')
await pa.waitForSelector('text=Gradient name (add a second colour)'); ok('role editor shows gradient toggle', true)
await pa.click('[role=dialog] button[role=switch] >> nth=0'); await pa.waitForSelector('text=Preview:'); await pa.click('button:has-text("Save Changes")'); await pa.waitForSelector('text=Role saved')
r=await callS(a.token,'GET',`/guilds/${g.id}/roles`); ok('gradient re-enabled from role UI', !!r.body.find(x=>x.id===role.id).color_accent)
console.log('errors:', errors)
await browser.close()
ok('no page errors', errors.length===0, JSON.stringify(errors))
await finish()
