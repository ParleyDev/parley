import { chromium } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
import { regLower, callS } from '../lib.mjs'
const a=await regLower('alice'), b=await regLower('bob'), c=await regLower('carol'), d=await regLower('dave')
const A=a.user.id, Bid=b.user.id, C=c.user.id, D=d.user.id

// --- REST
let r=await callS(a.token,'POST','/users/@me/relationships',{username:'nobody_'+S}); ok('unknown username -> 400', r.status===400)
r=await callS(a.token,'POST','/users/@me/relationships',{username:a.user.username}); ok('self -> 400', r.status===400)
r=await callS(a.token,'POST','/users/@me/relationships',{username:b.user.username.toUpperCase()}); ok('request by username (case-insensitive) -> outgoing', r.status===201 && r.body.kind==='outgoing')
r=await callS(a.token,'POST','/users/@me/relationships',{user_id:Bid}); ok('duplicate request -> 400', r.status===400)
r=await callS(b.token,'GET','/users/@me/relationships'); ok('bob sees incoming', r.body.length===1 && r.body[0].kind==='incoming' && r.body[0].user.id===A)
r=await callS(b.token,'PUT',`/users/@me/relationships/${A}`); ok('bob accepts -> friend', r.status===200 && r.body.kind==='friend')
r=await callS(a.token,'GET','/users/@me/relationships'); ok('alice now friend', r.body[0].kind==='friend')
r=await callS(a.token,'PUT',`/users/@me/relationships/${C}`); ok('accept non-pending -> 404', r.status===404)
// mutual request auto-accepts
await callS(c.token,'POST','/users/@me/relationships',{user_id:A})
r=await callS(a.token,'POST','/users/@me/relationships',{user_id:C}); ok('mutual request auto-accepts', r.status===200 && r.body.kind==='friend')
// decline
await callS(d.token,'POST','/users/@me/relationships',{user_id:A})
r=await callS(a.token,'DELETE',`/users/@me/relationships/${D}`); ok('decline incoming', r.status===204)
r=await callS(d.token,'GET','/users/@me/relationships'); ok('dave outgoing gone', r.body.length===0)
// block
r=await callS(a.token,'PUT',`/users/@me/relationships/${C}/block`); ok('block carol', r.status===200 && r.body.kind==='blocked')
r=await callS(c.token,'GET','/users/@me/relationships'); ok('carol lost friendship silently', r.body.length===0)
r=await callS(c.token,'POST','/users/@me/relationships',{user_id:A}); ok('carol cannot request alice (generic error)', r.status===400 && !/block/i.test(r.body.error))
r=await callS(c.token,'POST','/users/@me/channels',{recipient_id:A}); ok('carol cannot DM alice', r.status===403)
r=await callS(a.token,'POST','/users/@me/channels',{recipient_id:C}); ok('alice cannot DM carol while blocking', r.status===403)
r=await callS(a.token,'POST','/users/@me/relationships',{user_id:C}); ok('alice must unblock first', r.status===400 && /unblock/i.test(r.body.error))
r=await callS(a.token,'DELETE',`/users/@me/relationships/${C}`); ok('unblock', r.status===204)
r=await callS(a.token,'POST','/users/@me/channels',{recipient_id:C}); ok('DM works after unblock', r.status===201||r.status===200)
const dmc=r.body.id
// block mid-DM stops messages
await callS(c.token,'PUT',`/users/@me/relationships/${A}/block`)
r=await callS(a.token,'POST',`/channels/${dmc}/messages`,{content:'hi'}); ok('blocked sender cannot post in DM', r.status===403)
await callS(c.token,'DELETE',`/users/@me/relationships/${A}`)
// remove friend symmetric
r=await callS(a.token,'DELETE',`/users/@me/relationships/${Bid}`); ok('remove friend', r.status===204)
r=await callS(b.token,'GET','/users/@me/relationships'); ok('bob side removed too', r.body.length===0)

// --- Browser
const browser=await chromium.launch()
const errors=[]
const open=async(tok,name)=>{const ctx=await browser.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(name+': '+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(name+' console: '+m.text())}); await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),tok); await p.goto(`${WEB}/channels/@me`); await p.waitForSelector('text=Add Friend'); return p}
const pa=await open(a.token,'A'), pb=await open(b.token,'B')
await pa.click('header button:has-text("Add Friend")'); await pa.fill('input[placeholder*="username"]', b.user.username); await pa.click('button:has-text("Send Friend Request")')
await pa.waitForSelector('text=Success!'); ok('UI: request sent', true)
await pb.waitForSelector('text=sent you a friend request'); ok('bob gets toast', true)
ok('bob pending badge in sidebar', await pb.locator('aside a:has-text("Friends") span:has-text("1")').count()===1)
await pb.click('header button:has-text("Pending")'); await pb.waitForSelector('text=Incoming Friend Request'); await pb.screenshot({path:'28-pending.png'})
await pb.click('button[title="Accept"]'); await pb.waitForTimeout(400)
await pb.click('header button:has-text("All")'); ok('bob All shows alice', await pb.locator('main >> text=alice').count()>=1)
await pa.click('header button:has-text("Online")'); await pa.waitForSelector('main >> text=bob'); ok('alice Online shows bob live', true)
await pa.screenshot({path:'29-friends.png'})
// message from friends list
await pa.locator('button[title="Message"]').first().click(); await pa.waitForSelector('textarea'); ok('Message opens DM', true)
// profile: block from member list / profile modal
await pa.click('main header >> text=bob').catch(()=>{})
await pa.goto(`${WEB}/channels/@me`); await pa.waitForSelector('text=Add Friend'); await pa.click('header button:has-text("All")')
await pa.locator('button[title="More"]').first().click(); await pa.click('div.pop button:text-is("Block")'); await pa.waitForTimeout(400)
await pa.click('header button:has-text("Blocked")'); ok('alice Blocked tab shows bob', await pa.locator('main >> text=bob').count()>=1)
await pb.waitForTimeout(400); await pb.click('header button:has-text("All")'); ok('bob no longer sees alice as friend', await pb.locator('main >> text=alice').count()===0)
await pa.click('button[title="Unblock"]'); await pa.waitForTimeout(300); ok('unblocked', await pa.locator('main >> text=bob').count()===0)
console.log('errors:', errors)
await browser.close()
ok('no page errors', errors.length===0, JSON.stringify(errors))
await finish()
