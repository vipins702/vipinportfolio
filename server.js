// Vipin Singh — Portfolio + CMS. Developed by VSM Tech & AI Solutions Agency.
const express = require('express');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, nothing to compile
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(UPLOADS, { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'site.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, pass TEXT, must_change INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, company TEXT, service TEXT, message TEXT, status TEXT DEFAULT 'new', source TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS appointments(id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, topic TEXT, mode TEXT, date TEXT, time TEXT, message TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS ux_slot ON appointments(date, time) WHERE status != 'cancelled';
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT, summary TEXT, body TEXT, cover TEXT, cover_alt TEXT, tags TEXT, status TEXT DEFAULT 'draft', published_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT);
CREATE INDEX IF NOT EXISTS ix_posts_pub ON posts(status, published_at DESC);
CREATE TABLE IF NOT EXISTS pageviews(id INTEGER PRIMARY KEY, path TEXT, source TEXT, referrer TEXT, visitor TEXT, device TEXT, day TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_pv_day ON pageviews(day);
CREATE TABLE IF NOT EXISTS mail_log(id INTEGER PRIMARY KEY, to_addr TEXT, subject TEXT, body TEXT, status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, phone TEXT, company TEXT, title TEXT, stage TEXT, owner TEXT, source TEXT, fields TEXT DEFAULT '{}', last_touch TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_cust_stage ON customers(stage);
CREATE TABLE IF NOT EXISTS customer_links(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, UNIQUE(kind, ref_id));
CREATE TABLE IF NOT EXISTS relationships(id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, to_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, type TEXT NOT NULL, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(from_id, to_id, type));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, title TEXT NOT NULL, notes TEXT, due TEXT, priority TEXT DEFAULT 'normal', done_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_task_open ON tasks(done_at, due);
CREATE TABLE IF NOT EXISTS activities(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT, body TEXT, ref_kind TEXT, ref_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_act_cust ON activities(customer_id, created_at DESC);
`);
const kvGet = k => { const r = db.prepare('SELECT v FROM kv WHERE k=?').get(k); return r ? JSON.parse(r.v) : null; };
const kvSet = (k, v) => db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v));

// ---------- seed ----------
if (!kvGet('content')) kvSet('content', require('./default-content.js'));
if (!kvGet('settings')) kvSet('settings', { days: [1, 2, 3, 4, 5], start: '10:00', end: '18:00', duration: 30, horizon: 30 });
if (!kvGet('secret')) kvSet('secret', crypto.randomBytes(32).toString('hex'));
const SECRET = kvGet('secret');

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const verify = (pw, stored) => { const [salt, h] = stored.split(':'); const t = hash(pw, salt).split(':')[1]; return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(t, 'hex')); };
if (!db.prepare('SELECT 1 FROM users').get()) {
  const email = (process.env.ADMIN_EMAIL || 'admin@vsmtech.ai').toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || 'ChangeMe@123';
  db.prepare('INSERT INTO users(email,name,pass,must_change) VALUES(?,?,?,?)').run(email, 'Admin', hash(pw), process.env.ADMIN_PASSWORD ? 0 : 1);
  console.log(`\n  First run — admin created:\n  Email: ${email}\n  Password: ${process.env.ADMIN_PASSWORD ? '(from ADMIN_PASSWORD)' : pw}\n`);
}

// ---------- session (signed cookie) ----------
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const makeToken = uid => { const p = uid + '.' + (Date.now() + 7 * 864e5); return p + '.' + sign(p); };
const readToken = t => { if (!t) return null; const [uid, exp, sig] = t.split('.'); if (!sig || sign(uid + '.' + exp) !== sig || +exp < Date.now()) return null; return +uid; };
const cookie = (req, n) => (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(c => c[0] === n)?.[1];
const auth = (req, res, next) => {
  const uid = readToken(cookie(req, 'sid'));
  const u = uid && db.prepare('SELECT id,email,name,must_change FROM users WHERE id=?').get(uid);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  req.user = u; next();
};

// ---------- helpers ----------
const rate = new Map();
const limit = (n, ms) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now(), a = (rate.get(k) || []).filter(t => now - t < ms);
  if (a.length >= n) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
  a.push(now); rate.set(k, a); next();
};
const clean = (v, max = 1000) => String(v ?? '').trim().slice(0, max);
const isEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const pad = n => String(n).padStart(2, '0');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
function slotsFor(date) {
  const s = kvGet('settings'), d = new Date(date + 'T00:00:00');
  if (isNaN(d)) return [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = (d - today) / 864e5;
  if (days < 0 || days > s.horizon || !s.days.includes(d.getDay())) return [];
  const taken = new Set(db.prepare("SELECT time FROM appointments WHERE date=? AND status!='cancelled'").all(date).map(r => r.time));
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
// Without SMTP_HOST the site still works; notifications are queued to the mail_log table instead.
const MAIL = {
  host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || process.env.SMTP_USER
};
// Where your alerts go. Falls back to the contact address in the CMS, so it is
// correct out of the box and changes when you change it in Admin → Brand & contact.
const notifyTo = () => process.env.NOTIFY_TO || process.env.SMTP_USER || (kvGet('content')?.brand?.email || '');
const mailer = MAIL.host && MAIL.user && MAIL.pass
  ? nodemailer.createTransport({ host: MAIL.host, port: MAIL.port, secure: MAIL.port === 465, auth: { user: MAIL.user, pass: MAIL.pass } })
  : null;
if (!mailer) console.log('  Email not configured — set SMTP_HOST / SMTP_USER / SMTP_PASS to turn on notifications.\n  Until then every notification is recorded in Admin → Dashboard → Email log.');

function sendMail({ to, subject, text, replyTo }) {
  const row = db.prepare('INSERT INTO mail_log(to_addr,subject,body,status) VALUES(?,?,?,?)')
    .run(to || '', subject, text, mailer ? 'sending' : 'not configured');
  const id = Number(row.lastInsertRowid);
  if (!mailer) return Promise.resolve(false);
  return mailer.sendMail({ from: MAIL.from, to, subject, text, replyTo })
    .then(() => { db.prepare("UPDATE mail_log SET status='sent' WHERE id=?").run(id); return true; })
    .catch(e => { db.prepare("UPDATE mail_log SET status=? WHERE id=?").run('failed: ' + e.message.slice(0, 180), id); console.error('mail failed:', e.message); return false; });
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

function track(req, pathName) {
  try {
    const ua = req.get('user-agent') || '';
    if (BOT.test(ua)) return;
    const ref = req.get('referer') || '';
    let sameHost = false;
    try { sameHost = new URL(ref).host === req.get('host'); } catch { }
    db.prepare('INSERT INTO pageviews(path,source,referrer,visitor,device,day) VALUES(?,?,?,?,?,?)').run(
      pathName.slice(0, 200), sameHost ? 'Internal' : sourceOf(ref), ref.slice(0, 300),
      visitorId(req), /Mobile|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop',
      new Date().toISOString().slice(0, 10));
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
// SQLite stores "YYYY-MM-DD HH:MM:SS"; schema.org and RSS need real ISO 8601
const isoDate = d => d ? new Date(String(d).replace(' ', 'T') + 'Z').toISOString() : undefined;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); next(); });

// ---------- public API ----------
app.get('/api/content', (req, res) => res.json(kvGet('content')));
app.get('/api/slots', (req, res) => res.json({ slots: slotsFor(clean(req.query.date, 10)), duration: kvGet('settings').duration }));

app.post('/api/leads', limit(5, 10 * 60e3), (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot
  const l = { name: clean(b.name, 120), email: clean(b.email, 160), phone: clean(b.phone, 40), company: clean(b.company, 120), service: clean(b.service, 120), message: clean(b.message, 3000) };
  if (!l.name || !isEmail(l.email) || !l.message) return res.status(400).json({ error: 'Please add your name, a valid email and a short message.' });
  const leadId = db.prepare('INSERT INTO leads(name,email,phone,company,service,message,source) VALUES(@name,@email,@phone,@company,@service,@message,@source)').run({ ...l, source: 'contact form' }).lastInsertRowid;
  res.json({ ok: true });
  linkSafely('lead', 'leads', leadId);
  // after the response — a slow mail server must never make the visitor wait
  sendMail({
    to: notifyTo(), replyTo: l.email, subject: `New enquiry from ${l.name}${l.company ? ' (' + l.company + ')' : ''}`,
    text: `${l.name} sent a message through your website.\n\nEmail:   ${l.email}\nPhone:   ${l.phone || '—'}\nCompany: ${l.company || '—'}\nTopic:   ${l.service || '—'}\n\n${l.message}\n\n— Reply directly to this email to answer them.`
  });
  sendMail({
    to: l.email, subject: 'Thanks — your message reached Vipin Singh',
    text: `Hi ${l.name},\n\nThank you for getting in touch. Your message has arrived and you will get a reply within one business day.\n\nFor reference, this is what you sent:\n\n${l.message}\n\n— Vipin Singh\nSAP Data Migration Strategy & Syniti ADMM Architecture`
  });
});

app.post('/api/appointments', limit(5, 10 * 60e3), (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true });
  const a = { name: clean(b.name, 120), email: clean(b.email, 160), phone: clean(b.phone, 40), topic: clean(b.topic, 120), mode: clean(b.mode, 40), date: clean(b.date, 10), time: clean(b.time, 5), message: clean(b.message, 2000) };
  if (!a.name || !isEmail(a.email) || !a.date || !a.time) return res.status(400).json({ error: 'Please add your name, a valid email, a date and a time.' });
  if (!slotsFor(a.date).includes(a.time)) return res.status(409).json({ error: 'That time is no longer available. Please pick another slot.' });
  let apptId;
  try { apptId = db.prepare('INSERT INTO appointments(name,email,phone,topic,mode,date,time,message) VALUES(@name,@email,@phone,@topic,@mode,@date,@time,@message)').run(a).lastInsertRowid; }
  catch { return res.status(409).json({ error: 'That time was just taken. Please pick another slot.' }); }
  res.json({ ok: true });
  linkSafely('appointment', 'appointments', apptId);
  const when = `${a.date} at ${a.time}`;
  sendMail({
    to: notifyTo(), replyTo: a.email, subject: `Call request — ${a.name}, ${when}`,
    text: `${a.name} requested a call.\n\nWhen:   ${when}\nFormat: ${a.mode || '—'}\nTopic:  ${a.topic || '—'}\nEmail:  ${a.email}\nPhone:  ${a.phone || '—'}\n\n${a.message || '(no notes)'}\n\nConfirm or cancel it in your admin panel.`
  });
  sendMail({
    to: a.email, subject: `Call request received — ${when}`,
    text: `Hi ${a.name},\n\nYour request for ${when} has been received. Vipin will confirm by email shortly.\n\nFormat: ${a.mode || '—'}\nTopic:  ${a.topic || '—'}\n\nIf you need to change the time, just reply to this email.\n\n— Vipin Singh\nSAP Data Migration Strategy & Syniti ADMM Architecture`
  });
});

// ---------- Customer 360 (CRM) ----------
// The CRM's shape — pipeline stages, custom profile fields, relationship and activity
// types — is metadata in kv('crm'), editable in Admin → Customers → Setup. Screens and
// validation are driven from it, so adding a field or a stage needs no code change.
const CRM_FIELD_TYPES = ['text', 'textarea', 'number', 'currency', 'date', 'url', 'select'];
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
if (!kvGet('crm')) kvSet('crm', CRM_DEFAULT);
const crmMeta = () => kvGet('crm');
const slugKey = s => clean(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const firstStage = () => crmMeta().stages[0].key;
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function crmActivity(customerId, type, title, body = '', refKind = null, refId = null, at = nowSql()) {
  db.prepare('INSERT INTO activities(customer_id,type,title,body,ref_kind,ref_id,created_at) VALUES(?,?,?,?,?,?,?)').run(customerId, type, title, body, refKind, refId, at);
  db.prepare('UPDATE customers SET last_touch=MAX(COALESCE(last_touch,\'\'),?) WHERE id=?').run(at, customerId);
}

// One person = one customer, matched on email. Every enquiry and booking is attached
// to that customer and lands on their timeline; blank profile fields are filled, never overwritten.
function linkToCustomer(kind, r) {
  const email = clean(r.email, 160).toLowerCase();
  if (!email) return null;
  const found = db.prepare('SELECT id FROM customers WHERE email=?').get(email);
  const cid = found ? found.id : Number(db.prepare('INSERT INTO customers(name,email,phone,company,stage,source,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(r.name, email, r.phone || null, r.company || null, firstStage(), kind === 'lead' ? 'Contact form' : 'Booking', r.created_at || nowSql()).lastInsertRowid);
  if (found) db.prepare("UPDATE customers SET phone=COALESCE(NULLIF(phone,''),?), company=COALESCE(NULLIF(company,''),?) WHERE id=?").run(r.phone || null, r.company || null, cid);
  if (!db.prepare('INSERT OR IGNORE INTO customer_links(customer_id,kind,ref_id) VALUES(?,?,?)').run(cid, kind, r.id).changes) return cid;
  if (kind === 'lead') crmActivity(cid, 'lead', `Enquiry${r.service ? ' — ' + r.service : ''}`, r.message, 'lead', r.id, r.created_at);
  else crmActivity(cid, 'appointment', `Call requested for ${r.date} at ${r.time}`, [r.topic, r.mode, r.message].filter(Boolean).join(' · '), 'appointment', r.id, r.created_at);
  return cid;
}
const linkSafely = (kind, table, id) => {
  try { linkToCustomer(kind, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)); }
  catch (e) { console.error('CRM link failed:', e.message); } // never fail the visitor's submission over the CRM
};

// Existing enquiries and bookings are attached once. After that, linking happens as they arrive —
// so deleting a customer is final and a restart will not bring them back.
if (!kvGet('crmBackfilled')) {
  for (const l of db.prepare('SELECT * FROM leads ORDER BY id').all()) linkToCustomer('lead', l);
  for (const a of db.prepare('SELECT * FROM appointments ORDER BY id').all()) linkToCustomer('appointment', a);
  kvSet('crmBackfilled', true);
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
    else if (f.type === 'date') { v = clean(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue; }
    else v = clean(v, f.type === 'textarea' ? 4000 : 300);
    out[f.key] = v;
  }
  return out;
}

// ---------- admin API ----------
app.post('/api/admin/login', limit(8, 10 * 60e3), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email, 160).toLowerCase());
  if (!u || !verify(clean(req.body.password, 200), u.pass)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.set('Set-Cookie', `sid=${makeToken(u.id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.set('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/admin/me', auth, (req, res) => res.json(req.user));

// ---------- CRM API ----------
const PRIORITIES = ['low', 'normal', 'high'];
const getCustomer = id => db.prepare('SELECT * FROM customers WHERE id=?').get(id);
const need = (res, row, what = 'That customer') => row || (res.status(404).json({ error: `${what} no longer exists.` }), null);

app.get('/api/admin/crm/meta', auth, (req, res) => res.json(crmMeta()));
app.put('/api/admin/crm/meta', auth, (req, res) => {
  const m = cleanMeta(req.body || {});
  if (!m.stages.length) return res.status(400).json({ error: 'Keep at least one pipeline stage.' });
  if (!m.activityTypes.length) return res.status(400).json({ error: 'Keep at least one activity type.' });
  // customers sitting in a removed stage move to the first stage rather than becoming invisible
  const keys = m.stages.map(s => s.key);
  db.prepare(`UPDATE customers SET stage=? WHERE stage IS NULL OR stage NOT IN (${keys.map(() => '?').join(',')})`).run(keys[0], ...keys);
  kvSet('crm', m); res.json(m);
});

app.get('/api/admin/crm/customers', auth, (req, res) => {
  const q = clean(req.query.q, 100).toLowerCase(), stage = clean(req.query.stage, 60);
  const where = [], args = [];
  if (q) { where.push("(lower(c.name) LIKE ? OR c.email LIKE ? OR lower(COALESCE(c.company,'')) LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (stage) { where.push('c.stage=?'); args.push(stage); }
  const today = /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10); // the admin's local date
  const rows = db.prepare(`SELECT c.id,c.name,c.email,c.company,c.title,c.stage,c.owner,c.source,c.last_touch,c.created_at,
      (SELECT COUNT(*) FROM tasks t WHERE t.customer_id=c.id AND t.done_at IS NULL) open_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.customer_id=c.id AND t.done_at IS NULL AND t.due<?) overdue,
      (SELECT COUNT(*) FROM customer_links k WHERE k.customer_id=c.id AND k.kind='lead') enquiries,
      (SELECT COUNT(*) FROM customer_links k WHERE k.customer_id=c.id AND k.kind='appointment') bookings
    FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(c.last_touch,c.created_at) DESC LIMIT 500`).all(today, ...args);
  const stages = Object.fromEntries(db.prepare('SELECT stage, COUNT(*) n FROM customers GROUP BY stage').all().map(r => [r.stage, r.n]));
  const agenda = db.prepare(`SELECT t.id,t.title,t.due,t.priority,t.customer_id,c.name customer FROM tasks t JOIN customers c ON c.id=t.customer_id
    WHERE t.done_at IS NULL ORDER BY t.due IS NULL, t.due, t.id LIMIT 8`).all();
  res.json({ customers: rows, stages, total: db.prepare('SELECT COUNT(*) n FROM customers').get().n, agenda });
});

app.post('/api/admin/crm/customers', auth, (req, res) => {
  const b = req.body || {}, m = crmMeta();
  const c = { name: clean(b.name, 120), email: clean(b.email, 160).toLowerCase() || null, phone: clean(b.phone, 40), company: clean(b.company, 120), title: clean(b.title, 120) };
  if (!c.name) return res.status(400).json({ error: 'A name is required.' });
  if (c.email && !isEmail(c.email)) return res.status(400).json({ error: 'That email address does not look right.' });
  if (c.email && db.prepare('SELECT 1 FROM customers WHERE email=?').get(c.email)) return res.status(409).json({ error: 'A customer with that email already exists.' });
  const stage = m.stages.some(s => s.key === b.stage) ? b.stage : firstStage();
  const id = Number(db.prepare('INSERT INTO customers(name,email,phone,company,title,stage,owner,source) VALUES(?,?,?,?,?,?,?,?)')
    .run(c.name, c.email, c.phone, c.company, c.title, stage, req.user.name || req.user.email, 'Added manually').lastInsertRowid);
  crmActivity(id, 'system', 'Customer created', `Added by ${req.user.email}`);
  res.json({ id });
});

// the 360 view: profile, every enquiry and booking, timeline, tasks and relationships in one response
app.get('/api/admin/crm/customers/:id', auth, (req, res) => {
  const c = need(res, getCustomer(+req.params.id)); if (!c) return;
  const links = db.prepare('SELECT kind, ref_id FROM customer_links WHERE customer_id=?').all(c.id);
  const ids = k => links.filter(l => l.kind === k).map(l => l.ref_id);
  const pick = (table, list) => list.length ? db.prepare(`SELECT * FROM ${table} WHERE id IN (${list.map(() => '?').join(',')}) ORDER BY id DESC`).all(...list) : [];
  const relationships = db.prepare(`
    SELECT r.id, r.type, r.note, 'out' dir, o.id other_id, o.name other_name, o.company other_company, o.stage other_stage FROM relationships r JOIN customers o ON o.id=r.to_id WHERE r.from_id=?
    UNION ALL
    SELECT r.id, r.type, r.note, 'in' dir, o.id, o.name, o.company, o.stage FROM relationships r JOIN customers o ON o.id=r.from_id WHERE r.to_id=?
    ORDER BY 1 DESC`).all(c.id, c.id);
  res.json({
    customer: { ...c, fields: JSON.parse(c.fields || '{}') },
    leads: pick('leads', ids('lead')), appointments: pick('appointments', ids('appointment')),
    activities: db.prepare('SELECT * FROM activities WHERE customer_id=? ORDER BY created_at DESC, id DESC LIMIT 300').all(c.id),
    tasks: db.prepare('SELECT * FROM tasks WHERE customer_id=? ORDER BY done_at IS NOT NULL, due IS NULL, due, id').all(c.id),
    relationships,
    others: db.prepare('SELECT id,name,company FROM customers WHERE id!=? ORDER BY name LIMIT 1000').all(c.id),
    meta: crmMeta()
  });
});

app.patch('/api/admin/crm/customers/:id', auth, (req, res) => {
  const c = need(res, getCustomer(+req.params.id)); if (!c) return;
  const b = req.body || {}, m = crmMeta(), next = {};
  for (const [k, n] of [['name', 120], ['phone', 40], ['company', 120], ['title', 120], ['owner', 120]]) if (k in b) next[k] = clean(b[k], n);
  if ('name' in next && !next.name) return res.status(400).json({ error: 'A name is required.' });
  if ('email' in b) {
    const e = clean(b.email, 160).toLowerCase();
    if (e && !isEmail(e)) return res.status(400).json({ error: 'That email address does not look right.' });
    if (e && db.prepare('SELECT 1 FROM customers WHERE email=? AND id!=?').get(e, c.id)) return res.status(409).json({ error: 'Another customer already uses that email.' });
    next.email = e || null;
  }
  if ('stage' in b) {
    const s = m.stages.find(x => x.key === b.stage);
    if (!s) return res.status(400).json({ error: 'Unknown stage.' });
    if (b.stage !== c.stage) {
      const from = m.stages.find(x => x.key === c.stage)?.label || 'None';
      crmActivity(c.id, 'stage', `Stage changed: ${from} → ${s.label}`);
    }
    next.stage = b.stage;
  }
  if ('fields' in b) next.fields = JSON.stringify(cleanFieldValues(b.fields, m.fields));
  const keys = Object.keys(next);
  if (keys.length) db.prepare(`UPDATE customers SET ${keys.map(k => k + '=?').join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...keys.map(k => next[k]), c.id);
  res.json({ ok: true });
});

app.delete('/api/admin/crm/customers/:id', auth, (req, res) => {
  db.prepare('DELETE FROM customers WHERE id=?').run(+req.params.id); res.json({ ok: true });
});

app.post('/api/admin/crm/customers/:id/activities', auth, (req, res) => {
  const c = need(res, getCustomer(+req.params.id)); if (!c) return;
  const b = req.body || {}, t = crmMeta().activityTypes.find(x => x.key === b.type);
  if (!t) return res.status(400).json({ error: 'Unknown activity type.' });
  const body = clean(b.body, 8000);
  if (!body) return res.status(400).json({ error: 'Write a few words about it first.' });
  crmActivity(c.id, t.key, clean(b.title, 200) || t.label, body);
  res.json({ ok: true });
});
// only notes you logged can be removed — enquiries, bookings and stage history are the audit trail
app.delete('/api/admin/crm/activities/:id', auth, (req, res) => {
  const custom = crmMeta().activityTypes.map(t => t.key);
  const a = db.prepare('SELECT type FROM activities WHERE id=?').get(+req.params.id);
  if (a && !custom.includes(a.type)) return res.status(400).json({ error: 'System history cannot be deleted.' });
  db.prepare('DELETE FROM activities WHERE id=?').run(+req.params.id); res.json({ ok: true });
});

app.post('/api/admin/crm/customers/:id/tasks', auth, (req, res) => {
  const c = need(res, getCustomer(+req.params.id)); if (!c) return;
  const b = req.body || {}, title = clean(b.title, 200), due = /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : null;
  if (!title) return res.status(400).json({ error: 'Give the task a title.' });
  const id = db.prepare('INSERT INTO tasks(customer_id,title,notes,due,priority) VALUES(?,?,?,?,?)')
    .run(c.id, title, clean(b.notes, 2000), due, PRIORITIES.includes(b.priority) ? b.priority : 'normal').lastInsertRowid;
  res.json({ id: Number(id) });
});
app.patch('/api/admin/crm/tasks/:id', auth, (req, res) => {
  const t = need(res, db.prepare('SELECT * FROM tasks WHERE id=?').get(+req.params.id), 'That task'); if (!t) return;
  const b = req.body || {}, next = {};
  if ('title' in b) { next.title = clean(b.title, 200); if (!next.title) return res.status(400).json({ error: 'Give the task a title.' }); }
  if ('due' in b) next.due = /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : null;
  if ('priority' in b && PRIORITIES.includes(b.priority)) next.priority = b.priority;
  if ('done' in b) {
    next.done_at = b.done ? nowSql() : null;
    if (b.done && !t.done_at) crmActivity(t.customer_id, 'task', `Completed: ${t.title}`);
  }
  const keys = Object.keys(next);
  if (keys.length) db.prepare(`UPDATE tasks SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`).run(...keys.map(k => next[k]), t.id);
  res.json({ ok: true });
});
app.delete('/api/admin/crm/tasks/:id', auth, (req, res) => { db.prepare('DELETE FROM tasks WHERE id=?').run(+req.params.id); res.json({ ok: true }); });

app.post('/api/admin/crm/customers/:id/relationships', auth, (req, res) => {
  const c = need(res, getCustomer(+req.params.id)); if (!c) return;
  const b = req.body || {}, other = getCustomer(+b.to_id), type = clean(b.type, 40);
  if (!other || other.id === c.id) return res.status(400).json({ error: 'Choose another customer to link to.' });
  if (!crmMeta().relTypes.includes(type)) return res.status(400).json({ error: 'Unknown relationship type.' });
  const r = db.prepare('INSERT OR IGNORE INTO relationships(from_id,to_id,type,note) VALUES(?,?,?,?)').run(c.id, other.id, type, clean(b.note, 300));
  if (!r.changes) return res.status(409).json({ error: 'That relationship already exists.' });
  crmActivity(c.id, 'system', `Linked: ${type} ${other.name}`);
  res.json({ ok: true });
});
app.delete('/api/admin/crm/relationships/:id', auth, (req, res) => { db.prepare('DELETE FROM relationships WHERE id=?').run(+req.params.id); res.json({ ok: true }); });

app.get('/api/admin/stats', auth, (req, res) => {
  const q = s => db.prepare(s).get().c;
  const days = Math.min(90, Math.max(7, +req.query.days || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  // fill every day in the window so the chart has no gaps
  const byDay = Object.fromEntries(db.prepare('SELECT day, COUNT(*) c, COUNT(DISTINCT visitor) v FROM pageviews WHERE day>=? GROUP BY day').all(since).map(r => [r.day, r]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    series.push({ day: d, views: byDay[d]?.c || 0, visitors: byDay[d]?.v || 0 });
  }
  res.json({
    leads: q('SELECT COUNT(*) c FROM leads'), newLeads: q("SELECT COUNT(*) c FROM leads WHERE status='new'"),
    appts: q('SELECT COUNT(*) c FROM appointments'), pending: q("SELECT COUNT(*) c FROM appointments WHERE status='pending'"),
    posts: q("SELECT COUNT(*) c FROM posts WHERE status='published'"),
    upcoming: db.prepare("SELECT * FROM appointments WHERE status!='cancelled' AND date>=date('now','localtime') ORDER BY date,time LIMIT 5").all(),
    recent: db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 5').all(),
    traffic: {
      days,
      views: db.prepare('SELECT COUNT(*) c FROM pageviews WHERE day>=?').get(since).c,
      visitors: db.prepare('SELECT COUNT(DISTINCT visitor) c FROM pageviews WHERE day>=?').get(since).c,
      allTime: q('SELECT COUNT(*) c FROM pageviews'),
      series,
      sources: db.prepare("SELECT source k, COUNT(*) c, COUNT(DISTINCT visitor) v FROM pageviews WHERE day>=? AND source!='Internal' GROUP BY source ORDER BY c DESC LIMIT 10").all(since),
      pages: db.prepare('SELECT path k, COUNT(*) c, COUNT(DISTINCT visitor) v FROM pageviews WHERE day>=? GROUP BY path ORDER BY c DESC LIMIT 10').all(since),
      devices: db.prepare('SELECT device k, COUNT(*) c FROM pageviews WHERE day>=? GROUP BY device').all(since)
    },
    mail: {
      configured: !!mailer, to: notifyTo() || null,
      recent: db.prepare('SELECT id,to_addr,subject,status,created_at FROM mail_log ORDER BY id DESC LIMIT 8').all()
    }
  });
});

// lets you prove delivery works without filling in the public form
app.post('/api/admin/mail-test', auth, async (req, res) => {
  if (!mailer) return res.status(400).json({ error: 'Email is not configured yet. Set SMTP_HOST, SMTP_USER and SMTP_PASS, then restart.' });
  const ok = await sendMail({ to: notifyTo(), subject: 'Test email from your website', text: 'If you are reading this, lead and booking notifications will reach you.' });
  ok ? res.json({ ok: true, to: notifyTo() }) : res.status(500).json({ error: 'Send failed — see the email log below for the reason.' });
});

const table = (route, name, kind, statuses, cols, onStatus) => {
  app.get(`/api/admin/${route}`, auth, (req, res) => res.json(db.prepare(
    `SELECT t.*, k.customer_id FROM ${name} t LEFT JOIN customer_links k ON k.kind=? AND k.ref_id=t.id ORDER BY t.id DESC`).all(kind)));
  app.patch(`/api/admin/${route}/:id`, auth, (req, res) => {
    if (!statuses.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status.' });
    const before = db.prepare(`SELECT status FROM ${name} WHERE id=?`).get(+req.params.id);
    db.prepare(`UPDATE ${name} SET status=? WHERE id=?`).run(req.body.status, +req.params.id); res.json({ ok: true });
    const link = db.prepare('SELECT customer_id FROM customer_links WHERE kind=? AND ref_id=?').get(kind, +req.params.id);
    if (link && before && before.status !== req.body.status)
      crmActivity(link.customer_id, kind, `${kind === 'lead' ? 'Enquiry' : 'Booking'} marked ${req.body.status}`, '', kind, +req.params.id);
    if (onStatus) onStatus(db.prepare(`SELECT * FROM ${name} WHERE id=?`).get(+req.params.id), req.body.status);
  });
  app.delete(`/api/admin/${route}/:id`, auth, (req, res) => {
    db.prepare(`DELETE FROM ${name} WHERE id=?`).run(+req.params.id);
    db.prepare('DELETE FROM customer_links WHERE kind=? AND ref_id=?').run(kind, +req.params.id); // ids can be reused
    res.json({ ok: true });
  });
  app.get(`/api/admin/${route}.csv`, auth, (req, res) => {
    const rows = db.prepare(`SELECT ${cols.join(',')},status,created_at FROM ${name} ORDER BY id DESC`).all();
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename=${route}.csv` });
    res.send([[...cols, 'status', 'created_at'].join(','), ...rows.map(r => Object.values(r).map(esc).join(','))].join('\n'));
  });
};
table('leads', 'leads', 'lead', ['new', 'contacted', 'qualified', 'won', 'lost'], ['name', 'email', 'phone', 'company', 'service', 'message']);
table('appointments', 'appointments', 'appointment', ['pending', 'confirmed', 'completed', 'cancelled'], ['name', 'email', 'phone', 'topic', 'mode', 'date', 'time', 'message'],
  (a, status) => {
    if (!a) return;
    if (status === 'confirmed') sendMail({
      to: a.email, replyTo: notifyTo(), subject: `Confirmed — your call on ${a.date} at ${a.time}`,
      text: `Hi ${a.name},\n\nYour call is confirmed for ${a.date} at ${a.time} (${a.mode || 'video call'}).\n\nTopic: ${a.topic || '—'}\n\nIf anything changes, reply to this email.\n\n— Vipin Singh\nSAP Data Migration Strategy & Syniti ADMM Architecture`
    });
    if (status === 'cancelled') sendMail({
      to: a.email, replyTo: notifyTo(), subject: `Cancelled — your call on ${a.date} at ${a.time}`,
      text: `Hi ${a.name},\n\nThe call booked for ${a.date} at ${a.time} has been cancelled. You are welcome to book another time on the website.\n\n— Vipin Singh`
    });
  });

// ---------- blog admin ----------
app.get('/api/admin/posts', auth, (req, res) =>
  res.json(db.prepare('SELECT id,slug,title,summary,status,published_at,updated_at,created_at,tags,cover FROM posts ORDER BY COALESCE(published_at,created_at) DESC').all()));
app.get('/api/admin/posts/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id=?').get(+req.params.id);
  return p ? res.json(p) : res.status(404).json({ error: 'That post no longer exists.' });
});
function postFields(b) {
  return {
    title: clean(b.title, 180), summary: clean(b.summary, 400), body: clean(b.body, 120000),
    cover: clean(b.cover, 400), cover_alt: clean(b.cover_alt, 200), tags: clean(b.tags, 200),
    status: b.status === 'published' ? 'published' : 'draft'
  };
}
// slugs must stay unique: the URL is what LinkedIn and Google index
function uniqueSlug(base, id) {
  let s = slugify(base) || 'post', n = 1;
  const taken = v => db.prepare('SELECT 1 FROM posts WHERE slug=? AND id IS NOT ?').get(v, id ?? null);
  while (taken(s)) s = `${slugify(base) || 'post'}-${++n}`;
  return s;
}
app.post('/api/admin/posts', auth, (req, res) => {
  const f = postFields(req.body || {});
  if (!f.title) return res.status(400).json({ error: 'Give the post a title.' });
  const slug = uniqueSlug(clean(req.body.slug, 180) || f.title);
  const info = db.prepare(`INSERT INTO posts(slug,title,summary,body,cover,cover_alt,tags,status,published_at,updated_at)
    VALUES(@slug,@title,@summary,@body,@cover,@cover_alt,@tags,@status,@published_at,CURRENT_TIMESTAMP)`)
    .run({ ...f, slug, published_at: f.status === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null });
  res.json({ ok: true, id: Number(info.lastInsertRowid), slug });
});
app.put('/api/admin/posts/:id', auth, (req, res) => {
  const id = +req.params.id, cur = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: 'That post no longer exists.' });
  const f = postFields(req.body || {});
  if (!f.title) return res.status(400).json({ error: 'Give the post a title.' });
  const slug = uniqueSlug(clean(req.body.slug, 180) || f.title, id);
  // first publish stamps the date; later edits keep the original so permalinks stay stable
  const published_at = f.status === 'published' ? (cur.published_at || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null;
  db.prepare(`UPDATE posts SET slug=@slug,title=@title,summary=@summary,body=@body,cover=@cover,cover_alt=@cover_alt,
    tags=@tags,status=@status,published_at=@published_at,updated_at=CURRENT_TIMESTAMP WHERE id=@id`)
    .run({ ...f, slug, published_at, id });
  res.json({ ok: true, slug });
});
app.delete('/api/admin/posts/:id', auth, (req, res) => { db.prepare('DELETE FROM posts WHERE id=?').run(+req.params.id); res.json({ ok: true }); });

app.put('/api/admin/content', auth, (req, res) => { kvSet('content', req.body); res.json({ ok: true }); });
app.post('/api/admin/content/reset', auth, (req, res) => { kvSet('content', require('./default-content.js')); res.json({ ok: true }); });
app.get('/api/admin/settings', auth, (req, res) => res.json(kvGet('settings')));
app.put('/api/admin/settings', auth, (req, res) => {
  const b = req.body, s = { days: (b.days || []).map(Number).filter(n => n >= 0 && n < 7), start: clean(b.start, 5), end: clean(b.end, 5), duration: Math.max(10, +b.duration || 30), horizon: Math.min(180, Math.max(1, +b.horizon || 30)) };
  kvSet('settings', s); res.json({ ok: true });
});
app.post('/api/admin/password', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id), np = clean(req.body.newPassword, 200);
  if (!verify(clean(req.body.current, 200), u.pass)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (np.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.prepare('UPDATE users SET pass=?, must_change=0 WHERE id=?').run(hash(np), u.id); res.json({ ok: true });
});
app.get('/api/admin/users', auth, (req, res) => res.json(db.prepare('SELECT id,email,name,created_at FROM users').all()));
app.post('/api/admin/users', auth, (req, res) => {
  const e = clean(req.body.email, 160).toLowerCase(), p = clean(req.body.password, 200);
  if (!isEmail(e) || p.length < 8) return res.status(400).json({ error: 'Enter a valid email and a password of 8+ characters.' });
  try { db.prepare('INSERT INTO users(email,name,pass) VALUES(?,?,?)').run(e, clean(req.body.name, 80) || 'Admin', hash(p)); res.json({ ok: true }); }
  catch { res.status(409).json({ error: 'That email already has an account.' }); }
});
app.delete('/api/admin/users/:id', auth, (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: "You can't remove your own account." });
  db.prepare('DELETE FROM users WHERE id=?').run(+req.params.id); res.json({ ok: true });
});
app.post('/api/admin/upload', auth, express.raw({ type: '*/*', limit: '8mb' }), (req, res) => {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[req.headers['content-type']];
  if (!ext || !req.body?.length) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image under 8 MB.' });
  const f = crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS, f), req.body); res.json({ url: '/uploads/' + f });
});

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
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get('/', (req, res) => {
  const c = kvGet('content');
  track(req, '/');
  res.type('html').send(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replaceAll('{{TITLE}}', esc(c.seo.title)).replaceAll('{{DESC}}', esc(c.seo.description))
    .replaceAll('{{V}}', assetV('tokens.css')));
});
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

