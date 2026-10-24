import { chromium } from 'playwright'
import fs from 'node:fs'
import { FIX } from '../lib.mjs'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
import { regLower, callS } from '../lib.mjs'
const up=async(t,ch,name,type,data)=>{const f=new FormData(); f.append('file',new Blob([data],{type}),name); const r=await fetch(`${B}/channels/${ch}/attachments`,{method:'POST',headers:{Authorization:'Bearer '+t},body:f}); const txt=await r.text(); let j=null; try{j=JSON.parse(txt)}catch{}; return {status:r.status, body:j}}
const a=await regLower('alice'), b=await regLower('bob')
const g=(await callS(a.token,'POST','/guilds',{name:'Files'})).body; const inv=(await callS(a.token,'POST',`/guilds/${g.id}/invites`,{})).body; await callS(b.token,'POST',`/invites/${inv.code}`)
const tc=g.channels.find(x=>x.kind==='text').id
const ATTACH=1<<15

// --- REST
let r=await up(a.token,tc,'pic.png','image/png',fs.readFileSync(`${FIX}/pic.png`)); const pic=r.body
ok('png upload returns dims', r.status===201 && pic.width===640 && pic.height===360 && pic.content_type==='image/png' && pic.url.startsWith('/api/attachments/'))
r=await up(a.token,tc,'fake.png','image/png',fs.readFileSync(`${FIX}/fake.png`)); ok('html disguised as png is not image/*: '+r.body?.content_type, r.status===201 && !r.body.content_type.startsWith('image/'))
const fake=r.body
r=await fetch(`${WEB}`+fake.url); ok('disguised file served as download with nosniff', r.headers.get('content-disposition').startsWith('attachment') && r.headers.get('x-content-type-options')==='nosniff')
r=await up(a.token,tc,'big.bin','application/octet-stream',Buffer.alloc(26 * 1024 * 1024)); ok('26MB rejected: '+r.status, r.status===400||r.status===413)
r=await up(a.token,tc,'notes.txt','text/plain',fs.readFileSync(`${FIX}/notes.txt`)); const notes=r.body; ok('text upload keeps text/plain', r.status===201 && notes.content_type==='text/plain')
r=await callS(a.token,'POST',`/channels/${tc}/messages`,{content:'',attachment_ids:[pic.id,notes.id]}); const m1=r.body
ok('message with only attachments', r.status===201 && m1.attachments.length===2 && m1.content==='')
r=await callS(b.token,'POST',`/channels/${tc}/messages`,{content:'steal',attachment_ids:[fake.id]}); ok('bob cannot attach alice pending upload', r.status===400)
r=await callS(a.token,'POST',`/channels/${tc}/messages`,{content:'again',attachment_ids:[pic.id]}); ok('attachment cannot be reused', r.status===400)
r=await callS(a.token,'POST',`/channels/${tc}/messages`,{content:''}); ok('empty message w/o attachments rejected', r.status===400)
r=await fetch(`${WEB}`+pic.url); ok('image served inline', r.status===200 && r.headers.get('content-type')==='image/png' && r.headers.get('content-disposition').startsWith('inline'))
r=await callS(a.token,'GET',`/channels/${tc}/messages`); ok('history includes attachments', r.body.find(m=>m.id===m1.id).attachments.length===2)
// perms: deny ATTACH_FILES for everyone -> bob cannot upload
await callS(a.token,'PUT',`/channels/${tc}/permissions/${g.id}`,{kind:'role',allow:0,deny:ATTACH})
r=await up(b.token,tc,'x.txt','text/plain','x'); ok('bob upload forbidden without Attach Files', r.status===403)
await callS(a.token,'DELETE',`/channels/${tc}/permissions/${g.id}`)
// delete message removes file
r=await callS(a.token,'DELETE',`/channels/${tc}/messages/${m1.id}`); await new Promise(r=>setTimeout(r,300))
r=await fetch(`${WEB}`+pic.url); ok('file gone after message delete: '+r.status, r.status===404)

// --- Browser
const browser=await chromium.launch()
const errors=[]
const open=async(tok,name)=>{const ctx=await browser.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(name+': '+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(name+' console: '+m.text())}); await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),tok); await p.goto(`${WEB}/channels/${g.id}/${tc}`); await p.waitForSelector('textarea'); return p}
const pa=await open(a.token,'A'), pb=await open(b.token,'B')
await pa.setInputFiles('input[data-file-input="files"]', [`${FIX}/pic.png`,`${FIX}/notes.txt`])
await pa.waitForFunction(()=>document.querySelectorAll('[data-pending]').length===2 && !document.body.innerText.includes('Uploading'))
ok('two pending previews uploaded', await pa.locator('[data-pending]').count()===2)
await pa.fill('textarea','here are files'); await pa.press('textarea','Enter')
await pb.waitForSelector('main img[alt="pic.png"]'); ok('bob sees inline image', true)
ok('bob sees file card', await pb.locator('main a[download="notes.txt"]').count()===1)
await pa.waitForSelector('main img[alt="pic.png"]'); await pa.screenshot({path:'26-attachments.png'})
await pb.click('main img[alt="pic.png"]'); await pb.waitForSelector('text=Open original'); ok('lightbox opens', true); await pb.screenshot({path:'27-lightbox.png'}); await pb.keyboard.press('Escape')
// paste an image from clipboard
await pb.focus('textarea')
await pb.evaluate(async()=>{ const res=await fetch(document.querySelector('main img[alt="pic.png"]').src); const blob=await res.blob(); const dt=new DataTransfer(); dt.items.add(new File([blob],'pasted.png',{type:'image/png'})); const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}); document.querySelector('textarea').dispatchEvent(ev) })
await pb.waitForFunction(()=>document.querySelectorAll('[data-pending]').length===1 && !document.body.innerText.includes('Uploading'))
await pb.press('textarea','Enter'); await pa.waitForSelector('main img[alt="pasted.png"]'); ok('pasted image sent, alice sees it', true)
// drop a file
const dt = await pa.evaluateHandle(async()=>{ const dt=new DataTransfer(); dt.items.add(new File(['dropped content'],'dropped.txt',{type:'text/plain'})); return dt })
await pa.dispatchEvent('main','dragenter',{dataTransfer:dt}); ok('drop overlay shown', await pa.locator('text=Drop files to attach').count()===1)
await pa.dispatchEvent('main','drop',{dataTransfer:dt})
await pa.waitForFunction(()=>document.querySelectorAll('[data-pending]').length===1 && !document.body.innerText.includes('Uploading'))
await pa.press('textarea','Enter'); await pb.waitForSelector('main a[download="dropped.txt"]'); ok('dropped file sent', true)
// attachment-only send button enabled without text
await pa.setInputFiles('input[data-file-input="files"]', [`${FIX}/notes.txt`]); await pa.waitForFunction(()=>!document.body.innerText.includes('Uploading'))
ok('send enabled with attachment and empty text', await pa.locator('button[title="Send"]').isEnabled())
await pa.click('button[title="Remove"]'); ok('pending removed', await pa.locator('[data-pending]').count()===0)
ok('send disabled again', !(await pa.locator('button[title="Send"]').isEnabled()))
console.log('errors:', errors)
await browser.close()
ok('no page errors', errors.length===0, JSON.stringify(errors))
await finish()
