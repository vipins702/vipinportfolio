// Vipin Singh — Portfolio + CMS. Developed by VSM Tech & AI Solutions Agency.
// Runs as a plain Node server (npm start) and as a Vercel function (api/index.js).
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./db');

const PORT = process.env.PORT || 3000;

// Route handlers are async, and Express 4 does not catch promise rejections on its own.
// A wraps a handler so a database error reaches the error handler instead of hanging.
const A = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- key/value store (content, settings, CRM metadata) ----------
const kvGet = async k => { const r = await db.one('SELECT v FROM kv WHERE k=?', [k]); return r ? JSON.parse(r.v) : null; };
const kvSet = (k, v) => db.run('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [k, JSON.stringify(v)]);

const CRM_DEFAULT = {
  stages: [
    { key: 'prospect', label: 'Prospect', color: '#6e6e73' },
    { key: 'qualified', label: 'Qualified', color: '#0071e3' },
    { key: 'proposal', label: 'Proposal', color: '#7c3aed' },
    { key: 'client', label: 'Client', color: '#15803d' },
    { key: 'dormant', label: 'Dormant', color: '#b45309' }
  ],
  fields: [
    { key: 'industry', label: 'Industry', type: 'select', options: ['Energy', 'Manufacturing', 'Banking & financial services', 'Retail & consumer', 'Public sector', 'Other'] },
    { key: 'programme', label: 'Programme type', type: 'select', options: ['Greenfield', 'Brownfield', 'Selective / carve-out', 'M&A consolidation', 'Platform integration'] },
    { key: 'target_platform', label: 'Target platform', type: 'text' },
    { key: 'source_systems', label: 'Source systems', type: 'number' },
    { key: 'deal_value', label: 'Estimated value', type: 'currency' },
    { key: 'linkedin', label: 'LinkedIn', type: 'url' },
    { key: 'next_step', label: 'Next step', type: 'textarea' }
  ],
  relTypes: ['Colleague', 'Reports to', 'Referred by', 'Decision maker for', 'Partner'],
  activityTypes: [{ key: 'note', label: 'Note' }, { key: 'call', label: 'Call' }, { key: 'email', label: 'Email' }, { key: 'meeting', label: 'Meeting' }],
  currency: 'USD'
};

// ---------- boot: create tables and seed once, before the first request is served ----------
let SECRET = null;
let booted = null;
function boot() {
  if (!booted) booted = (async () => {
    await db.init();
    if (!(await kvGet('content'))) await kvSet('content', require('./default-content.js'));
    if (!(await kvGet('settings'))) await kvSet('settings', { days: [1, 2, 3, 4, 5], start: '10:00', end: '18:00', duration: 30, horizon: 30 });
    if (!(await kvGet('crm'))) await kvSet('crm', CRM_DEFAULT);

    // The phone number is no longer published. Drop it from content saved before that,
    // or /api/content would keep serving it.
    const content = await kvGet('content');
    if (content?.brand && 'phone' in content.brand) { delete content.brand.phone; await kvSet('content', content); }

    // Starter articles, inserted once. See db/seed-posts.js.
    if (!(await kvGet('postsSeeded'))) {
      for (const p of require('./db/seed-posts.js'))
        await db.run(`INSERT INTO posts(slug,title,summary,body,cover,cover_alt,tags,status,published_at,
            seo_title,seo_description,keywords,canonical_url,featured,updated_at)
          VALUES(?,?,?,?,?,?,?,'published',CURRENT_TIMESTAMP,?,?,?,'',?,CURRENT_TIMESTAMP) ON CONFLICT (slug) DO NOTHING`,
          [p.slug, p.title, p.summary, p.body, p.cover, p.cover_alt, p.tags, p.seo_title, p.seo_description, p.keywords, !!p.featured]);
      await kvSet('postsSeeded', true);
    }

    // The session key comes from the environment. The database copy is only a fallback
    // for setups that have not set SESSION_SECRET yet.
    if (process.env.SESSION_SECRET) SECRET = process.env.SESSION_SECRET;
    else {
      let s = await kvGet('secret');
      if (!s) { s = crypto.randomBytes(32).toString('hex'); await kvSet('secret', s); }
      SECRET = s;
    }

    if (!(await kvGet('crmBackfilled'))) {
      for (const l of await db.all('SELECT * FROM leads ORDER BY id')) await linkToCustomer('lead', l);
      for (const a of await db.all('SELECT * FROM appointments ORDER BY id')) await linkToCustomer('appointment', a);
      await kvSet('crmBackfilled', true);
    }

    if (!(await db.one('SELECT 1 AS x FROM users'))) {
      const email = (process.env.ADMIN_EMAIL || 'admin@vsmtech.ai').toLowerCase();
      const pw = process.env.ADMIN_PASSWORD || 'ChangeMe@123';
      await db.run('INSERT INTO users(email,name,pass,must_change) VALUES(?,?,?,?)', [email, 'Admin', hash(pw), !process.env.ADMIN_PASSWORD]);
      console.log(`\n  First run — admin created:\n  Email: ${email}\n  Password: ${process.env.ADMIN_PASSWORD ? '(from ADMIN_PASSWORD)' : pw}\n`);
    }
  })().catch(e => { booted = null; throw e; }); // a failed boot is retried on the next request
  return booted;
}

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const verify = (pw, stored) => { const [salt, h] = stored.split(':'); const t = hash(pw, salt).split(':')[1]; return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(t, 'hex')); };

// ---------- session (signed cookie) ----------
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const makeToken = uid => { const p = uid + '.' + (Date.now() + 7 * 864e5); return p + '.' + sign(p); };
const readToken = t => { if (!t) return null; const [uid, exp, sig] = t.split('.'); if (!sig || sign(uid + '.' + exp) !== sig || +exp < Date.now()) return null; return +uid; };
const cookie = (req, n) => (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(c => c[0] === n)?.[1];
const auth = A(async (req, res, next) => {
  const uid = readToken(cookie(req, 'sid'));
  const u = uid && await db.one('SELECT id,email,name,must_change FROM users WHERE id=?', [uid]);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  req.user = u; next();
});

// ---------- helpers ----------
const rate = new Map();
const limit = (n, ms) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now(), a = (rate.get(k) || []).filter(t => now - t < ms);
  if (a.length >= n) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
  a.push(now); rate.set(k, a); next();
};
const clean = (v, max = 1000) => String(v ?? '').trim().slice(0, max);
const isEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const pad = n => String(n).padStart(2, '0');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

