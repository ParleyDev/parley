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
node scripts/guide-build.mjs            # docs/guide → website/guide (commit both)
node scripts/guide-build.mjs --check    # what the commit hook runs
```

The website (`website/`) is published as it is, so commit the built pages as well.

## Refreshing the screenshots

The screenshots are taken against the isolated test stack (see `frontend/e2e`):

```bash
cd frontend && PARLEY_API_ORIGIN=http://localhost:18090 PARLEY_WEB=http://localhost:5199 node e2e/guide-shots.mjs [name …]
```