function shell({ req, title, desc, canonical, image, type = 'website', jsonLd, body, scripts = '' }) {
  const c = kvGet('content'), o = origin(req);
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
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head><body>
<nav class="bnav"><a class="brand" href="/"><span>${esc(c.brand.name)}</span><span class="spectrum" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></a>
<ul><li><a href="/#services">Services</a></li><li><a href="/#work">Engagements</a></li><li><a href="/blog">Articles</a></li><li><a href="/#book" class="btn">Book a call</a></li></ul></nav>
<main>${body}</main>
<footer><div class="bwrap"><div><b>${esc(c.brand.name)}</b><div>${esc(c.brand.role)}</div></div>
<div><a href="/blog">Articles</a> · <a href="/rss.xml">RSS</a> · <a href="${esc(c.brand.linkedin)}" target="_blank" rel="noopener">LinkedIn</a></div></div></footer>
${scripts}
</body></html>`;
}

const pubPosts = () => db.prepare("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC").all();

app.get('/blog', (req, res) => {
  track(req, '/blog');
  const c = kvGet('content'), o = origin(req), posts = pubPosts();
  const cards = posts.length ? posts.map(p => `<article class="pcard">
    ${p.cover ? `<a href="/blog/${esc(p.slug)}" class="pcover"><img src="${esc(p.cover)}" alt="${esc(p.cover_alt || '')}" loading="lazy"></a>` : ''}
    <div class="pbody">
      ${p.tags ? `<div class="ptags">${p.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <h2><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2>
      <p>${esc(p.summary || stripMd(p.body).slice(0, 180))}</p>
      <div class="pmeta">${esc(niceDate(p.published_at))} · ${readMins(p.body)} min read</div>
    </div></article>`).join('')
    : `<p class="empty">No articles published yet. Sign in to <a href="/admin#blog">the CMS</a> to write the first one.</p>`;
  res.type('html').send(shell({
    req, title: `Articles — ${c.brand.name}`,
    desc: `Field notes on SAP S/4HANA data migration, Syniti ADMM, data quality and cutover by ${c.brand.name}.`,
    canonical: `${o}/blog`, type: 'website',
    jsonLd: { '@context': 'https://schema.org', '@type': 'Blog', name: `${c.brand.name} — Articles`, url: `${o}/blog`,
      author: { '@type': 'Person', name: c.brand.name, jobTitle: c.brand.role, url: o } },
    body: `<header class="phead"><h1>Articles</h1><p>Field notes on SAP data migration, Syniti ADMM, data quality and cutover.</p></header><div class="plist">${cards}</div>`
  }));
});