async function slotsFor(date) {
  if (!isDay(date)) return [];
  const s = await kvGet('settings'), d = new Date(date + 'T00:00:00');
  if (isNaN(d)) return [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = (d - today) / 864e5;
  if (days < 0 || days > s.horizon || !s.days.includes(d.getDay())) return [];
  const taken = new Set((await db.all("SELECT time FROM appointments WHERE date=? AND status!='cancelled'", [date])).map(r => r.time));
  const out = [], now = new Date();
  for (let m = toMin(s.start); m + s.duration <= toMin(s.end); m += s.duration) {
    const t = fromMin(m);
    const past = days === 0 && new Date(date + 'T' + t + ':00') < new Date(now.getTime() + 36e5);
    if (!taken.has(t) && !past) out.push(t);
  }
  return out;
}

// ---------- email ----------
// Credentials come from the environment only — nothing is stored in the repo or the database.
// Gmail: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=you@gmail.com SMTP_PASS=<16-char app password>
// Without SMTP_HOST the site still works; notifications are recorded in the mail_log table instead.
const MAIL = {
  host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || process.env.SMTP_USER
};
// Where your alerts go. Falls back to the contact address in the CMS, so it is
// correct out of the box and changes when you change it in Admin → Brand & contact.
const notifyTo = async () => process.env.NOTIFY_TO || process.env.SMTP_USER || ((await kvGet('content'))?.brand?.email || '');
const mailer = MAIL.host && MAIL.user && MAIL.pass
  ? nodemailer.createTransport({ host: MAIL.host, port: MAIL.port, secure: MAIL.port === 465, auth: { user: MAIL.user, pass: MAIL.pass } })
  : null;

// Never rejects: a mail problem must not fail the visitor's submission.
async function sendMail({ to, subject, text, replyTo }) {
  try {
    const { rows } = await db.run('INSERT INTO mail_log(to_addr,subject,body,status) VALUES(?,?,?,?) RETURNING id',
      [to || '', subject, text, mailer ? 'sending' : 'not configured']);
    const id = rows[0].id;
    if (!mailer) return false;
    try {
      await mailer.sendMail({ from: MAIL.from, to, subject, text, replyTo });
      await db.run("UPDATE mail_log SET status='sent' WHERE id=?", [id]);
      return true;
    } catch (e) {
      await db.run('UPDATE mail_log SET status=? WHERE id=?', ['failed: ' + e.message.slice(0, 180), id]);
      console.error('mail failed:', e.message);
      return false;
    }
  } catch (e) {
    console.error('mail log failed:', e.message);
    return false;
  }
}

// ---------- analytics ----------
// Cookieless. The visitor id is a daily-rotating salted hash, so it cannot be reversed
// to an IP and cannot follow anyone across days. No consent banner needed.
const SOURCES = [
  [/google\./i, 'Google'], [/bing\./i, 'Bing'], [/duckduckgo/i, 'DuckDuckGo'],
  [/linkedin\.|lnkd\.in/i, 'LinkedIn'], [/(twitter|x)\.com|t\.co/i, 'X / Twitter'],
  [/facebook\.|fb\.me/i, 'Facebook'], [/youtube\.|youtu\.be/i, 'YouTube'],
  [/reddit\./i, 'Reddit'], [/github\./i, 'GitHub']
];
const sourceOf = ref => {
  if (!ref) return 'Direct';
  const hit = SOURCES.find(([re]) => re.test(ref));
  if (hit) return hit[1];
  try { return new URL(ref).hostname.replace(/^www\./, ''); } catch { return 'Other'; }
};
const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|monitor|curl|wget|python-requests|axios|postman/i;
const visitorId = req => crypto.createHmac('sha256', SECRET + new Date().toISOString().slice(0, 10))
  .update((req.ip || '') + '|' + (req.get('user-agent') || '')).digest('hex').slice(0, 24);

// Fire-and-forget: a slow or failing write must never delay a page.
function track(req, pathName) {
  try {
    const ua = req.get('user-agent') || '';
    if (BOT.test(ua)) return;
    const ref = req.get('referer') || '';
    let sameHost = false;
    try { sameHost = new URL(ref).host === req.get('host'); } catch { }
    db.run('INSERT INTO pageviews(path,source,referrer,visitor,device,day) VALUES(?,?,?,?,?,?)', [
      pathName.slice(0, 200), sameHost ? 'Internal' : sourceOf(ref), ref.slice(0, 300),
      visitorId(req), /Mobile|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop',
      new Date().toISOString().slice(0, 10)]).catch(() => {});
  } catch (e) { /* analytics must never break a page render */ }
}

// ---------- blog: slugs, markdown subset, embeds ----------
const slugify = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const he = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// only http(s) and site-relative URLs survive — blocks javascript:/data: in authored links
const safeUrl = u => /^(https?:\/\/|\/)[^\s"']*$/i.test(String(u || '').trim());
const ytId = u => { const m = String(u).match(/(?:v=|youtu\.be\/|embed\/|shorts\/|^)([\w-]{11})(?:\S*)?$/); return m ? m[1] : null; };

function mdInline(t) {
  t = he(t);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, u) => safeUrl(u) ? `<img src="${u}" alt="${alt}" loading="lazy" decoding="async">` : '');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, u) => safeUrl(u)
    ? `<a href="${u}"${/^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : ''}>${txt}</a>` : txt);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return t;
}

