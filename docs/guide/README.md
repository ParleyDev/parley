# The Parley user guide

These pages are the user guide at [runparley.com/guide](https://runparley.com/guide/). The app links to it from its
**Help** buttons. It is written for the people who use Parley, from someone opening it for the first time to someone
running a large community. It explains what you can do and where to find it, never how it works inside.

## Writing a page

Each `*.md` file here (other than this one) is a page. It starts with front matter:

```yaml
---
title: Messages
section: Talking
order: 30
summary: Write, format, reply, react, pin and schedule messages.
covers:
  - frontend/src/components/Composer*.tsx
  - frontend/src/components/Message*.tsx
---
```

- `section` groups pages in the sidebar. Groups appear in the order of their first page.
- `covers` lists the source files whose behaviour the page describes, as globs.
  - A `feat`, `fix` or `perf` commit that changes one of these files has to change the guide too. If nothing a user sees has changed, add a line `Guide: not affected` to the commit message instead.
  - A new file under `frontend/src/components` or `frontend/src/pages` has to be covered by a page, or listed in `uncovered.txt` if users never see it.

Style:

- Speak to the reader ("you"). Use short sentences and plain words.
- Use the labels the app shows, in bold: **User Settings → Profiles**.
- Lead with what the reader wants to do. Put limits and fine print last.
- Add `> Tip:`, `> Note:`, `> Heads up:` or `> Admins:` callouts sparingly.
- Show keys as `<kbd>Ctrl</kbd>+<kbd>K</kbd>`. Mention the Mac key as well (`<kbd>⌘</kbd>`).
- Link to other pages as `[roles](server-roles#permissions)`. Broken links fail the build.
- Add screenshots as `![Caption](shot:name)`. `frontend/e2e/guide-shots.mjs` takes them with made-up people and messages on the test stack. Add a new shot there, then run it.

## Building

```bash
node scripts/guide-build.mjs            # docs/guide, docs/site and docs/i18n → website/ (commit both)
node scripts/guide-build.mjs --check    # what the commit hook runs
```

The website (`website/`) is published as it is, so commit the built pages as well. Its landing page is written in
`docs/site/index.html`; never edit `website/index.html` or anything under `website/<lang>/`, they are built.

## Every language

The website and the guide exist in every language the app speaks (the list in `frontend/src/lib/i18n.ts`):
`runparley.com/` and `runparley.com/guide/` in English, `runparley.com/de/`, `runparley.com/de/guide/` and so on for
the rest. **Every language is kept current**: the check fails while any page or string is missing or out of date in any
language, so a commit that changes an English page also updates its translations.

- **Guide pages**: `docs/guide/<lang>/<page>.md` (for example `docs/guide/pt-BR/messages.md`) translates
  `docs/guide/<page>.md`. Its front matter has only `title`, `section`, `summary` (translated) and `source`, the English
  page's version it was translated from: `node scripts/guide-build.mjs --sources` lists the current ones. Keep:
  - the same `##` and `###` headings, translated, in the same order and at the same levels (the build gives each one
    the English heading's anchor by position, so links work everywhere);
  - every link exactly as in English (`[translated text](page#heading)`), every `![translated caption](shot:name)`;
  - callouts with the English keyword: `> Tip: translated text`;
  - `<kbd>` keys, `code` and product names (Parley, Discord, Spotify, Docker) as they are.
  - Labels the app shows, in bold, must match the app in that language: look them up in
    `frontend/src/locales/<lang>.json` (keys are the English labels) and use exactly that translation.
- **The landing page and the guide's own words**: `docs/i18n/<lang>.json` maps each English string to its translation.
  `docs/i18n/keys.json` (built) lists every string. Keep the inline markup (`<strong>`, `<a href="…">`, `<code>`…) and
  `{placeholders}` exactly; translate the text around and inside them.
- `node scripts/guide-build.mjs --check --lang de` reports only one language's problems.

## Refreshing the screenshots

The screenshots are taken against the isolated test stack (see `frontend/e2e`):

```bash
cd frontend && PARLEY_API_ORIGIN=http://localhost:18090 PARLEY_WEB=http://localhost:5199 node e2e/guide-shots.mjs [name …]
```
