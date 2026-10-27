import { chromium } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
const a=await reg('alice'), b=await reg('bob'), c=await reg('carol')
for (const u of [a,b]) { await call(c.token,'POST','/users/@me/relationships',{user_id:u.user.id}); await call(u.token,'PUT',`/users/@me/relationships/${c.user.id}`) }
await call(b.token,'PATCH','/users/@me',{bio:'I build **things**\nline two\nline three\nline four\nline five', pronouns:'Genderfluid. Please ask for pronouns.', theme_primary:'#7c3aed', theme_accent:'#2563eb'})
const g=await call(a.token,'POST','/guilds',{name:'Popout Land'}); const inv=await call(a.token,'POST',`/guilds/${g.id}/invites`,{}); await call(b.token,'POST',`/invites/${inv.code}`)
const g2=await call(a.token,'POST','/guilds',{name:'Second'}); const inv2=await call(a.token,'POST',`/guilds/${g2.id}/invites`,{}); await call(b.token,'POST',`/invites/${inv2.code}`)
const g3=await call(a.token,'POST','/guilds',{name:'Alice Only'})
await call(a.token,'POST',`/guilds/${g.id}/roles`,{name:'Builder'})
await call(a.token,'PATCH',`/guilds/${g.id}/members/${b.user.id}`,{nickname:'Bobby'})
const tc=g.channels.find(x=>x.kind==='text').id
await call(b.token,'POST',`/channels/${tc}/messages`,{content:'hello from bob'})
const browser=await chromium.launch(); const errors=[]
const within=(r,vw,vh)=>r && r.x>=0 && r.y>=0 && r.x+r.width<=vw && r.y+r.height<=vh
{
const ctx=await browser.newContext({viewport:{width:1440,height:900}, permissions:['clipboard-read','clipboard-write']}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc}`); await p.waitForTimeout(900)
console.log('-- desktop popout')
const row=p.locator('aside button:has-text("Bobby")').first(); const rb=await row.boundingBox(); await row.click(); await p.waitForTimeout(600)
let card=p.locator('[data-profile-popout]'); let cb=await card.boundingBox()
ok('popout opens left of the member row, 300 wide, in viewport', cb && Math.round(cb.width)===300 && cb.x+cb.width<=rb.x && within(cb,1440,900), JSON.stringify({cb,rb}))
ok('themed: tinted border uses theme colour', (await card.locator('[data-profile-card]').evaluate(e=>getComputedStyle(e).borderColor))==='rgb(124, 58, 237)')
ok('banner has add-friend + more buttons overlaid', await card.locator('button[title="Add Friend"]').count()===1 && await card.locator('button[title="More"]').count()===1)
ok('name block: nickname, display name • username • pronouns (pronouns wrap to a 2nd line)', await card.locator('h2:has-text("Bobby")').count()===1 && /Bob\s*•\s*bob\d+\s*•\s*Genderfluid/.test((await card.innerText()).replace(/\n/g,' ')) && (await card.locator('h2 + p').boundingBox()).height>30)
ok('bio clamped, … line, View Full Bio', await card.locator('[data-bio] strong:text-is("things")').count()===1 && (await card.locator('[data-bio]').boundingBox()).height<=55 && (await card.innerText()).includes('…') && await card.locator('[data-view-full-bio]').count()===1)
ok('mutual row: 1 Mutual Friend • 2 Mutual Servers, above the bio', await card.locator('[data-mutual]:has-text("1 Mutual Friend"):has-text("2 Mutual Servers")').count()===1 && (await card.locator('[data-mutual]').boundingBox()).y < (await card.locator('[data-bio]').boundingBox()).y)
ok('User Reviews panel: No reviews yet', await card.locator('[data-reviews]:has-text("User Reviews"):has-text("No reviews yet")').count()===1)
ok('no Member Since / Roles in the popout', !(await card.innerText()).includes('Member since') && await card.locator('button[title="Add role"]').count()===0)
ok('message box with emoji button', await card.locator('[data-quick-message]').count()===1 && await card.locator('[data-quick-message]').getAttribute('placeholder')==='Message @Bobby' && await card.locator('button[title="Emoji"]').count()===1)
await p.screenshot({ path: '43-popout.png' })
// … menu
await card.locator('button[title="More"]').click(); await p.waitForTimeout(250)
const menu=p.locator('[data-profile-menu]'); const mb=await menu.boundingBox()
ok('menu opens beside the card inside the viewport', await menu.count()===1 && within(mb,1440,900), JSON.stringify(mb))
const labels=(await menu.locator('[role=menuitem]').allInnerTexts()).map(t=>t.trim())
ok('menu items: View Full Profile, Invite to Server, Add Friend, Block, Kick, Ban, Copy User Info', ['View Full Profile','Invite to Server','Add Friend','Block','Kick Bobby','Ban Bobby','Copy User Info'].every(l=>labels.includes(l)), labels.join('|'))
await menu.locator('[role=menuitem]:has-text("Invite to Server")').hover(); await p.waitForTimeout(250)
ok('Invite submenu lists only servers Bob is not in', (await p.locator('[data-profile-menu] [role=menu] [role=menuitem]').allInnerTexts()).map(t=>t.trim().split('\n').pop()).join('|')==='Alice Only')
await menu.locator('[role=menuitem]:has-text("Copy User Info")').hover(); await p.waitForTimeout(250)
await p.screenshot({ path: '44-popout-menu.png' })
ok('Copy submenu: ID, Profile Link', await p.locator('[role=menuitem]:has-text("Copy User ID")').count()===1 && await p.locator('[role=menuitem]:has-text("Copy Profile Link")').count()===1)
await p.locator('[role=menuitem]:has-text("Copy Profile Link")').click(); await p.waitForTimeout(200)
ok('Copy Profile Link copies /users/<id>', (await p.evaluate(()=>navigator.clipboard.readText()))===`${WEB}/users/${b.user.id}`)
ok('menu closed after choosing', await p.locator('[data-profile-menu]').count()===0)
// View Full Profile → centred modal with Member Since, roles, mutual list
await card.locator('button[title="More"]').click(); await p.locator('[role=menuitem]:has-text("View Full Profile")').click(); await p.waitForTimeout(500)
ok('full profile modal: Member since, Roles, mutual friends + servers, reviews, action icons', await p.locator('[data-profile-popout]').count()===0 && await p.locator('[role=dialog] h3:has-text("Member since")').count()===1 && await p.locator('[role=dialog] button[title="Add role"]').count()===1 && await p.locator('[role=dialog] [data-mutual-list] li').count()===2 && await p.locator('[role=dialog] [data-mutual-friends] li:has-text("Carol")').count()===1 && await p.locator('[role=dialog] [data-reviews-list]').count()===1 && await p.locator('[role=dialog] button[title="Kick"]').count()===1)
// reviews: post, replace, list, count in popout, delete
await p.fill('[data-review-input]', 'great builder'); await p.keyboard.press('Enter'); await p.waitForTimeout(500)
ok('review posted', await p.locator('[role=dialog] [data-review]:has-text("great builder")').count()===1)
await p.fill('[data-review-input]', 'even better'); await p.keyboard.press('Enter'); await p.waitForTimeout(500)
ok('second post replaces own review (one per author)', await p.locator('[role=dialog] [data-review]').count()===1 && await p.locator('[role=dialog] [data-review]:has-text("even better")').count()===1)
const rv=await call(c.token,'PUT',`/users/${b.user.id}/reviews`,{content:'from carol'}); ok('another user can review too', rv.author_display_name==='Carol')
ok('self-review refused', (await (await fetch(B+`/users/${b.user.id}/reviews`,{method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer '+b.token},body:JSON.stringify({content:'me'})})).status)===400)
ok('bob (profile owner) cannot delete carol\'s review', (await (await fetch(B+`/users/${b.user.id}/reviews/${rv.id}`,{method:'DELETE',headers:{authorization:'Bearer '+b.token}})).status)===404)
await p.keyboard.press('Escape'); await p.waitForTimeout(200); await row.click(); await p.waitForTimeout(600)
ok('popout shows review count', await p.locator('[data-profile-popout] [data-reviews]:has-text("2 reviews")').count()===1)
await p.locator('[data-profile-popout] [data-reviews]').click(); await p.waitForTimeout(500)
await p.locator('[role=dialog] [data-review] button[title="Delete review"]').click(); await p.waitForTimeout(400)
ok('author deletes own review; only one Delete button was offered and carol\'s stays', await p.locator('[role=dialog] [data-review]').count()===1 && await p.locator('[role=dialog] [data-review] button[title="Delete review"]').count()===0)
await p.screenshot({ path: '45-full-profile.png' })
await p.keyboard.press('Escape'); await p.waitForTimeout(200)
// Invite to Server sends an invite link by DM
await row.click(); await p.waitForTimeout(400); await p.locator('[data-profile-popout] button[title="More"]').click()
await p.locator('[role=menuitem]:has-text("Invite to Server")').hover(); await p.waitForTimeout(200); await p.locator('[role=menuitem]:has-text("Alice Only")').click(); await p.waitForTimeout(800)
const dms=await call(a.token,'GET','/users/@me/channels'); const dmc=dms.find(c=>c.recipients?.some(r=>r.id===b.user.id))
const dmsgs=dmc?await call(a.token,'GET',`/channels/${dmc.id}/messages`):[]
ok('Invite to Server DMed an invite link', Array.isArray(dmsgs) && dmsgs.some(m=>/\/invite\/[A-Za-z0-9]{8}$/.test(m.content)), JSON.stringify(dmsgs?.map(m=>m.content)))
// quick message with emoji
await p.locator('[data-profile-popout] button[title="Emoji"]').click(); await p.waitForTimeout(500); await p.fill('[data-emoji-search]', 'fire'); await p.waitForTimeout(150); await p.click('[data-emoji-btn=":fire:"]'); await p.waitForTimeout(100); await p.keyboard.press('Escape'); await p.waitForTimeout(150)
ok('emoji picker inserts into the message box', (await p.inputValue('[data-quick-message]')).trim()==='🔥')
await p.fill('[data-quick-message]', 'quick hello 🔥'); await p.keyboard.press('Enter'); await p.waitForTimeout(900)
ok('quick message → DM opened with the message', /\/channels\/@me\//.test(p.url()) && await p.locator('.msg-content:has-text("quick hello")').count()===1, p.url())
// chat avatar: card to the right
await p.goto(`${WEB}/channels/${g.id}/${tc}`); await p.waitForTimeout(700)
const av=p.locator('.group button:has(img), .group button:has(div.rounded-full)').first(); const ab=await av.boundingBox(); await av.click(); await p.waitForTimeout(500)
cb=await p.locator('[data-profile-popout]').boundingBox()
ok('chat avatar: card right of the avatar, in viewport', cb && cb.x>=ab.x+ab.width && within(cb,1440,900), JSON.stringify({cb,ab}))
await p.mouse.click(700, 150); await p.waitForTimeout(200)
ok('click outside closes', await p.locator('[data-profile-popout]').count()===0)
// own card
await p.locator('aside button:has-text("Alice"):has(svg.lucide-crown)').first().click(); await p.waitForTimeout(400)
ok('own card: no add-friend, no message box; menu has Edit Profile', await p.locator('[data-profile-popout] button[title="Add Friend"]').count()===0 && await p.locator('[data-profile-popout] [data-quick-message]').count()===0 && (await p.locator('[data-profile-popout] button[title="More"]').click(), await p.waitForTimeout(200), await p.locator('[role=menuitem]:has-text("Edit Profile")').count()===1))
await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200)
// profile link route
await p.goto(`${WEB}/users/${b.user.id}`); await p.waitForTimeout(1000)
ok('/users/:id opens the full profile', p.url().endsWith('/channels/@me') && await p.locator('[role=dialog] h2:has-text("Bob")').count()===1)
await ctx.close()
}
{
const ctx=await browser.newContext({viewport:{width:390,height:844}, hasTouch:true, isMobile:true}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push('m:'+e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),a.token)
await p.goto(`${WEB}/channels/${g.id}/${tc}`); await p.waitForTimeout(900)
console.log('-- mobile sheet')
await p.click('button[title="Member List"]'); await p.waitForTimeout(300)
await p.locator(`[data-member-row="${b.user.id}"]`).first().tap(); await p.waitForTimeout(500)
const sheet=p.locator('[data-profile-sheet]'); const sb=await sheet.boundingBox()
ok('mobile: bottom sheet full width, flush with bottom, same popout content', await sheet.count()===1 && sb && Math.round(sb.width)===390 && Math.round(sb.y+sb.height)===844 && await sheet.locator('[data-quick-message]').count()===1 && await sheet.locator('button[title="More"]').count()===1, JSON.stringify(sb))
await p.screenshot({ path: '46-popout-mobile.png' })
await ctx.close()
}

await browser.close(); await finish()