app.get('/blog/:slug', (req, res, next) => {
  const p = db.prepare("SELECT * FROM posts WHERE slug=? AND status='published'").get(clean(req.params.slug, 120));
  if (!p) return next();
  track(req, '/blog/' + p.slug);
  const c = kvGet('content'), o = origin(req), url = `${o}/blog/${p.slug}`;
  const desc = p.summary || stripMd(p.body).slice(0, 180);
  const share = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  const prose = renderMarkdown(p.body);
  res.type('html').send(shell({
    req, title: `${p.title} — ${c.brand.name}`, desc, canonical: url, image: p.cover, type: 'article',
    scripts: embedScripts(prose),
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: desc,
      image: p.cover ? (/^https?:/.test(p.cover) ? p.cover : o + p.cover) : undefined,
      datePublished: isoDate(p.published_at), dateModified: isoDate(p.updated_at || p.published_at), mainEntityOfPage: url,
      keywords: p.tags || undefined,
      author: { '@type': 'Person', name: c.brand.name, jobTitle: c.brand.role, url: o, sameAs: [c.brand.linkedin].filter(Boolean) }
    },
    body: `<article class="post">
      <header>
        ${p.tags ? `<div class="ptags">${p.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        <h1>${esc(p.title)}</h1>
        ${p.summary ? `<p class="lede">${esc(p.summary)}</p>` : ''}
        <div class="pmeta">${esc(c.brand.name)} · ${esc(niceDate(p.published_at))} · ${readMins(p.body)} min read</div>
      </header>
      ${p.cover ? `<figure class="hero"><img src="${esc(p.cover)}" alt="${esc(p.cover_alt || '')}"></figure>` : ''}
      <div class="prose">${prose}</div>
      <div class="pshare"><a class="btn" href="${esc(share)}" target="_blank" rel="noopener">Share on LinkedIn</a>
        <a class="btn alt" href="/#book">Book a call</a></div>
    </article>`
  }));
});

// authenticated preview — renders drafts exactly as they will publish
app.get('/admin/preview/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id=?').get(+req.params.id);
  if (!p) return res.status(404).send('No such post.');
  const c = kvGet('content'), o = origin(req);
  res.type('html').send(shell({
    req, title: `[${p.status}] ${p.title}`, desc: p.summary || '', canonical: `${o}/blog/${p.slug}`, image: p.cover,
    body: `<article class="post">
      <header><div class="ptags"><span>Preview · ${esc(p.status)}</span></div>
        <h1>${esc(p.title)}</h1>${p.summary ? `<p class="lede">${esc(p.summary)}</p>` : ''}
        <div class="pmeta">${esc(c.brand.name)} · ${readMins(p.body)} min read</div></header>
      ${p.cover ? `<figure class="hero"><img src="${esc(p.cover)}" alt="${esc(p.cover_alt || '')}"></figure>` : ''}
      <div class="prose">${renderMarkdown(p.body)}</div></article>`
  }));
});

app.get('/rss.xml', (req, res) => {
  const c = kvGet('content'), o = origin(req);
  const items = pubPosts().slice(0, 30).map(p => `<item><title>${esc(p.title)}</title><link>${o}/blog/${esc(p.slug)}</link>
<guid isPermaLink="true">${o}/blog/${esc(p.slug)}</guid><pubDate>${new Date(String(p.published_at).replace(' ', 'T') + 'Z').toUTCString()}</pubDate>
<description>${esc(p.summary || stripMd(p.body).slice(0, 300))}</description></item>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>${esc(c.brand.name)} — Articles</title><link>${o}/blog</link>
<description>${esc(c.seo.description)}</description><language>en</language>${items}</channel></rss>`);
});

app.get('/sitemap.xml', (req, res) => {
  const o = origin(req);
  const urls = [`<url><loc>${o}/</loc><priority>1.0</priority></url>`, `<url><loc>${o}/blog</loc><priority>0.8</priority></url>`]
    .concat(pubPosts().map(p => `<url><loc>${o}/blog/${esc(p.slug)}</loc><lastmod>${String(p.updated_at || p.published_at).slice(0, 10)}</lastmod><priority>0.7</priority></url>`));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
});

app.get('/robots.txt', (req, res) =>
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin(req)}/sitemap.xml\n`));

// Admin is rendered rather than sent raw, so its stylesheet link gets the same hash.
// This MUST stay above express.static: static serves public/admin/index.html for
// /admin/ by itself, which would ship {{V}} to the browser unsubstituted.
app.get(['/admin', '/admin/'], (req, res) => res.type('html').send(
  fs.readFileSync(path.join(__dirname, 'public', 'admin', 'index.html'), 'utf8')
    .replaceAll('{{V}}', assetV('tokens.css'))));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', setHeaders: (r, p) => { if (p.endsWith('.html')) r.setHeader('Cache-Control', 'no-cache'); } }));

// styled 404 instead of Express's bare "Cannot GET /x"
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).type('html').send(shell({
    req, title: 'Page not found', desc: 'That page does not exist.',
    canonical: origin(req) + req.path,
    body: `<article class="post notfound"><h1>Page not found</h1>
      <p class="lede">That link does not point anywhere on this site.</p>
      <div class="pshare"><a class="btn" href="/">Go to the homepage</a><a class="btn alt" href="/blog">Read the articles</a></div></article>`
  }));
});

app.listen(PORT, () => console.log(`Site: http://localhost:${PORT}   Admin: http://localhost:${PORT}/admin`));
