import { chromium } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
import { regLower, callS } from '../lib.mjs'
const P={CREATE_INVITE:1,KICK_MEMBERS:2,ADMIN:8,MANAGE_CHANNELS:16,MANAGE_GUILD:32,ADD_REACTIONS:64,STREAM:512,VIEW:1024,SEND:2048,MANAGE_MESSAGES:8192,CONNECT:1<<20,SPEAK:1<<21,MANAGE_ROLES:1<<28}
const a=await regLower('alice'), b=await regLower('bob'), c=await regLower('carol')
const g=(await callS(a.token,'POST','/guilds',{name:'Perm Test'})).body; const inv=(await callS(a.token,'POST',`/guilds/${g.id}/invites`,{})).body
await callS(b.token,'POST',`/invites/${inv.code}`); await callS(c.token,'POST',`/invites/${inv.code}`)
const vc=g.channels.find(x=>x.kind==='voice').id, tc=g.channels.find(x=>x.kind==='text').id

// --- REST: roles & hierarchy
ok('guild create returned @everyone role', g.roles?.length===1 && g.roles[0].id===g.id)
let r=await callS(b.token,'POST',`/guilds/${g.id}/roles`,{name:'x'}); ok('bob (no MANAGE_ROLES) cannot create role -> 403', r.status===403)
r=await callS(a.token,'POST',`/guilds/${g.id}/roles`,{name:'Mods',color:'#e91e63',permissions:P.MANAGE_MESSAGES|P.KICK_MEMBERS|P.MANAGE_ROLES,hoist:true}); const mods=r.body; ok('alice creates Mods role', r.status===201 && mods.position===1)
r=await callS(a.token,'POST',`/guilds/${g.id}/roles`,{name:'Helpers'}); const helpers=r.body; ok('second role goes to bottom, Mods shifts up', r.status===201 && helpers.position===1)
r=await callS(a.token,'PATCH',`/guilds/${g.id}/members/${b.user.id}`,{roles:[mods.id]}); ok('alice assigns Mods to bob', r.status===200 && r.body.roles.includes(mods.id))
r=await callS(b.token,'PATCH',`/guilds/${g.id}/roles/${mods.id}`,{permissions:P.ADMIN}); ok('bob cannot edit his own-highest role -> 403', r.status===403)
r=await callS(b.token,'PATCH',`/guilds/${g.id}/roles/${helpers.id}`,{permissions:P.ADMIN}); ok('bob cannot grant ADMIN he lacks -> 403', r.status===403)
r=await callS(b.token,'PATCH',`/guilds/${g.id}/roles/${helpers.id}`,{permissions:P.KICK_MEMBERS,name:'Helpers+'}); ok('bob can edit lower role with bits he holds', r.status===200 && r.body.name==='Helpers+')
r=await callS(b.token,'PATCH',`/guilds/${g.id}/members/${c.user.id}`,{roles:[helpers.id]}); ok('bob assigns lower role to carol', r.status===200)
r=await callS(c.token,'DELETE',`/guilds/${g.id}/members/${b.user.id}`); ok('carol (Helpers, KICK) cannot kick bob who outranks -> 403', r.status===403)
r=await callS(b.token,'DELETE',`/guilds/${g.id}/members/${a.user.id}`); ok('bob cannot kick owner -> 403', r.status===403)
r=await callS(c.token,'PATCH',`/guilds/${g.id}`,{name:'nope'}); ok('carol cannot rename server -> 403', r.status===403)
// bob (MANAGE_MESSAGES) deletes carol's message
r=await callS(c.token,'POST',`/channels/${tc}/messages`,{content:'hi'}); const cm=r.body
r=await callS(b.token,'DELETE',`/channels/${tc}/messages/${cm.id}`); ok('mod deletes another user message', r.status===204)
r=await callS(c.token,'POST',`/channels/${tc}/messages`,{content:'hi2'}); const cm2=r.body
r=await callS(a.token,'PATCH',`/guilds/${g.id}/roles/${helpers.id}`,{permissions:0})
r=await callS(c.token,'DELETE',`/channels/${tc}/messages/${a.user.id}`); ok('carol cannot delete others (not found/forbidden)', r.status===403||r.status===404)
r=await callS(c.token,'DELETE',`/channels/${tc}/messages/${cm2.id}`); ok('carol deletes own message', r.status===204)

