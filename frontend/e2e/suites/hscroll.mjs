import { chromium, devices } from 'playwright'
import { API_ORIGIN, B, WEB, S, reg, login, loginRaw, call, raw, multi, ok, pass, fail, finish, PNG, GIF, pngFile, gifFile, adminToken, track } from '../lib.mjs'
const a=await reg('alice'); const browser=await chromium.launch()
const check=async(p,label)=>{
  const r=await p.evaluate(()=>{ const out={}; for (const el of document.querySelectorAll('[data-discover], [data-discover] main, [data-discover] main > div, [data-discover-tabs], [data-tab-strip], html, body')) { const k=(el.tagName+'.'+(el.className||'').toString().slice(0,30)); out[k]=[el.scrollWidth, el.clientWidth] } return out })
  const bad=Object.entries(r).filter(([,[sw,cw]])=>sw>cw+1)
  ok(`${label}: no element scrolls horizontally`, bad.length===0, JSON.stringify(bad))
}
const ctx=await browser.newContext({ ...devices['iPhone 13'] }); const pm=await ctx.newPage(); await pm.goto(`${WEB}/login`); await pm.evaluate((t)=>localStorage.setItem('parley.token',t),a.token)
await pm.goto(`${WEB}/discover`); await pm.waitForTimeout(1200); await check(pm,'iPhone 13')
await pm.evaluate(()=>{ const el=document.querySelector('[data-discover] main > div'); el.scrollLeft=200; return el.scrollLeft }).then(v=>ok('iPhone: content cannot be dragged sideways', v===0, String(v)))
await ctx.close()
for (const w of [900, 1100, 1440]) { const p=await browser.newPage({viewport:{width:w,height:800}}); await p.goto(`${WEB}/login`); await p.evaluate((t)=>localStorage.setItem('parley.token',t),a.token); await p.goto(`${WEB}/discover`); await p.waitForTimeout(900); await check(p,`${w}px`); await p.close() }
await browser.close(); await finish()
