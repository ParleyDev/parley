// Admin Console → Mail: the emails this backend tried to send, with what happened to each (sent, failed, logged,
// off), a recipient filter, and the body and any error on click. Status follows MAIL_MODE (E2E_MAIL_STATUS
// overrides the expectation, e.g. `failed` against a stack pointed at an unreachable SMTP server).
import { chromium } from 'playwright'
import { WEB, reg, call, ok, finish, adminToken } from '../lib.mjs'
const expect = process.env.E2E_MAIL_STATUS ?? 'logged'
const admin = await adminToken()
const a = await reg('mailee')
const mine = await call(admin.token, 'GET', `/admin/mail?to=${encodeURIComponent(a.user.email)}`)
ok('the API reports a status for each mail', mine.length >= 1 && mine[0].status === expect, JSON.stringify(mine[0] ?? null))

const browser = await chromium.launch(); const errors = []
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', (e) => errors.push(e.message))
await p.goto(`${WEB}/login`); await p.evaluate((t) => localStorage.setItem('parley.token', t), admin.token)
await p.goto(`${WEB}/admin`); await p.click('[data-admin-nav="mail"]'); await p.waitForSelector('[data-admin-mail]')
await p.waitForSelector('[data-admin-mail-row]')
ok('the Mail page lists recent emails', await p.locator('[data-admin-mail-row]').count() >= 1)
await p.fill('[data-admin-mail-search]', a.user.email); await p.waitForTimeout(700)
const rows = p.locator('[data-admin-mail-row]')
ok('filtering by recipient shows only their emails', await rows.count() >= 1 && (await rows.allTextContents()).every((t) => t.includes(a.user.email)))
ok(`each row shows its status (${expect})`, (await rows.first().getAttribute('data-mail-status')) === expect)
await rows.first().locator('button').click()
const body = await p.textContent('[data-admin-mail-detail]')
ok('opening a row shows the email body', /verify/i.test(body ?? ''), body?.slice(0, 120))
if (expect === 'failed') ok('a failed email shows the error', (await p.locator('[data-admin-mail-error]').count()) === 1)
await p.fill('[data-admin-mail-search]', 'nobody-at-all@example.invalid'); await p.waitForTimeout(700)
ok('an address with no mail says so', (await p.textContent('[data-admin-mail-empty]'))?.includes('No emails to that address'))
await p.screenshot({ path: 'adminmail.png' })
ok('no page errors', errors.length === 0, errors.join('\n'))
await browser.close(); await finish()