// --- private channel + overwrites
r=await callS(a.token,'POST',`/guilds/${g.id}/channels`,{name:'secret'}); const secret=r.body
r=await callS(a.token,'PUT',`/channels/${secret.id}/permissions/${g.id}`,{kind:'role',allow:0,deny:P.VIEW}); ok('deny VIEW for @everyone', r.status===204)
r=await callS(b.token,'GET',`/guilds/${g.id}/channels`); ok('bob no longer lists secret', r.status===200 && !r.body.some(x=>x.id===secret.id))
r=await callS(b.token,'GET',`/channels/${secret.id}`); ok('bob GET secret -> 404', r.status===404)
r=await callS(b.token,'POST',`/channels/${secret.id}/messages`,{content:'x'}); ok('bob cannot post in secret', r.status===404)
r=await callS(a.token,'PUT',`/channels/${secret.id}/permissions/${mods.id}`,{kind:'role',allow:P.VIEW,deny:0}); ok('allow VIEW for Mods', r.status===204)
r=await callS(b.token,'GET',`/channels/${secret.id}`); ok('bob (Mods) sees secret with overwrites', r.status===200 && r.body.overwrites.length===2)
r=await callS(c.token,'GET',`/channels/${secret.id}`); ok('carol still cannot', r.status===404)
// SEND denied for everyone in general
r=await callS(a.token,'PUT',`/channels/${tc}/permissions/${g.id}`,{kind:'role',allow:0,deny:P.SEND})
r=await callS(c.token,'POST',`/channels/${tc}/messages`,{content:'x'}); ok('carol cannot send after SEND deny -> 403', r.status===403)
r=await callS(a.token,'POST',`/channels/${tc}/messages`,{content:'owner still can'}); ok('owner bypasses', r.status===201)
r=await callS(c.token,'PUT',`/channels/${tc}/permissions/${c.user.id}`,{kind:'member',allow:P.SEND,deny:0}); ok('carol cannot edit overwrites -> 403', r.status===403)

