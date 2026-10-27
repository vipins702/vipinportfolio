# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal portfolio site for Vipin Singh (AI & enterprise data consultant) with a built-in CMS,
lead capture, and appointment booking. One Node process serves the public page, the admin SPA, and
the JSON API. There is **no build step, no bundler, no framework, and no npm script other than
`start`** — the two HTML files are hand-written and ship as-is.

Stack: Node 22.13+ · Express 4 · `node:sqlite` (built-in) · vanilla HTML/CSS/JS.

## Commands

```bash
npm install          # express is the only runtime dependency
npm start            # node server.js — serves site + admin + API on one port
node verify.js       # ad-hoc assertion script; requires the server already running
```

`start.bat` (Windows, double-click) installs deps if missing, opens the browser, and starts the
server. There is **no test framework, no linter, and no typecheck** — `verify.js` is a hand-rolled
script that greps the served HTML for expected strings. It is **stale and currently fails 15 of its
21 checks** — it tests a design generation that no longer exists: it looks for Playfair Display, a
`translateY(-3px)` card hover, sidebar/login gradients, status pills, and the easing
`cubic-bezier(.16,1,.3,1)` (the site uses Apple's `cubic-bezier(.28,.11,.32,1)`). Two more fail only
because it requests `/admin`, which 302-redirects to `/admin/`, and it does not follow redirects.
Its Manrope and Instrument Serif assertions now pass — those fonts are gone. Treat `verify.js` as a
reminder, not a gate; it needs rewriting against the current design or deleting.

Endpoints after start: `http://localhost:3000` (site), `http://localhost:3000/admin` (CMS).

## Environment

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `DATA_DIR` | `./data` | Must be persistent storage in production |
| `ADMIN_EMAIL` | `admin@vsmtech.ai` | **First run only** — seeds the admin row |
| `ADMIN_PASSWORD` | `ChangeMe@123` | First run only; if unset, `must_change=1` forces a banner |
| `SITE_URL` | derived from request | Absolute origin for canonical/OG/sitemap URLs. **Set this in production** |
| `SMTP_HOST` / `SMTP_PORT` | — / `465` | Unset ⇒ mail is logged to `mail_log`, never sent |
| `SMTP_USER` / `SMTP_PASS` | — | Gmail needs an App Password, not the account password |
| `MAIL_FROM` | `SMTP_USER` | From address on outgoing mail |
| `NOTIFY_TO` | `SMTP_USER`, then `content.brand.email` | Where lead/booking alerts go |

There is no `.env` loading — export the variables in the shell or the process manager.

## Architecture

### Design tokens are generated, never hand-written

`public/tokens.css` is **generated** from `design-system/tokens.json`. Do not edit it:

```bash
node tools/gen-tokens.js design-system/tokens.json public/tokens.css
```

It is linked by `public/index.html`, by `shell()` in `server.js` (before `blog.css`) and by
`public/admin/index.html`. It emits a light `:root`, a `@media (prefers-color-scheme: dark)` block
guarded by `:root:not([data-theme="light"])`, an explicit `:root[data-theme="dark"]`, the spacing /
radius / measure / z-index scales, a class per type style, and `color-scheme` per theme so native
date pickers and selects follow the theme.

Both stylesheets previously declared the same variables by hand and had already drifted — `blog.css`
had `--blueText` and `index.html` did not, which is why a contrast fix existed on one page only.
**Neither file may declare a `:root` colour block again.** The old names (`--mute`, `--blue`,
`--lineD`, `--radius`…) still work: `tokens.css` ends with an alias block mapping them onto the new
tokens, so existing selectors were not rewritten wholesale.

Two accent tokens that are not interchangeable: `--accent` (`#0071e3`) is a **fill** only, and
`--accent-text` (`#0066cc`) is for **text** — `#0071e3` as text on the grey ground is 4.31:1 and
fails AA. Control borders use `--border-control` (3:1), not the decorative `--separator`.

The full brand book, the component guidelines and an audit of the design live in the Design System
artifact; `design-system/tokens.json` is the source of record for values.

### Everything is state in SQLite, including the page copy

`data/site.db` holds four tables. The important one is `kv`, a two-column JSON blob store:

- `kv['content']` — **the entire website copy** as one JSON document (seeded from
  `default-content.js`, shape documented in README). Editing the site means `PUT`ing this whole
  object back.
- `kv['settings']` — booking availability (`days`, `start`, `end`, `duration`, `horizon`).
- `kv['secret']` — HMAC key for session cookies, **generated on first run and stored in the DB**.
  Deleting `site.db` therefore invalidates every session *and* resets all content, leads, and
  appointments. There is no password-reset flow; the README's "delete the DB" advice destroys
  business data.

`users`, `leads`, and `appointments` are ordinary tables. `appointments` carries a partial unique
index `ux_slot ON (date, time) WHERE status != 'cancelled'` — this, not the application check, is
what actually prevents double-booking under a race.

### The public page renders itself from the API

`public/index.html` ships with **empty elements** (`<h1 id="h1"></h1>` etc.) and an IIFE that
fetches `/api/content` and populates every node by id. Consequences to keep in mind:

- Only `{{TITLE}}` and `{{DESC}}` are substituted server-side (in the `GET /` handler); everything
  else requires JS. A non-JS fetch of `/` yields ~350 characters of body text.
- Opening the file directly over `file://` is detected and replaced with a "server is not running"
  message — the page cannot work as a static file.
- To add a content field: add it to `default-content.js`, add a bound element in `index.html`, and
  bind it in the IIFE. The admin editor needs no change — it generates its form by walking the JSON
  (see below).

The hero is a **scroll-scrubbed canvas sequence**: 120 WebP frames in `public/frames/`, all
constructed eagerly in a loop at script start, drawn to `#cv` on scroll by mapping hero scroll
progress to a frame index. `CROP = .88` trims the bottom 12% of each source frame to remove a
generator watermark. The hero is `420vh` tall (`380vh` on mobile), so scroll progress drives both
the frame index and which of `content.hero.chapters` is shown in the headline.

### The admin CMS builds its form from the JSON shape

`public/admin/index.html` is a hash-routed SPA (`#dash`, `#leads`, `#appts`, `#content`,
`#settings`) with no framework. The content editor's `field(value, path, label)` recurses over the
content object and emits inputs keyed by dotted path (`services.items.0.title`); `setPath`/`getPath`
write back into a local copy, and **Save PUTs the whole document**. Arrays of strings become
newline-separated textareas; arrays of objects get Add/Remove controls that clone the shape of
element 0. A key matching `/photo|image/i` renders an upload widget.

This means **the editor needs no per-field code** — it adapts to whatever `default-content.js`
defines. Keep new content keys JSON-serializable and shallow-ish, and name image keys `photo` or
`image` so the uploader appears.

`LABELS` at the top of the content function controls which top-level keys get tabs and in what
order; a key absent from `LABELS` is unreachable in the UI even if it exists in the data.

### The blog is server-rendered; the homepage is not

This split is deliberate and load-bearing. `public/index.html` renders client-side from
`/api/content`, so a crawler sees ~350 characters. **The blog does not** — `/blog` and
`/blog/:slug` are generated in `server.js` by the `shell()` function and ship complete HTML with
per-page canonical, OG/Twitter tags and JSON-LD. LinkedIn's and Google's scrapers do not execute
JavaScript, so anything that needs to be indexed or produce a link preview **must** go through
`shell()`, not the client-side binder.

Also server-rendered: `/sitemap.xml`, `/rss.xml`, `/robots.txt`, the 404 handler, and
`/admin/preview/:id` (auth-gated, renders drafts). All are registered **before**
`express.static`.

Post bodies are a markdown subset implemented in `renderMarkdown()` — headings, lists,
blockquotes, fenced code, links, images, plus line-level embeds `@youtube`, `@tweet`,
`@linkedin`, `@gist`, `@repo`, `@link`. Everything is escaped via `he()` before markup is
applied, and `safeUrl()` rejects anything that is not `http(s):` or site-relative. When adding a
block type, add its prefix to `BLOCK_START` or paragraph-gobbling will swallow it.

`embedScripts(html)` emits third-party loaders **only when the rendered post contains that
embed** — a post with no tweet never loads X's widget script.

### Analytics

Cookieless and first-party. `track(req, path)` is called explicitly from `/`, `/blog` and
`/blog/:slug`. The visitor key is `HMAC(SECRET + today, ip + user-agent)` truncated to 24 chars —
it rotates daily and cannot be reversed, so there is no consent banner and nothing to delete.
Bots are dropped by a user-agent regex. Referrers are bucketed into named sources
(Google / LinkedIn / X…) by `sourceOf()`. `track()` is wrapped in try/catch because analytics
must never break a page render.

### Email

`sendMail()` **always writes a `mail_log` row first**, then attempts delivery and updates the
status. If SMTP is unconfigured the row is kept with status `not configured`, so nothing is
silently lost and the admin dashboard can show what would have been sent. Notifications are fired
*after* `res.json(...)` so a slow mail server never delays the visitor. Appointment
confirm/cancel mail is triggered via the `onStatus` callback on the `table()` helper.

### Auth

Signed-cookie sessions, no library: `sid = uid.expiry.hmac(uid.expiry, kv['secret'])`, 7-day
expiry, `HttpOnly; SameSite=Strict`, `Secure` only when `req.secure`. `auth` middleware re-reads the
user row on every request. Passwords are scrypt with a per-user random salt, compared with
`timingSafeEqual`. Note: changing a password does **not** invalidate existing sessions, and there is
no CSRF token (SameSite=Strict is the only defense).

The `table(route, name, statuses, cols)` helper at the bottom of the admin API section generates
list/patch/delete/CSV-export routes for a table in one call — use it rather than hand-writing CRUD
for a new collection.

## Conventions

- **Escape on output, always.** Both files define an `esc()` helper and all interpolation into
  `innerHTML` goes through it. The admin's `listPage` renderers and the public binder both rely on
  this; a new template string without `esc()` is an XSS hole, since lead/appointment text is
  attacker-controlled.
- Inputs are funneled through `clean(v, max)` (trim + length cap) before touching the DB.
- CSV export escapes leading `=+-@` to block formula injection — preserve this in new exports.
- Styles are a single `<style>` block per file using CSS custom properties on `:root`
  (`--ink`, `--gold`, `--paper`, …). The two files duplicate these tokens; changing a brand color
  means editing both.
- Uploads trust the `Content-Type` header to pick the extension and are written with random
  filenames to `public/uploads/`. Nothing sniffs the bytes.

## Encoding

Source files contain em dashes and arrows. **Never round-trip them through Windows PowerShell
5.1** — `Get-Content -Raw` decodes as ANSI, not UTF-8, and `Set-Content` then writes mojibake
across the whole file. Use the Edit/Write tools or Node for any scripted edit.

## Known gaps (do not assume these exist)

- **The homepage is still client-rendered** — ~350 chars to a crawler. Only the blog is
  server-rendered.
- 120 hero frames (~3.65 MB) are constructed eagerly in a loop at script start, unthrottled.
- No CMS versioning, draft state, or audit trail for site copy. Save publishes immediately;
  "Restore defaults" overwrites all copy behind a single `confirm()`. (Blog posts *do* have a
  draft state.)
- The in-memory rate limiter's `Map` is never evicted, and it resets on restart.
- No privacy policy page, though two forms collect personal data.
- No CSP or HSTS headers; `X-Powered-By: Express` is still advertised.
- Changing a password does not invalidate existing sessions; there is no password-reset flow.
- No favicon.