const BLOCK_START = /^(```|#{1,4}\s|>\s?|[-*]\s+|\d+[.)]\s+|@(?:youtube|tweet|linkedin|gist|repo|link)\(|---+\s*$)/;

function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = []; let i = 0, m;
  while (i < lines.length) {
    const L = lines[i];
    if (/^\s*$/.test(L)) { i++; continue; }

    if (/^```/.test(L)) {                                     // fenced code — git snippets
      const lang = L.slice(3).trim(), buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<figure class="code">${lang ? `<figcaption>${he(lang)}</figcaption>` : ''}<pre><code>${he(buf.join('\n'))}</code></pre></figure>`);
      continue;
    }
    if (m = L.match(/^@youtube\((.+)\)\s*$/)) {               // privacy-mode YouTube
      const id = ytId(m[1].trim()); i++;
      if (id) out.push(`<figure class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${he(id)}" title="YouTube video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></figure>`);
      continue;
    }
    if (m = L.match(/^@tweet\((.+)\)\s*$/)) {                 // real X embed; widgets.js is loaded once, only if a tweet is present
      const u = m[1].trim(); i++;
      if (/^https:\/\/(twitter\.com|x\.com)\//i.test(u))
        out.push(`<figure class="embed-x"><blockquote class="twitter-tweet" data-dnt="true"><a href="${he(u)}">${he(u)}</a></blockquote>
<noscript><a class="card-link" href="${he(u)}" target="_blank" rel="noopener"><span class="k">Post on X</span><span class="u">${he(u.replace(/^https?:\/\//, ''))}</span></a></noscript></figure>`);
      continue;
    }
    if (m = L.match(/^@linkedin\((.+)\)\s*$/)) {              // LinkedIn's own embed iframe
      const u = m[1].trim(); i++;
      const id = (u.match(/([0-9]{10,})/) || [])[1];
      if (id) out.push(`<figure class="embed-li"><iframe src="https://www.linkedin.com/embed/feed/update/urn:li:share:${he(id)}" title="LinkedIn post" loading="lazy" frameborder="0" allowfullscreen></iframe></figure>`);
      else if (safeUrl(u)) out.push(`<a class="card-link" href="${he(u)}" target="_blank" rel="noopener"><span class="k">LinkedIn post</span><span class="u">${he(u.replace(/^https?:\/\//, ''))}</span></a>`);
      continue;
    }
    if (m = L.match(/^@gist\((.+)\)\s*$/)) {
      const u = m[1].trim(); i++;
      if (/^https:\/\/gist\.github\.com\//i.test(u)) out.push(`<figure class="embed-gist" data-gist="${he(u)}"><a class="card-link repo" href="${he(u)}" target="_blank" rel="noopener"><span class="k">GitHub gist</span><span class="u">${he(u.replace(/^https?:\/\//, ''))}</span></a></figure>`);
      continue;
    }
    if (m = L.match(/^@(repo|link)\((.+)\)\s*$/)) {
      const kind = m[1], u = m[2].trim(); i++;
      if (safeUrl(u)) out.push(`<a class="card-link ${kind}" href="${he(u)}" target="_blank" rel="noopener"><span class="k">${kind === 'repo' ? 'Repository' : 'Link'}</span><span class="u">${he(u.replace(/^https?:\/\//, ''))}</span></a>`);
      continue;
    }
    // the post title is the page's only h1, so body headings start at h2
    if (m = L.match(/^(#{1,4})\s+(.*)$/)) { const n = Math.max(2, Math.min(m[1].length, 4)); out.push(`<h${n} id="${slugify(m[2])}">${mdInline(m[2])}</h${n}>`); i++; continue; }
    if (/^---+\s*$/.test(L)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(L)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${mdInline(buf.join(' '))}</blockquote>`); continue; }
    if (/^[-*]\s+/.test(L)) { const buf = []; while (i < lines.length && /^[-*]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^[-*]\s+/, '')); out.push(`<ul>${buf.map(x => `<li>${mdInline(x)}</li>`).join('')}</ul>`); continue; }
    if (/^\d+[.)]\s+/.test(L)) { const buf = []; while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\d+[.)]\s+/, '')); out.push(`<ol>${buf.map(x => `<li>${mdInline(x)}</li>`).join('')}</ol>`); continue; }

    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i])) buf.push(lines[i++]);
    const html = mdInline(buf.join(' '));
    out.push(/^<img/.test(html) ? `<figure class="img">${html}</figure>` : `<p>${html}</p>`);
  }
  return out.join('\n');
}

const stripMd = s => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/@\w+\([^)]*\)/g, ' ')
  .replace(/[#>*`_]|\[|\]|\(https?:[^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
const readMins = s => Math.max(1, Math.round(stripMd(s).split(' ').filter(Boolean).length / 200));
const origin = req => process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
const niceDate = d => d ? new Date(String(d).replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
// timestamps are stored as "YYYY-MM-DD HH:MM:SS" UTC; schema.org and RSS need real ISO 8601
const isoDate = d => d ? new Date(String(d).replace(' ', 'T') + 'Z').toISOString() : undefined;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); next(); });
// Every request waits for boot, so the tables exist and the session key is loaded.
app.use(A(async (req, res, next) => { await boot(); next(); }));

// ---------- public API ----------
app.get('/api/content', A(async (req, res) => res.json(await kvGet('content'))));
app.get('/api/slots', A(async (req, res) => res.json({ slots: await slotsFor(clean(req.query.date, 10)), duration: (await kvGet('settings')).duration })));

app.post('/api/leads', limit(5, 10 * 60e3), A(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot
  const l = { name: clean(b.name, 120), email: clean(b.email, 160), phone: clean(b.phone, 40), company: clean(b.company, 120), service: clean(b.service, 120), message: clean(b.message, 3000) };
  if (!l.name || !isEmail(l.email) || !l.message) return res.status(400).json({ error: 'Please add your name, a valid email and a short message.' });
  const { rows } = await db.run('INSERT INTO leads(name,email,phone,company,service,message,source) VALUES(?,?,?,?,?,?,?) RETURNING id',
    [l.name, l.email, l.phone, l.company, l.service, l.message, 'contact form']);
  // Awaited, not fired after the response: a serverless function can be frozen once it
  // responds, so work left running in the background may never complete.
  await linkSafely('lead', 'leads', rows[0].id);
  await sendMail({
    to: await notifyTo(), replyTo: l.email, subject: `New enquiry from ${l.name}${l.company ? ' (' + l.company + ')' : ''}`,
    text: `${l.name} sent a message through your website.\n\nEmail:   ${l.email}\nPhone:   ${l.phone || '—'}\nCompany: ${l.company || '—'}\nTopic:   ${l.service || '—'}\n\n${l.message}\n\n— Reply directly to this email to answer them.`
  });
  await sendMail({
    to: l.email, subject: 'Thanks — your message reached Vipin Singh',
    text: `Hi ${l.name},\n\nThank you for getting in touch. Your message has arrived and you will get a reply within one business day.\n\nFor reference, this is what you sent:\n\n${l.message}\n\n— Vipin Singh\nSAP Data Migration Strategy & Syniti ADMM Architecture`
  });
  res.json({ ok: true });
}));

app.post('/api/appointments', limit(5, 10 * 60e3), A(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true });
  const a = { name: clean(b.name, 120), email: clean(b.email, 160), phone: clean(b.phone, 40), topic: clean(b.topic, 120), mode: clean(b.mode, 40), date: clean(b.date, 10), time: clean(b.time, 5), message: clean(b.message, 2000) };
  if (!a.name || !isEmail(a.email) || !a.date || !a.time) return res.status(400).json({ error: 'Please add your name, a valid email, a date and a time.' });
  if (!(await slotsFor(a.date)).includes(a.time)) return res.status(409).json({ error: 'That time is no longer available. Please pick another slot.' });
  let row;
  try {
    // The partial unique index ux_slot is what actually stops a double booking under a race.
    ({ rows: [row] } = await db.run('INSERT INTO appointments(name,email,phone,topic,mode,date,time,message) VALUES(?,?,?,?,?,?,?,?) RETURNING id',
      [a.name, a.email, a.phone, a.topic, a.mode, a.date, a.time, a.message]));
  } catch { return res.status(409).json({ error: 'That time was just taken. Please pick another slot.' }); }
  await linkSafely('appointment', 'appointments', row.id);
  const when = `${a.date} at ${a.time}`;
  await sendMail({
    to: await notifyTo(), replyTo: a.email, subject: `Call request — ${a.name}, ${when}`,
    text: `${a.name} requested a call.\n\nWhen:   ${when}\nFormat: ${a.mode || '—'}\nTopic:  ${a.topic || '—'}\nEmail:  ${a.email}\nPhone:  ${a.phone || '—'}\n\n${a.message || '(no notes)'}\n\nConfirm or cancel it in your admin panel.`
  });
  await sendMail({
    to: a.email, subject: `Call request received — ${when}`,
    text: `Hi ${a.name},\n\nYour request for ${when} has been received. Vipin will confirm by email shortly.\n\nFormat: ${a.mode || '—'}\nTopic:  ${a.topic || '—'}\n\nIf you need to change the time, just reply to this email.\n\n— Vipin Singh\nSAP Data Migration Strategy & Syniti ADMM Architecture`
  });
  res.json({ ok: true });
}));

// ---------- Customer 360 (CRM) ----------
// The CRM's shape — pipeline stages, custom profile fields, relationship and activity
// types — is metadata in kv('crm'), editable in Admin → Customers → Setup. Screens and
// validation are driven from it, so adding a field or a stage needs no code change.
const CRM_FIELD_TYPES = ['text', 'textarea', 'number', 'currency', 'date', 'url', 'select'];
const crmMeta = () => kvGet('crm');
const slugKey = s => clean(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const firstStage = async () => (await crmMeta()).stages[0].key;

async function crmActivity(customerId, type, title, body = '', refKind = null, refId = null, at = nowSql()) {
  await db.run('INSERT INTO activities(customer_id,type,title,body,ref_kind,ref_id,created_at) VALUES(?,?,?,?,?,?,?)', [customerId, type, title, body, refKind, refId, at]);
  await db.run('UPDATE customers SET last_touch=GREATEST(COALESCE(last_touch, ?), ?) WHERE id=?', [at, at, customerId]);
}

// One person = one customer, matched on email. Every enquiry and booking is attached
// to that customer and lands on their timeline; blank profile fields are filled, never overwritten.
async function linkToCustomer(kind, r) {
  const email = clean(r.email, 160).toLowerCase();
  if (!email) return null;
  const found = await db.one('SELECT id FROM customers WHERE email=?', [email]);
  let cid = found?.id;
  if (!cid) {
    const { rows } = await db.run('INSERT INTO customers(name,email,phone,company,stage,source,created_at) VALUES(?,?,?,?,?,?,?) RETURNING id',
      [r.name, email, r.phone || null, r.company || null, await firstStage(), kind === 'lead' ? 'Contact form' : 'Booking', r.created_at || nowSql()]);
    cid = rows[0].id;
  } else {
    await db.run("UPDATE customers SET phone=COALESCE(NULLIF(phone,''),?), company=COALESCE(NULLIF(company,''),?) WHERE id=?", [r.phone || null, r.company || null, cid]);
  }
  const link = await db.run('INSERT INTO customer_links(customer_id,kind,ref_id) VALUES(?,?,?) ON CONFLICT (kind, ref_id) DO NOTHING RETURNING id', [cid, kind, r.id]);
  if (!link.rows.length) return cid;   // already linked: nothing new to log
  if (kind === 'lead') await crmActivity(cid, 'lead', `Enquiry${r.service ? ' — ' + r.service : ''}`, r.message, 'lead', r.id, r.created_at);
  else await crmActivity(cid, 'appointment', `Call requested for ${r.date} at ${r.time}`, [r.topic, r.mode, r.message].filter(Boolean).join(' · '), 'appointment', r.id, r.created_at);
  return cid;
}
async function linkSafely(kind, table, id) {
  try { await linkToCustomer(kind, await db.one(`SELECT * FROM ${table} WHERE id=?`, [id])); }
  catch (e) { console.error('CRM link failed:', e.message); } // never fail the visitor's submission over the CRM
}

function cleanMeta(b) {
  const seen = new Set(), uniq = k => !k.endsWith(':') && !seen.has(k) && seen.add(k);
  const stages = (Array.isArray(b.stages) ? b.stages : []).map(s => ({
    key: slugKey(s.key || s.label), label: clean(s.label, 40),
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : '#6e6e73'
  })).filter(s => s.label && uniq('s:' + s.key));
  const fields = (Array.isArray(b.fields) ? b.fields : []).map(f => ({
    key: slugKey(f.key || f.label), label: clean(f.label, 60),
    type: CRM_FIELD_TYPES.includes(f.type) ? f.type : 'text',
    ...(f.type === 'select' ? { options: (Array.isArray(f.options) ? f.options : []).map(o => clean(o, 80)).filter(Boolean).slice(0, 40) } : {})
  })).filter(f => f.label && uniq('f:' + f.key));
  const list = (a, n) => [...new Set((Array.isArray(a) ? a : []).map(x => clean(x, n)).filter(Boolean))].slice(0, 30);
  const activityTypes = (Array.isArray(b.activityTypes) ? b.activityTypes : []).map(t => ({ key: slugKey(t.key || t.label), label: clean(t.label, 30) }))
    .filter(t => t.label && !['lead', 'appointment', 'stage', 'task', 'system'].includes(t.key) && uniq('a:' + t.key));
  return { stages, fields, relTypes: list(b.relTypes, 40), activityTypes, currency: /^[A-Z]{3}$/.test(b.currency) ? b.currency : 'USD' };
}

// Profile values are kept only for fields the metadata defines, coerced to the field's type.
function cleanFieldValues(input, defs) {
  const out = {};
  for (const f of defs) {
    let v = input?.[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number' || f.type === 'currency') { v = Number(v); if (!Number.isFinite(v)) continue; }
    else if (f.type === 'select') { v = clean(v, 80); if (!f.options.includes(v)) continue; }
    else if (f.type === 'url') { v = clean(v, 400); if (!/^https?:\/\//i.test(v)) v = 'https://' + v; }
    else if (f.type === 'date') { v = clean(v, 10); if (!isDay(v)) continue; }
    else v = clean(v, f.type === 'textarea' ? 4000 : 300);
    out[f.key] = v;
  }
  return out;
}

// ---------- admin API ----------
app.post('/api/admin/login', limit(8, 10 * 60e3), A(async (req, res) => {
  const u = await db.one('SELECT * FROM users WHERE email=?', [clean(req.body.email, 160).toLowerCase()]);
  if (!u || !verify(clean(req.body.password, 200), u.pass)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.set('Set-Cookie', `sid=${makeToken(u.id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
}));
app.post('/api/admin/logout', (req, res) => { res.set('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/admin/me', auth, (req, res) => res.json(req.user));

// ---------- CRM API ----------
const PRIORITIES = ['low', 'normal', 'high'];
const getCustomer = id => db.one('SELECT * FROM customers WHERE id=?', [id]);
const need = (res, row, what = 'That customer') => row || (res.status(404).json({ error: `${what} no longer exists.` }), null);

app.get('/api/admin/crm/meta', auth, A(async (req, res) => res.json(await crmMeta())));
app.put('/api/admin/crm/meta', auth, A(async (req, res) => {
  const m = cleanMeta(req.body || {});
  if (!m.stages.length) return res.status(400).json({ error: 'Keep at least one pipeline stage.' });
  if (!m.activityTypes.length) return res.status(400).json({ error: 'Keep at least one activity type.' });
  // customers sitting in a removed stage move to the first stage rather than becoming invisible
  const keys = m.stages.map(s => s.key);
  await db.run(`UPDATE customers SET stage=? WHERE stage IS NULL OR stage NOT IN (${keys.map(() => '?').join(',')})`, [keys[0], ...keys]);
  await kvSet('crm', m); res.json(m);
}));

app.get('/api/admin/crm/customers', auth, A(async (req, res) => {
  const q = clean(req.query.q, 100).toLowerCase(), stage = clean(req.query.stage, 60);
  const where = [], args = [];
  if (q) { where.push("(lower(c.name) LIKE ? OR c.email LIKE ? OR lower(COALESCE(c.company,'')) LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (stage) { where.push('c.stage=?'); args.push(stage); }
  const today = isDay(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10); // the admin's local date
  const rows = await db.all(`SELECT c.id,c.name,c.email,c.company,c.title,c.stage,c.owner,c.source,c.last_touch,c.created_at,
      (SELECT COUNT(*) FROM tasks t WHERE t.customer_id=c.id AND t.done_at IS NULL) open_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.customer_id=c.id AND t.done_at IS NULL AND t.due<?) overdue,
      (SELECT COUNT(*) FROM customer_links k WHERE k.customer_id=c.id AND k.kind='lead') enquiries,
      (SELECT COUNT(*) FROM customer_links k WHERE k.customer_id=c.id AND k.kind='appointment') bookings
    FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(c.last_touch,c.created_at) DESC LIMIT 500`, [today, ...args]);
  const stages = Object.fromEntries((await db.all('SELECT stage, COUNT(*) n FROM customers GROUP BY stage')).map(r => [r.stage, r.n]));
  const agenda = await db.all(`SELECT t.id,t.title,t.due,t.priority,t.customer_id,c.name customer FROM tasks t JOIN customers c ON c.id=t.customer_id
    WHERE t.done_at IS NULL ORDER BY t.due IS NULL, t.due, t.id LIMIT 8`);
  res.json({ customers: rows, stages, total: (await db.one('SELECT COUNT(*) n FROM customers')).n, agenda });
}));

app.post('/api/admin/crm/customers', auth, A(async (req, res) => {
  const b = req.body || {}, m = await crmMeta();
  const c = { name: clean(b.name, 120), email: clean(b.email, 160).toLowerCase() || null, phone: clean(b.phone, 40), company: clean(b.company, 120), title: clean(b.title, 120) };
  if (!c.name) return res.status(400).json({ error: 'A name is required.' });
  if (c.email && !isEmail(c.email)) return res.status(400).json({ error: 'That email address does not look right.' });
  if (c.email && await db.one('SELECT 1 FROM customers WHERE email=?', [c.email])) return res.status(409).json({ error: 'A customer with that email already exists.' });
  const stage = m.stages.some(s => s.key === b.stage) ? b.stage : await firstStage();
  const { rows } = await db.run('INSERT INTO customers(name,email,phone,company,title,stage,owner,source) VALUES(?,?,?,?,?,?,?,?) RETURNING id',
    [c.name, c.email, c.phone, c.company, c.title, stage, req.user.name || req.user.email, 'Added manually']);
  await crmActivity(rows[0].id, 'system', 'Customer created', `Added by ${req.user.email}`);
  res.json({ id: rows[0].id });
}));

// the 360 view: profile, every enquiry and booking, timeline, tasks and relationships in one response
app.get('/api/admin/crm/customers/:id', auth, A(async (req, res) => {
  const c = need(res, await getCustomer(+req.params.id)); if (!c) return;
  const links = await db.all('SELECT kind, ref_id FROM customer_links WHERE customer_id=?', [c.id]);
  const ids = k => links.filter(l => l.kind === k).map(l => l.ref_id);
  const pick = (table, list) => list.length ? db.all(`SELECT * FROM ${table} WHERE id IN (${list.map(() => '?').join(',')}) ORDER BY id DESC`, list) : [];
  const relationships = await db.all(`
    SELECT r.id, r.type, r.note, 'out' AS dir, o.id AS other_id, o.name AS other_name, o.company AS other_company, o.stage AS other_stage FROM relationships r JOIN customers o ON o.id=r.to_id WHERE r.from_id=?
    UNION ALL
    SELECT r.id, r.type, r.note, 'in', o.id, o.name, o.company, o.stage FROM relationships r JOIN customers o ON o.id=r.from_id WHERE r.to_id=?
    ORDER BY 1 DESC`, [c.id, c.id]);
  res.json({
    customer: { ...c, fields: JSON.parse(c.fields || '{}') },
    leads: await pick('leads', ids('lead')), appointments: await pick('appointments', ids('appointment')),
    activities: await db.all('SELECT * FROM activities WHERE customer_id=? ORDER BY created_at DESC, id DESC LIMIT 300', [c.id]),
    tasks: await db.all('SELECT * FROM tasks WHERE customer_id=? ORDER BY done_at IS NOT NULL, due IS NULL, due, id', [c.id]),
    relationships,
    others: await db.all('SELECT id,name,company FROM customers WHERE id!=? ORDER BY name LIMIT 1000', [c.id]),
    meta: await crmMeta()
  });
}));

app.patch('/api/admin/crm/customers/:id', auth, A(async (req, res) => {
  const c = need(res, await getCustomer(+req.params.id)); if (!c) return;
  const b = req.body || {}, m = await crmMeta(), next = {};
  for (const [k, n] of [['name', 120], ['phone', 40], ['company', 120], ['title', 120], ['owner', 120]]) if (k in b) next[k] = clean(b[k], n);
  if ('name' in next && !next.name) return res.status(400).json({ error: 'A name is required.' });
  if ('email' in b) {
    const e = clean(b.email, 160).toLowerCase();
    if (e && !isEmail(e)) return res.status(400).json({ error: 'That email address does not look right.' });
    if (e && await db.one('SELECT 1 FROM customers WHERE email=? AND id!=?', [e, c.id])) return res.status(409).json({ error: 'Another customer already uses that email.' });
    next.email = e || null;
  }
  if ('stage' in b) {
    const s = m.stages.find(x => x.key === b.stage);
    if (!s) return res.status(400).json({ error: 'Unknown stage.' });
    if (b.stage !== c.stage) {
      const from = m.stages.find(x => x.key === c.stage)?.label || 'None';
      await crmActivity(c.id, 'stage', `Stage changed: ${from} → ${s.label}`);
    }
    next.stage = b.stage;
  }
  if ('fields' in b) next.fields = JSON.stringify(cleanFieldValues(b.fields, m.fields));
  const keys = Object.keys(next);
  if (keys.length) await db.run(`UPDATE customers SET ${keys.map(k => k + '=?').join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [...keys.map(k => next[k]), c.id]);
  res.json({ ok: true });
}));

app.delete('/api/admin/crm/customers/:id', auth, A(async (req, res) => {
  await db.run('DELETE FROM customers WHERE id=?', [+req.params.id]); res.json({ ok: true });
}));

app.post('/api/admin/crm/customers/:id/activities', auth, A(async (req, res) => {
  const c = need(res, await getCustomer(+req.params.id)); if (!c) return;
  const b = req.body || {}, t = (await crmMeta()).activityTypes.find(x => x.key === b.type);
  if (!t) return res.status(400).json({ error: 'Unknown activity type.' });
  const body = clean(b.body, 8000);
  if (!body) return res.status(400).json({ error: 'Write a few words about it first.' });
  await crmActivity(c.id, t.key, clean(b.title, 200) || t.label, body);
  res.json({ ok: true });
}));
// only notes you logged can be removed — enquiries, bookings and stage history are the audit trail
app.delete('/api/admin/crm/activities/:id', auth, A(async (req, res) => {
  const custom = (await crmMeta()).activityTypes.map(t => t.key);
  const a = await db.one('SELECT type FROM activities WHERE id=?', [+req.params.id]);
  if (a && !custom.includes(a.type)) return res.status(400).json({ error: 'System history cannot be deleted.' });
  await db.run('DELETE FROM activities WHERE id=?', [+req.params.id]); res.json({ ok: true });
}));

app.post('/api/admin/crm/customers/:id/tasks', auth, A(async (req, res) => {
  const c = need(res, await getCustomer(+req.params.id)); if (!c) return;
  const b = req.body || {}, title = clean(b.title, 200), due = isDay(b.due) ? b.due : null;
  if (!title) return res.status(400).json({ error: 'Give the task a title.' });
  const { rows } = await db.run('INSERT INTO tasks(customer_id,title,notes,due,priority) VALUES(?,?,?,?,?) RETURNING id',
    [c.id, title, clean(b.notes, 2000), due, PRIORITIES.includes(b.priority) ? b.priority : 'normal']);
  res.json({ id: rows[0].id });
}));
app.patch('/api/admin/crm/tasks/:id', auth, A(async (req, res) => {
  const t = need(res, await db.one('SELECT * FROM tasks WHERE id=?', [+req.params.id]), 'That task'); if (!t) return;
  const b = req.body || {}, next = {};
  if ('title' in b) { next.title = clean(b.title, 200); if (!next.title) return res.status(400).json({ error: 'Give the task a title.' }); }
  if ('due' in b) next.due = isDay(b.due) ? b.due : null;
  if ('priority' in b && PRIORITIES.includes(b.priority)) next.priority = b.priority;
  if ('done' in b) {
    next.done_at = b.done ? nowSql() : null;
    if (b.done && !t.done_at) await crmActivity(t.customer_id, 'task', `Completed: ${t.title}`);
  }
  const keys = Object.keys(next);
  if (keys.length) await db.run(`UPDATE tasks SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, [...keys.map(k => next[k]), t.id]);
  res.json({ ok: true });
}));
app.delete('/api/admin/crm/tasks/:id', auth, A(async (req, res) => { await db.run('DELETE FROM tasks WHERE id=?', [+req.params.id]); res.json({ ok: true }); }));

app.post('/api/admin/crm/customers/:id/relationships', auth, A(async (req, res) => {
  const c = need(res, await getCustomer(+req.params.id)); if (!c) return;
  const b = req.body || {}, other = await getCustomer(+b.to_id), type = clean(b.type, 40);
  if (!other || other.id === c.id) return res.status(400).json({ error: 'Choose another customer to link to.' });
  if (!(await crmMeta()).relTypes.includes(type)) return res.status(400).json({ error: 'Unknown relationship type.' });
  const r = await db.run('INSERT INTO relationships(from_id,to_id,type,note) VALUES(?,?,?,?) ON CONFLICT (from_id,to_id,type) DO NOTHING RETURNING id',
    [c.id, other.id, type, clean(b.note, 300)]);
  if (!r.changes) return res.status(409).json({ error: 'That relationship already exists.' });
  await crmActivity(c.id, 'system', `Linked: ${type} ${other.name}`);
  res.json({ ok: true });
}));
app.delete('/api/admin/crm/relationships/:id', auth, A(async (req, res) => { await db.run('DELETE FROM relationships WHERE id=?', [+req.params.id]); res.json({ ok: true }); }));

app.get('/api/admin/stats', auth, A(async (req, res) => {
  const q = async s => (await db.one(s)).c;
  const days = Math.min(90, Math.max(7, +req.query.days || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  // the admin's local date, so "upcoming" matches what they see on their clock
  const today = isDay(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  // fill every day in the window so the chart has no gaps
  const byDay = Object.fromEntries((await db.all('SELECT day, COUNT(*) c, COUNT(DISTINCT visitor) v FROM pageviews WHERE day>=? GROUP BY day', [since])).map(r => [r.day, r]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    series.push({ day: d, views: byDay[d]?.c || 0, visitors: byDay[d]?.v || 0 });
  }
  res.json({
    leads: await q('SELECT COUNT(*) c FROM leads'), newLeads: await q("SELECT COUNT(*) c FROM leads WHERE status='new'"),
    appts: await q('SELECT COUNT(*) c FROM appointments'), pending: await q("SELECT COUNT(*) c FROM appointments WHERE status='pending'"),
    posts: await q("SELECT COUNT(*) c FROM posts WHERE status='published'"),
    upcoming: await db.all("SELECT * FROM appointments WHERE status!='cancelled' AND date>=? ORDER BY date,time LIMIT 5", [today]),
    recent: await db.all('SELECT * FROM leads ORDER BY id DESC LIMIT 5'),
    traffic: {
      days,
      views: (await db.one('SELECT COUNT(*) c FROM pageviews WHERE day>=?', [since])).c,
      visitors: (await db.one('SELECT COUNT(DISTINCT visitor) c FROM pageviews WHERE day>=?', [since])).c,
      allTime: await q('SELECT COUNT(*) c FROM pageviews'),
      series,
      sources: await db.all("SELECT source k, COUNT(*) c, COUNT(DISTINCT visitor) v FROM pageviews WHERE day>=? AND source!='Internal' GROUP BY source ORDER BY c DESC LIMIT 10", [since]),
      pages: await db.all('SELECT path k, COUNT(*) c, COUNT(DISTINCT visitor) v FROM pageviews WHERE day>=? GROUP BY path ORDER BY c DESC LIMIT 10', [since]),
      devices: await db.all('SELECT device k, COUNT(*) c FROM pageviews WHERE day>=? GROUP BY device', [since])
    },
    mail: {
      configured: !!mailer, to: (await notifyTo()) || null,
      recent: await db.all('SELECT id,to_addr,subject,status,created_at FROM mail_log ORDER BY id DESC LIMIT 8')
    }
  });
}));

// lets you prove delivery works without filling in the public form
app.post('/api/admin/mail-test', auth, A(async (req, res) => {
  if (!mailer) return res.status(400).json({ error: 'Email is not configured yet. Set SMTP_HOST, SMTP_USER and SMTP_PASS, then redeploy.' });
  const to = await notifyTo();
  const ok = await sendMail({ to, subject: 'Test email from your website', text: 'If you are reading this, lead and booking notifications will reach you.' });
  ok ? res.json({ ok: true, to }) : res.status(500).json({ error: 'Send failed — see the email log below for the reason.' });
}));

// Settings → Email. Reports what is configured; the password never leaves the server.
app.get('/api/admin/mail', auth, A(async (req, res) => res.json({
  configured: !!mailer, host: MAIL.host || null, port: MAIL.port, from: MAIL.from || null, to: (await notifyTo()) || null,
  recent: await db.all('SELECT id,to_addr,subject,status,created_at FROM mail_log ORDER BY id DESC LIMIT 12')
})));
// sidebar counts: what is waiting on you
app.get('/api/admin/badges', auth, A(async (req, res) => {
  const n = async sql => +(await db.one(sql)).c;
  res.json({ leads: await n("SELECT COUNT(*) c FROM leads WHERE status='new'"), appts: await n("SELECT COUNT(*) c FROM appointments WHERE status='pending'"),
    drafts: await n("SELECT COUNT(*) c FROM posts WHERE status<>'published'") });
}));
// the editor's Preview tab uses the same renderer as the public article page
app.post('/api/admin/render', auth, A(async (req, res) => res.json({ html: renderMarkdown(String(req.body?.body || '').slice(0, 300000)) })));

const table = (route, name, kind, statuses, cols, onStatus) => {
  app.get(`/api/admin/${route}`, auth, A(async (req, res) => res.json(await db.all(
    `SELECT t.*, k.customer_id FROM ${name} t LEFT JOIN customer_links k ON k.kind=? AND k.ref_id=t.id ORDER BY t.id DESC`, [kind]))));
  app.patch(`/api/admin/${route}/:id`, auth, A(async (req, res) => {
    if (!statuses.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status.' });
    const id = +req.params.id;
    const before = await db.one(`SELECT status FROM ${name} WHERE id=?`, [id]);
    await db.run(`UPDATE ${name} SET status=? WHERE id=?`, [req.body.status, id]);
    const link = await db.one('SELECT customer_id FROM customer_links WHERE kind=? AND ref_id=?', [kind, id]);
    if (link && before && before.status !== req.body.status)
      await crmActivity(link.customer_id, kind, `${kind === 'lead' ? 'Enquiry' : 'Booking'} marked ${req.body.status}`, '', kind, id);
    if (onStatus) await onStatus(await db.one(`SELECT * FROM ${name} WHERE id=?`, [id]), req.body.status);
    res.json({ ok: true });
  }));
  app.delete(`/api/admin/${route}/:id`, auth, A(async (req, res) => {
    await db.run(`DELETE FROM ${name} WHERE id=?`, [+req.params.id]);
    await db.run('DELETE FROM customer_links WHERE kind=? AND ref_id=?', [kind, +req.params.id]); // ids can be reused
    res.json({ ok: true });
  }));
  app.get(`/api/admin/${route}.csv`, auth, A(async (req, res) => {
    const rows = await db.all(`SELECT ${cols.join(',')},status,created_at FROM ${name} ORDER BY id DESC`);
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename=${route}.csv` });
    res.send([[...cols, 'status', 'created_at'].join(','), ...rows.map(r => Object.values(r).map(esc).join(','))].join('\n'));
  }));
};
table('leads', 'leads', 'lead', ['new', 'contacted', 'qualified', 'won', 'lost'], ['name', 'email', 'phone', 'company', 'service', 'message']);
table('appointments', 'appointments', 'appointment', ['pending', 'confirmed', 'completed', 'cancelled'], ['name', 'email', 'phone', 'topic', 'mode', 'date', 'time', 'message'],
  async (a, status) => {
    if (!a) return;
    if (status === 'confirmed') await sendMail({
      to: a.email, replyTo: await notifyTo(), subject: `Confirmed — your call on ${a.date} at ${a.time}`,
      text: `Hi ${a.name},\n\nYour call is confirmed for ${a.date} at ${a.time} (${a.mode || 'video call'}).\n\nTopic: ${a.topic || '—'}\n\nIf anything changes, reply to this email.\n\n— Vipin Singh\nSAP Data Migration Strategy & Syniti ADMM Architecture`
    });
    if (status === 'cancelled') await sendMail({
      to: a.email, replyTo: await notifyTo(), subject: `Cancelled — your call on ${a.date} at ${a.time}`,
      text: `Hi ${a.name},\n\nThe call booked for ${a.date} at ${a.time} has been cancelled. You are welcome to book another time on the website.\n\n— Vipin Singh`
    });
  });

// ---------- blog admin ----------
app.get('/api/admin/posts', auth, A(async (req, res) =>
  res.json(await db.all('SELECT id,slug,title,summary,status,published_at,updated_at,created_at,tags,cover,featured FROM posts ORDER BY COALESCE(published_at,created_at) DESC'))));
app.get('/api/admin/posts/:id', auth, A(async (req, res) => {
  const p = await db.one('SELECT * FROM posts WHERE id=?', [+req.params.id]);
  return p ? res.json(p) : res.status(404).json({ error: 'That post no longer exists.' });
}));
function postFields(b) {
  const canonical = clean(b.canonical_url, 400);
  return {
    title: clean(b.title, 180), summary: clean(b.summary, 400), body: clean(b.body, 120000),
    cover: clean(b.cover, 400), cover_alt: clean(b.cover_alt, 200), tags: clean(b.tags, 200),
    status: b.status === 'published' ? 'published' : 'draft',
    // search and sharing: each falls back to title / summary / the post's own URL when blank
    seo_title: clean(b.seo_title, 90), seo_description: clean(b.seo_description, 300), keywords: clean(b.keywords, 300),
    canonical_url: /^https?:\/\//i.test(canonical) ? canonical : '',
    featured: !!b.featured
  };
}
// slugs must stay unique: the URL is what LinkedIn and Google index
async function uniqueSlug(base, id) {
  let s = slugify(base) || 'post', n = 1;
  const taken = v => db.one('SELECT 1 FROM posts WHERE slug=? AND id IS DISTINCT FROM ?', [v, id ?? null]);
  while (await taken(s)) s = `${slugify(base) || 'post'}-${++n}`;
  return s;
}
const nowStamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
app.post('/api/admin/posts', auth, A(async (req, res) => {
  const f = postFields(req.body || {});
  if (!f.title) return res.status(400).json({ error: 'Give the post a title.' });
  const slug = await uniqueSlug(clean(req.body.slug, 180) || f.title);
  const { rows } = await db.run(`INSERT INTO posts(slug,title,summary,body,cover,cover_alt,tags,status,published_at,
      seo_title,seo_description,keywords,canonical_url,featured,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING id`,
    [slug, f.title, f.summary, f.body, f.cover, f.cover_alt, f.tags, f.status, f.status === 'published' ? nowStamp() : null,
      f.seo_title, f.seo_description, f.keywords, f.canonical_url, f.featured]);
  res.json({ ok: true, id: rows[0].id, slug });
}));
app.put('/api/admin/posts/:id', auth, A(async (req, res) => {
  const id = +req.params.id, cur = await db.one('SELECT * FROM posts WHERE id=?', [id]);
  if (!cur) return res.status(404).json({ error: 'That post no longer exists.' });
  const f = postFields(req.body || {});
  if (!f.title) return res.status(400).json({ error: 'Give the post a title.' });
  const slug = await uniqueSlug(clean(req.body.slug, 180) || f.title, id);
  // first publish stamps the date; later edits keep the original so permalinks stay stable
  const published_at = f.status === 'published' ? (cur.published_at || nowStamp()) : null;
  await db.run(`UPDATE posts SET slug=?,title=?,summary=?,body=?,cover=?,cover_alt=?,tags=?,status=?,published_at=?,
      seo_title=?,seo_description=?,keywords=?,canonical_url=?,featured=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [slug, f.title, f.summary, f.body, f.cover, f.cover_alt, f.tags, f.status, published_at,
      f.seo_title, f.seo_description, f.keywords, f.canonical_url, f.featured, id]);
  res.json({ ok: true, slug });
}));
app.delete('/api/admin/posts/:id', auth, A(async (req, res) => { await db.run('DELETE FROM posts WHERE id=?', [+req.params.id]); res.json({ ok: true }); }));

app.put('/api/admin/content', auth, A(async (req, res) => { await kvSet('content', req.body); res.json({ ok: true }); }));
app.post('/api/admin/content/reset', auth, A(async (req, res) => { await kvSet('content', require('./default-content.js')); res.json({ ok: true }); }));
app.get('/api/admin/settings', auth, A(async (req, res) => res.json(await kvGet('settings'))));
app.put('/api/admin/settings', auth, A(async (req, res) => {
  const b = req.body, s = { days: (b.days || []).map(Number).filter(n => n >= 0 && n < 7), start: clean(b.start, 5), end: clean(b.end, 5), duration: Math.max(10, +b.duration || 30), horizon: Math.min(180, Math.max(1, +b.horizon || 30)) };
  await kvSet('settings', s); res.json({ ok: true });
}));
app.post('/api/admin/password', auth, A(async (req, res) => {
  const u = await db.one('SELECT * FROM users WHERE id=?', [req.user.id]), np = clean(req.body.newPassword, 200);
  if (!verify(clean(req.body.current, 200), u.pass)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (np.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  await db.run('UPDATE users SET pass=?, must_change=FALSE WHERE id=?', [hash(np), u.id]); res.json({ ok: true });
}));
app.get('/api/admin/users', auth, A(async (req, res) => res.json(await db.all('SELECT id,email,name,created_at FROM users'))));
app.post('/api/admin/users', auth, A(async (req, res) => {
  const e = clean(req.body.email, 160).toLowerCase(), p = clean(req.body.password, 200);
  if (!isEmail(e) || p.length < 8) return res.status(400).json({ error: 'Enter a valid email and a password of 8+ characters.' });
  try { await db.run('INSERT INTO users(email,name,pass) VALUES(?,?,?)', [e, clean(req.body.name, 80) || 'Admin', hash(p)]); res.json({ ok: true }); }
  catch { res.status(409).json({ error: 'That email already has an account.' }); }
}));
app.delete('/api/admin/users/:id', auth, A(async (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: "You can't remove your own account." });
  await db.run('DELETE FROM users WHERE id=?', [+req.params.id]); res.json({ ok: true });
}));

// Images are kept in the database (see schema.sql, table uploads).
app.post('/api/admin/upload', auth, express.raw({ type: '*/*', limit: '8mb' }), A(async (req, res) => {
  const type = req.headers['content-type'];
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
  if (!ext || !req.body?.length) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image under 8 MB.' });
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  await db.run('INSERT INTO uploads(name,type,data) VALUES(?,?,?)', [name, type, req.body]);
  res.json({ url: '/uploads/' + name });
}));
app.get('/uploads/:name', A(async (req, res) => {
  const f = await db.one('SELECT type,data FROM uploads WHERE name=?', [clean(req.params.name, 80)]);
  if (!f) return res.status(404).type('text').send('Not found');
  res.set('Cache-Control', 'public, max-age=604800').type(f.type).send(f.data);
}));

// ---------- asset versioning ----------
// public/ is served with max-age=7d while HTML is no-cache, so a returning visitor
// would otherwise pair today's markup with a week-old stylesheet - new tokens missing,
// aurora and spectrum rule unstyled. Each stylesheet URL carries a hash of its own
// bytes, so a changed file is a changed URL and the 7-day cache still works for frames.
const assetHashes = new Map();
function assetV(file) {
  const p = path.join(__dirname, 'public', file);
  try {
    const mtime = fs.statSync(p).mtimeMs;
    const hit = assetHashes.get(file);
    if (hit && hit.mtime === mtime) return hit.v;
    const v = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
    assetHashes.set(file, { mtime, v });
    return v;
  } catch { return '0'; }   // missing file: let it 404 loudly rather than wedge the page
}

// ---------- pages ----------
// Page templates live in views/, not public/. On Vercel, public/ is served as static files
// before any function runs, so a template there would bypass this server entirely.
const view = name => fs.readFileSync(path.join(__dirname, 'views', name), 'utf8');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get('/', A(async (req, res) => {
  const c = await kvGet('content');
  track(req, '/');
  res.type('html').send(view('index.html')
    .replaceAll('{{TITLE}}', esc(c.seo.title)).replaceAll('{{DESC}}', esc(c.seo.description))
    .replaceAll('{{V}}', assetV('tokens.css')).replaceAll('{{AV}}', assetV('articles.css')));
}));
// ---------- blog (server-rendered: LinkedIn and Google crawlers do not run JS) ----------
// Embed loaders are only emitted for posts that actually use them — a post with no
// tweet never pays for X's widget script.
function embedScripts(html) {
  let s = '';
  if (html.includes('twitter-tweet')) s += `<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`;
  if (html.includes('embed-gist')) s += `<script>
document.querySelectorAll('figure.embed-gist').forEach(function(f){
  var u=f.dataset.gist.replace(/\\/$/,'')+'.js', fr=document.createElement('iframe');
  fr.style.cssText='width:100%;border:0';fr.loading='lazy';fr.title='GitHub gist';
  fr.srcdoc='<base target="_blank"><style>body{margin:0;font:13px ui-monospace,Consolas,monospace}.gist .gist-file{margin:0;border-radius:12px}</style><script src="'+u+'"><\\/script>'+
    '<script>new ResizeObserver(function(){parent.postMessage({gist:document.body.scrollHeight},"*")}).observe(document.body)<\\/script>';
  f.innerHTML='';f.appendChild(fr);
});
addEventListener('message',function(e){ if(e.data&&e.data.gist){ document.querySelectorAll('figure.embed-gist iframe').forEach(function(fr){ if(fr.contentWindow===e.source) fr.style.height=(e.data.gist+16)+'px'; }); } });
</script>`;
  return s;
}

async function shell({ req, title, desc, canonical, image, type = 'website', jsonLd, body, scripts = '', head = '' }) {
  const c = await kvGet('content'), o = origin(req);
  const img = image ? (/^https?:/.test(image) ? image : o + image) : o + '/img/vipin.jpg';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="${esc(c.brand.name)}"><meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<link rel="alternate" type="application/rss+xml" title="${esc(c.brand.name)} — Articles" href="${o}/rss.xml">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/tokens.css?v=${assetV('tokens.css')}">
<link rel="stylesheet" href="/blog.css?v=${assetV('blog.css')}">
<link rel="stylesheet" href="/articles.css?v=${assetV('articles.css')}">
${head}
${jsonLd ?`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head><body>
<nav class="bnav"><a class="brand" href="/"><span>${esc(c.brand.name)}</span><span class="spectrum" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></a>
<ul><li><a href="/#services">Services</a></li><li><a href="/#work">Engagements</a></li><li><a href="/blog">Articles</a></li><li><a href="/#book" class="btn">Book a call</a></li></ul></nav>
<main>${body}</main>
<footer><div class="bwrap"><div><b>${esc(c.brand.name)}</b><div>${esc(c.brand.role)}</div></div>
<div><a href="/blog">Articles</a> · <a href="/rss.xml">RSS</a> · <a href="${esc(c.brand.linkedin)}" target="_blank" rel="noopener">LinkedIn</a></div></div></footer>
${scripts}
</body></html>`;
}

const pubPosts = () => db.all("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC");
// Listing order: featured articles first, then newest.
const listPosts = (limit = 100, exceptId = 0) => db.all(
  "SELECT * FROM posts WHERE status='published' AND id<>? ORDER BY featured DESC, published_at DESC LIMIT ?", [exceptId, limit]);
const tagsOf = p => String(p.tags || '').split(',').map(t => t.trim()).filter(Boolean);

// What an article card needs, and nothing else: the body never leaves the server for a listing.
const cardData = p => ({
  slug: p.slug, title: p.title, summary: p.summary || stripMd(p.body).slice(0, 160),
  cover: p.cover || '', tag: tagsOf(p)[0] || '', date: niceDate(p.published_at), mins: readMins(p.body)
});
// Square, cover-led card. views/index.html renders the same markup from /api/posts.
// The cover's alt is empty on purpose: the whole card is a link whose text is the title.
const acardHtml = (d, lead = false) => `<a class="acard${lead ? ' lead' : ''}" href="/blog/${esc(d.slug)}">
  ${d.cover ? `<figure class="acover"><img src="${esc(d.cover)}" alt="" loading="lazy" decoding="async"></figure>`
    : `<div class="acover afallback"><span class="spectrum" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></div>`}
  <div class="ainfo">${d.tag ? `<span class="atag">${esc(d.tag)}</span>` : ''}<h3>${esc(d.title)}</h3>
    ${lead && d.summary ? `<p class="asum">${esc(d.summary)}</p>` : ''}
    <span class="ameta">${esc(d.date)} · ${d.mins} min read</span></div>
  <span class="ago" aria-hidden="true">&#8599;</span></a>`;

app.get('/api/posts', A(async (req, res) => {
  const rows = await listPosts(Math.min(12, Math.max(1, +req.query.limit || 3)));
  res.set('Cache-Control', 'public, max-age=60');
  res.json(rows.map(cardData));
}));

app.get('/blog', A(async (req, res) => {
  track(req, '/blog');
  const c = await kvGet('content'), o = origin(req), posts = await listPosts();
  const grid = posts.length
    ? `<div class="agrid">${posts.map((p, i) => acardHtml(cardData(p), i === 0 && posts.length >= 3)).join('')}</div>`
    : `<p class="empty">No articles published yet. Sign in to <a href="/admin#blog">the CMS</a> to write the first one.</p>`;
  res.type('html').send(await shell({
    req, title: `Articles — ${c.brand.name}`,
    desc: `Field notes on SAP S/4HANA data migration, Syniti ADMM, data quality and cutover by ${c.brand.name}.`,
    canonical: `${o}/blog`, type: 'website',
    jsonLd: { '@context': 'https://schema.org', '@type': 'Blog', name: `${c.brand.name} — Articles`, url: `${o}/blog`,
      author: { '@type': 'Person', name: c.brand.name, jobTitle: c.brand.role, url: o } },
    body: `<header class="phead"><span class="eyebrow">Field notes</span><h1>Articles</h1>
      <p>Field notes on SAP data migration, Syniti ADMM, data quality and cutover.</p>
      <span class="pcount">${posts.length} article${posts.length === 1 ? '' : 's'}</span></header>${grid}<div class="pad"></div>`
  }));
}));

// Headings for the contents list, read from the markdown (skipping code blocks) with the
// same ids renderMarkdown gives them.
function tocOf(md) {
  const out = []; let fence = false;
  for (const L of String(md || '').split(/\r?\n/)) {
    if (/^```/.test(L)) { fence = !fence; continue; }
    if (fence) continue;
    const m = L.match(/^(#{1,3})\s+(.*)$/);
    if (m) out.push({ sub: m[1].length === 3, text: stripMd(m[2]), id: slugify(m[2]) });
  }
  return out;
}

// One renderer for the public page and the admin preview, so a draft looks exactly as it will publish.
async function postPage(req, p, { preview = false } = {}) {
  const c = await kvGet('content'), o = origin(req), url = `${o}/blog/${p.slug}`;
  const title = p.seo_title || `${p.title} — ${c.brand.name}`;
  const desc = p.seo_description || p.summary || stripMd(p.body).slice(0, 180);
  const canonical = p.canonical_url || url;
  const tags = tagsOf(p), keywords = p.keywords || tags.join(', ');
  const prose = renderMarkdown(p.body), mins = readMins(p.body), toc = tocOf(p.body);
  const words = stripMd(p.body).split(' ').filter(Boolean).length;
  const photo = c.about?.photo || '/img/vipin.jpg';
  const more = preview ? [] : await listPosts(3, p.id);
  const enc = encodeURIComponent(url), encT = encodeURIComponent(p.title);
  const coverUrl = p.cover ? (/^https?:/.test(p.cover) ? p.cover : o + p.cover) : undefined;
  return shell({
    req, title: preview ? `[${p.status}] ${title}` : title, desc, canonical, image: p.cover, type: 'article',
    head: [
      keywords && `<meta name="keywords" content="${esc(keywords)}">`,
      p.published_at && `<meta property="article:published_time" content="${isoDate(p.published_at)}">`,
      p.updated_at && `<meta property="article:modified_time" content="${isoDate(p.updated_at)}">`,
      ...tags.map(t => `<meta property="article:tag" content="${esc(t)}">`),
      preview && '<meta name="robots" content="noindex">'
    ].filter(Boolean).join('\n'),
    scripts: embedScripts(prose) + READING_SCRIPT,
    jsonLd: preview ? undefined : {
      '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: desc,
      image: coverUrl, datePublished: isoDate(p.published_at), dateModified: isoDate(p.updated_at || p.published_at),
      mainEntityOfPage: canonical, keywords: keywords || undefined, wordCount: words, timeRequired: `PT${mins}M`,
      author: { '@type': 'Person', name: c.brand.name, jobTitle: c.brand.role, url: o, image: o + photo, sameAs: [c.brand.linkedin].filter(Boolean) }
    },
    body: `<div class="progress" aria-hidden="true"><i id="rp"></i></div>
    <article class="post">
      <header class="phero">
        <a class="back" href="/blog">&larr; All articles</a>
        ${preview ? `<div class="ptags"><span>Preview · ${esc(p.status)}</span></div>` : tags.length ? `<div class="ptags">${tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        <h1>${esc(p.title)}</h1>
        ${p.summary ? `<p class="lede">${esc(p.summary)}</p>` : ''}
        <div class="byline"><img src="${esc(photo)}" alt="" width="44" height="44">
          <div><b>${esc(c.brand.name)}</b><span>${p.published_at ? esc(niceDate(p.published_at)) + ' · ' : ''}${mins} min read</span></div></div>
      </header>
      ${p.cover ? `<figure class="cover"><img src="${esc(p.cover)}" alt="${esc(p.cover_alt || '')}"></figure>` : ''}
      <div class="pgrid${toc.length >= 2 ? ' has-toc' : ''}">
        ${toc.length >= 2 ? `<nav class="toc" aria-label="Contents"><p>Contents</p><ol>${toc.map(h =>
          `<li${h.sub ? ' class="sub"' : ''}><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('')}</ol></nav>` : ''}
        <div class="prose">${prose}</div>
      </div>
      <footer class="pend">
        <div class="share"><span>Share</span>
          <a href="https://www.linkedin.com/sharing/share-offsite/?url=${enc}" target="_blank" rel="noopener">LinkedIn</a>
          <a href="https://x.com/intent/post?url=${enc}&amp;text=${encT}" target="_blank" rel="noopener">X</a>
          <a href="mailto:?subject=${encT}&amp;body=${enc}">Email</a>
          <button type="button" id="copy" data-url="${esc(url)}">Copy link</button></div>
        <div class="author"><img src="${esc(photo)}" alt="" width="64" height="64">
          <div><b>${esc(c.brand.name)}</b><span>${esc(c.brand.role)}</span></div>
          <a class="btn" href="/#book">Book a call</a></div>
      </footer>
    </article>
    ${more.length ? `<section class="more"><h2>More articles</h2><div class="agrid">${more.map(m => acardHtml(cardData(m))).join('')}</div></section>` : '<div class="pad"></div>'}`
  });
}

// Reading progress, the active contents entry, and copy-link. Small, and no library.
const READING_SCRIPT = `<script>
(function(){
  var bar=document.getElementById('rp'),art=document.querySelector('.prose');
  function upd(){if(!bar||!art)return;var r=art.getBoundingClientRect(),h=r.height-innerHeight*.5;
    bar.style.transform='scaleX('+Math.min(1,Math.max(0,-r.top/(h>0?h:1)))+')'}
  var q=false;addEventListener('scroll',function(){if(q)return;q=true;requestAnimationFrame(function(){q=false;upd()})},{passive:true});upd();
  var links=[].slice.call(document.querySelectorAll('.toc a'));
  if(links.length&&'IntersectionObserver' in window){var byId={};
    links.forEach(function(a){byId[decodeURIComponent(a.getAttribute('href').slice(1))]=a});
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;
      links.forEach(function(a){a.classList.remove('on')});var a=byId[e.target.id];if(a)a.classList.add('on')})},{rootMargin:'-15% 0px -70% 0px'});
    Object.keys(byId).forEach(function(id){var h=document.getElementById(id);if(h)io.observe(h)})}
  var cp=document.getElementById('copy');
  if(cp)cp.addEventListener('click',function(){
    (navigator.clipboard?navigator.clipboard.writeText(cp.dataset.url):Promise.reject()).then(function(){cp.textContent='Link copied'},function(){prompt('Copy this link',cp.dataset.url)})});
})();
</script>`;

app.get('/blog/:slug', A(async (req, res, next) => {
  const p = await db.one("SELECT * FROM posts WHERE slug=? AND status='published'", [clean(req.params.slug, 120)]);
  if (!p) return next();
  track(req, '/blog/' + p.slug);
  res.type('html').send(await postPage(req, p));
}));

// authenticated preview — renders drafts exactly as they will publish
app.get('/admin/preview/:id', auth, A(async (req, res) => {
  const p = await db.one('SELECT * FROM posts WHERE id=?', [+req.params.id]);
  if (!p) return res.status(404).send('No such post.');
  res.type('html').send(await postPage(req, p, { preview: true }));
}));

app.get('/rss.xml', A(async (req, res) => {
  const c = await kvGet('content'), o = origin(req);
  const items = (await pubPosts()).slice(0, 30).map(p => `<item><title>${esc(p.title)}</title><link>${o}/blog/${esc(p.slug)}</link>
<guid isPermaLink="true">${o}/blog/${esc(p.slug)}</guid><pubDate>${new Date(String(p.published_at).replace(' ', 'T') + 'Z').toUTCString()}</pubDate>
<description>${esc(p.summary || stripMd(p.body).slice(0, 300))}</description></item>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>${esc(c.brand.name)} — Articles</title><link>${o}/blog</link>
<description>${esc(c.seo.description)}</description><language>en</language>${items}</channel></rss>`);
}));

app.get('/sitemap.xml', A(async (req, res) => {
  const o = origin(req);
  const urls = [`<url><loc>${o}/</loc><priority>1.0</priority></url>`, `<url><loc>${o}/blog</loc><priority>0.8</priority></url>`]
    .concat((await pubPosts()).map(p => `<url><loc>${o}/blog/${esc(p.slug)}</loc><lastmod>${String(p.updated_at || p.published_at).slice(0, 10)}</lastmod><priority>0.7</priority></url>`));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
}));

app.get('/robots.txt', (req, res) =>
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin(req)}/sitemap.xml\n`));

// Admin is rendered rather than sent raw, so its stylesheet link gets the same hash.
app.get(['/admin', '/admin/'], (req, res) => res.type('html').send(
  view('admin.html').replaceAll('{{V}}', assetV('tokens.css'))));

// Static files last. On Vercel these are served by the platform before any of this runs.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', setHeaders: (r, p) => { if (p.endsWith('.html')) r.setHeader('Cache-Control', 'no-cache'); } }));

// styled 404 instead of Express's bare "Cannot GET /x"
app.use(A(async (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).type('html').send(await shell({
    req, title: 'Page not found', desc: 'That page does not exist.',
    canonical: origin(req) + req.path,
    body: `<article class="post notfound"><h1>Page not found</h1>
      <p class="lede">That link does not point anywhere on this site.</p>
      <div class="pshare"><a class="btn" href="/">Go to the homepage</a><a class="btn alt" href="/blog">Read the articles</a></div></article>`
  }));
}));

// Last stop for anything that threw. Never leaks the error text to visitors.
app.use((err, req, res, next) => {
  console.error('request failed:', req.method, req.path, err.message);
  if (res.headersSent) return next(err);
  const code = err.status || 500;
  if (req.path.startsWith('/api/')) return res.status(code).json({ error: code < 500 ? err.message : 'Something went wrong. Please try again.' });
  res.status(code).type('html').send('<h1>Something went wrong</h1><p>Please try again in a moment.</p>');
});

// Vercel imports this module and handles requests itself. Running it directly starts a server.
module.exports = app;
if (require.main === module) {
  boot()
    .then(() => app.listen(PORT, () => console.log(`Site: http://localhost:${PORT}   Admin: http://localhost:${PORT}/admin`)))
    .catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
}