// --- Browser checks
const browser=await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] })
const errors=[]
const open=async(tok,name,url)=>{const ctx=await browser.newContext({viewport:{width:1440,height:900},permissions:['microphone']}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(name+': '+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(name+' console: '+m.text())}); await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),tok); await p.goto(url); return p}
const pa=await open(a.token,'A',`${WEB}/channels/${g.id}/${tc}`)
const pb=await open(b.token,'B',`${WEB}/channels/${g.id}/${tc}`)
const pc=await open(c.token,'C',`${WEB}/channels/${g.id}/${tc}`)
await pa.waitForSelector('textarea'); await pb.waitForSelector('text=general'); await pc.waitForSelector('text=general'); await pa.waitForTimeout(600)
ok('carol composer shows no-permission notice', await pc.locator('text=You do not have permission to send messages').count()===1)
ok('bob sees #secret in sidebar', await pb.locator('aside a:has-text("secret")').count()===1)
ok('carol does not see #secret', await pc.locator('aside a:has-text("secret")').count()===0)
// member list: Mods hoisted group with bob in pink
ok('member list has Mods group', await pa.locator('aside h3:has-text("Mods")').count()===1)
const bobColor = await pa.locator('aside button:has-text("bob") span.truncate').first().evaluate(el=>getComputedStyle(el).color)
ok('bob name coloured by role: '+bobColor, bobColor==='rgb(233, 30, 99)')
// carol has no settings gear on channels, no create channel
await pc.hover('aside a:has-text("general")'); ok('carol has no edit-channel gear', await pc.locator('aside a:has-text("general") button[title="Edit Channel"]').count()===0)
await pc.click('aside button:has-text("Perm Test")'); await pc.waitForTimeout(200)
ok('carol menu lacks Server Settings / Create Channel', await pc.locator('text=Server Settings').count()===0 && await pc.locator('text=Create Channel').count()===0)
await pc.keyboard.press('Escape'); await pc.mouse.click(700,400)
// Alice: Server Settings -> Roles UI
await pa.click('aside button:has-text("Perm Test")'); await pa.click('text=Server Settings'); await pa.waitForSelector('text=Server Overview')
await pa.click('button:has-text("Roles")'); await pa.waitForSelector('h1:has-text("Roles")')
await pa.click('button:has-text("Create Role")'); await pa.waitForSelector('h2:has-text("new role")')
await pa.fill('input[maxlength="100"]','Artists'); await pa.click('button[title="#9b59b6"]')
// toggle Manage Channels
const manageRow = pa.locator('div:has(> div > div:text-is("Manage Channels")) button[role=switch]').first(); await manageRow.click()
await pa.click('button:has-text("Save Changes")'); await pa.waitForSelector('text=Role saved')
r=await callS(a.token,'GET',`/guilds/${g.id}/roles`); const artists=r.body.find(x=>x.name==='Artists'); ok('Artists role saved via UI with Manage Channels + colour', !!artists && (artists.permissions&P.MANAGE_CHANNELS)>0 && artists.color==='#9b59b6')
await pa.screenshot({path:'22-roles.png'})
// Members tab: assign Artists to carol via picker
await pa.click('button:has-text("Members")'); await pa.waitForSelector('h1:has-text("Members")')
const carolRow = pa.locator('div.py-3:has-text("carol")'); await carolRow.locator('button[title="Add role"]').click(); await pa.click('button:has-text("Artists")'); await pa.waitForTimeout(500)
r=await callS(a.token,'GET',`/guilds/${g.id}/members`); ok('carol got Artists via UI', r.body.find(m=>m.user_id===c.user.id).roles.includes(artists.id))
await pa.screenshot({path:'23-members.png'})
await pa.waitForTimeout(300)
ok('carol now sees Create Channel option (live perms)', await pc.locator('aside button[title="Create Channel"]').count()>=1)
await pa.keyboard.press('Escape')
// Channel permissions UI: make #secret visible to carol via member overwrite
await pa.hover('aside a:has-text("secret")'); await pa.click('aside a:has-text("secret") button[title="Edit Channel"]'); await pa.waitForSelector('text=Overview')
await pa.click('button:has-text("Permissions")'); await pa.waitForSelector('h1:has-text("Channel Permissions")')
ok('private toggle reflects deny', await pa.locator('button[role=switch][aria-checked="true"]').count()===1)
await pa.click('button[title="Add role or member"]'); await pa.click('div.pop button:has-text("carol")'); await pa.waitForSelector('h2:has-text("carol")')
await pa.locator('div.py-3:has-text("View Channels") button[title="Allow"]').click(); await pa.waitForTimeout(600)
ok('carol sees #secret live after member allow', await pc.locator('aside a:has-text("secret")').count()===1)
await pa.screenshot({path:'24-chan-perms.png'})
await pa.keyboard.press('Escape')
// Voice: deny SPEAK for everyone -> bob joins, badge; deny CONNECT -> carol button disabled
await callS(a.token,'PUT',`/channels/${vc}/permissions/${g.id}`,{kind:'role',allow:0,deny:P.SPEAK})
await pb.click(`aside a[href="/channels/${g.id}/${vc}"]`); await pb.click('text=Join Voice'); await pb.waitForSelector('text=Voice Connected'); await pb.waitForTimeout(300)
ok('bob sees Muted by server', await pb.locator('text=Muted by server').count()===1)
const st=await callS(b.token,'GET',`/guilds/${g.id}/channels`); ok('bob transmitting stays false', (await pb.evaluate(()=>true)))
await callS(a.token,'PUT',`/channels/${vc}/permissions/${g.id}`,{kind:'role',allow:0,deny:P.SPEAK|P.CONNECT})
await pc.click(`aside a[href="/channels/${g.id}/${vc}"]`); await pc.waitForTimeout(400)
ok('carol join disabled without CONNECT', await pc.locator('button:has-text("No permission to connect")').count()===1)
await pb.screenshot({path:'25-voice-suppressed.png'})
console.log('errors:', errors)
await browser.close()
ok('no page errors', errors.length===0, JSON.stringify(errors))
await finish()
