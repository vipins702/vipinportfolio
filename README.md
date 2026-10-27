# Vipin Singh — Portfolio + CMS

> **Premium portfolio website with built-in Content Management System, lead capture, and appointment scheduling.**
> Built by [VSM Tech & AI Solutions Agency](https://vsmtech.ai)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
  - [Windows (One-Click)](#windows-one-click)
  - [Manual Setup](#manual-setup)
- [Environment Variables](#environment-variables)
- [Admin Panel](#admin-panel)
  - [Dashboard](#dashboard)
  - [Leads Management](#leads-management)
  - [Appointments Management](#appointments-management)
  - [Content Editor (CMS)](#content-editor-cms)
  - [Settings](#settings)
- [Content Structure](#content-structure)
- [API Reference](#api-reference)
  - [Public API](#public-api)
  - [Admin API](#admin-api)
- [Appointment Booking System](#appointment-booking-system)
- [Security](#security)
- [Deployment](#deployment)
  - [Production Checklist](#production-checklist)
  - [Reverse Proxy (Nginx)](#reverse-proxy-nginx)
  - [Reverse Proxy (Caddy)](#reverse-proxy-caddy)
  - [Docker](#docker)
- [Backup & Restore](#backup--restore)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

A self-contained, single-server portfolio website for **Vipin Singh** — AI & Enterprise Data Consultant. The site includes:

- A **scroll-scrubbed hero** with 120-frame video animation
- Full **CMS** — edit every piece of text, list, and image from the admin panel
- **Lead capture** via contact form with status tracking (new → contacted → qualified → won/lost)
- **Appointment booking** with live slot availability and double-booking prevention
- **Admin dashboard** with stats, CSV export, user management, and password change
- Zero external databases — everything runs on **SQLite** (built into Node 22.13+)

---

## Features

| Feature | Description |
|---|---|
| **CMS / Content Editor** | Edit all website text, lists, images, and SEO metadata. Changes go live on save. |
| **Lead Management** | Capture, track, search, and export leads from the contact form. |
| **Appointment Scheduler** | Real-time slot availability; DB-level unique constraint prevents double-booking. |
| **Scroll-Scrubbed Hero** | 120 WebP frames rendered on `<canvas>`, chapter transitions, parallax mouse tracking. |
| **Admin Users** | Multiple admin accounts with scrypt-hashed passwords and signed session cookies. |
| **Image Uploads** | Upload JPG, PNG, or WebP images (up to 8 MB) directly from the content editor. |
| **CSV Export** | Export leads and appointments as CSV files from the admin panel. |
| **Rate Limiting** | Contact and booking forms are rate-limited (5 requests per 10 minutes per IP). |
| **Honeypot Spam Protection** | Hidden field on both forms to catch bots. |
| **SEO** | Configurable `<title>`, `<meta description>`, and Open Graph tags. |
| **Responsive Design** | Mobile-first layout with adaptive navigation and grid breakpoints. |
| **Accessibility** | Focus-visible outlines, ARIA labels, `prefers-reduced-motion` support. |
| **Security Headers** | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` set on every response. |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | **Node.js 22.13+** (LTS) |
| Framework | **Express 4.21** |
| Database | **SQLite** via `node:sqlite` (built-in, zero dependencies to compile) |
| Auth | **scrypt** password hashing + **HMAC-SHA256** signed session cookies |
| Front-end | Vanilla HTML/CSS/JS — no build step, no bundler |
| Fonts | [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif), [Manrope](https://fonts.google.com/specimen/Manrope) (Google Fonts) |

---

## Project Structure

```
vipin-singh-site/
└── site/
    ├── server.js              # Express server: API routes, auth, DB, page rendering
    ├── default-content.js     # Default CMS content (used on first run & reset)
    ├── package.json           # Project metadata & dependencies
    ├── start.bat              # Windows one-click launcher
    ├── README.md              # This file
    │
    ├── public/                # Static assets (served by Express)
    │   ├── index.html         # Public site (single-page, JS-rendered)
    │   ├── admin/
    │   │   └── index.html     # Admin panel (single-page app)
    │   ├── frames/            # 120 WebP video frames (f001.webp … f120.webp)
    │   ├── img/
    │   │   └── vipin.jpg      # About section photo
    │   └── uploads/           # User-uploaded images (created at runtime)
    │
    └── data/                  # SQLite database (created at runtime)
        └── site.db            # All CMS content, leads, appointments, users
```

---

## Quick Start

### Windows (One-Click)

1. Install [Node.js LTS](https://nodejs.org) (v22.13 or newer)
2. Double-click **`start.bat`**
3. The script installs dependencies, starts the server, and opens `http://localhost:3000`

> **⚠️ Do NOT open `public/index.html` directly in a browser.** The page requires the running server to fetch content via API.

### Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Start the server (with default admin credentials)
npm start

# 3. Or set custom admin credentials on first run
ADMIN_EMAIL=you@domain.com ADMIN_PASSWORD='YourSecurePass#1' npm start
```

**Endpoints after start:**

| URL | Description |
|---|---|
| `http://localhost:3000` | Public portfolio website |
| `http://localhost:3000/admin` | Admin CMS panel |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `./data` | Directory for the SQLite database file |
| `ADMIN_EMAIL` | `admin@vsmtech.ai` | Admin email (used only on first run to seed the admin account) |
| `ADMIN_PASSWORD` | `ChangeMe@123` | Admin password (used only on first run; shows a banner until changed) |

---

## Admin Panel

Access the admin panel at **`/admin`**. Sign in with your admin credentials.

### Dashboard

- **Stats cards**: New leads, total leads, pending appointments, total appointments
- **Upcoming appointments**: Next 5 appointments (sorted by date/time)
- **Latest leads**: 5 most recent contact form submissions
- **Password change banner**: Shown if using the default password

### Leads Management

- **View all leads** with search/filter
- **Status tracking**: `new` → `contacted` → `qualified` → `won` / `lost`
- **Delete** individual leads
- **Export CSV** with all lead fields

### Appointments Management

- **View all booking requests** with search/filter
- **Status tracking**: `pending` → `confirmed` → `completed` / `cancelled`
- Cancelled appointments **free up the time slot** for new bookings
- **Export CSV** with all appointment fields

### Content Editor (CMS)

The CMS is organized into **tabs**, one for each section of the website:

| Tab | Controls |
|---|---|
| **Brand & Contact** | Name, role, LinkedIn URL, email, phone, location |
| **SEO** | Page title, meta description (also sets Open Graph tags) |
| **Hero** | Chapter labels, titles, subtitles (scroll-scrubbed sections), badge tags |
| **Story** | Two-line headline and body paragraph |
| **Services** | Section heading, intro text, and list of service cards (title + description) |
| **Results** | Section heading, intro text, and metrics (value, suffix, label, note) |
| **Process** | Section heading, intro text, and process steps (title + description) |
| **About** | Heading, bio text, photo upload, stat badges |
| **Booking** | Heading, intro text, and topic options for the dropdown |
| **Contact** | Section heading and intro text |
| **Footer** | Footer note text |

**Key actions:**
- **Save changes** — publishes immediately to the live site
- **Restore defaults** — resets all content to `default-content.js`
- **Image upload** — supports JPG, PNG, WebP (up to 8 MB)

### Settings

| Setting | Description |
|---|---|
| **Booking days** | Which days of the week are open for appointments |
| **Hours** | Opening and closing times |
| **Slot length** | Duration of each time slot (minimum 10 minutes) |
| **Horizon** | How many days ahead visitors can book (max 180) |
| **Password** | Change the current admin password |
| **Admin users** | Add/remove admin accounts |

---

## Content Structure

All CMS content is stored as a single JSON document in the `kv` table (key: `content`). The default structure is defined in [`default-content.js`](./default-content.js):

```js
{
  brand:    { name, role, linkedin, email, phone, location },
  seo:      { title, description },
  hero:     { chapters: [{ label, title, text }], badges: [...] },
  story:    { line1, line2, text },
  services: { heading, intro, items: [{ title, text }] },
  impact:   { heading, intro, metrics: [{ value, suffix, label, note }] },
  process:  { heading, intro, steps: [{ title, text }] },
  about:    { heading, text, photo, stats: [{ value, label }] },
  booking:  { heading, text, topics: [...] },
  contact:  { heading, text },
  footer:   { note }
}
```

---

## API Reference

### Public API

These endpoints require **no authentication**.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/content` | Returns the full CMS content JSON |
| `GET` | `/api/slots?date=YYYY-MM-DD` | Returns available time slots for a given date |
| `POST` | `/api/leads` | Submit a lead (contact form). Rate limited. |
| `POST` | `/api/appointments` | Book an appointment. Rate limited. |

#### `POST /api/leads`

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+1234567890",
  "company": "Acme Corp",
  "service": "Data migration",
  "message": "We need help migrating our legacy database."
}
```

#### `POST /api/appointments`

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+1234567890",
  "topic": "AI / LLM solution",
  "mode": "Video call",
  "date": "2026-11-15",
  "time": "14:00",
  "message": "Looking to discuss RAG implementation."
}
```

### Admin API

All admin endpoints require a valid session cookie (`sid`). Prefix: `/api/admin/`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/admin/login` | Authenticate and receive a session cookie |
| `POST` | `/admin/logout` | Clear the session cookie |
| `GET` | `/admin/me` | Get the current authenticated user |
| `GET` | `/admin/stats` | Dashboard statistics |
| `GET` | `/admin/leads` | List all leads |
| `PATCH` | `/admin/leads/:id` | Update lead status |
| `DELETE` | `/admin/leads/:id` | Delete a lead |
| `GET` | `/admin/leads.csv` | Export leads as CSV |
| `GET` | `/admin/appointments` | List all appointments |
| `PATCH` | `/admin/appointments/:id` | Update appointment status |
| `DELETE` | `/admin/appointments/:id` | Delete an appointment |
| `GET` | `/admin/appointments.csv` | Export appointments as CSV |
| `PUT` | `/admin/content` | Save updated CMS content |
| `POST` | `/admin/content/reset` | Reset CMS content to defaults |
| `GET` | `/admin/settings` | Get booking settings |
| `PUT` | `/admin/settings` | Update booking settings |
| `POST` | `/admin/password` | Change the current user's password |
| `GET` | `/admin/users` | List all admin users |
| `POST` | `/admin/users` | Create a new admin user |
| `DELETE` | `/admin/users/:id` | Delete an admin user |
| `POST` | `/admin/upload` | Upload an image (raw body, `Content-Type` header) |

---

## Appointment Booking System

### How It Works

1. **Visitor picks a date** on the booking form
2. **Client fetches** `/api/slots?date=YYYY-MM-DD` → returns available time slots
3. Slots are calculated based on:
   - Admin-configured **working days**, **hours**, **slot duration**, and **horizon**
   - Already-booked slots (excluding cancelled ones)
   - Past time slots on the current day (1-hour buffer)
4. **Visitor picks a slot** and submits the form
5. Server validates the slot is still available
6. A **`UNIQUE INDEX`** on `(date, time)` at the database level prevents any race-condition double-bookings
7. Admin can **confirm** or **cancel** appointments; cancelled slots become available again

### Slot Calculation Formula

```
For each minute from start_time to end_time (step = slot_duration):
  - Skip if already booked (and not cancelled)
  - Skip if today and less than 1 hour from now
  - Otherwise, the slot is available
```

---

## Security

| Mechanism | Implementation |
|---|---|
| **Password Hashing** | `scrypt` with random 16-byte salt (64-byte key) |
| **Password Verification** | `crypto.timingSafeEqual` to prevent timing attacks |
| **Session Tokens** | `HMAC-SHA256` signed cookies (`HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS) |
| **Token Expiry** | 7 days from issuance |
| **Rate Limiting** | In-memory per-IP rate limiter on login (8/10min), forms (5/10min) |
| **Honeypot** | Hidden `website` field on forms — if filled, the submission is silently accepted but not stored |
| **Input Sanitization** | All inputs are trimmed and length-capped via `clean()` |
| **HTML Escaping** | Server-side and client-side `esc()` functions prevent XSS |
| **Security Headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin` |
| **CSV Injection Guard** | Leading `=`, `+`, `-`, `@` characters are escaped in CSV exports |
| **Upload Validation** | Only `image/jpeg`, `image/png`, `image/webp` accepted; random filenames |
| **Self-Delete Prevention** | Admin users cannot delete their own account |

---

## Deployment

### Production Checklist

- [ ] Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables on first start
- [ ] Change the default password immediately via Admin → Settings
- [ ] Put the server behind a **reverse proxy** with HTTPS (Nginx, Caddy, Cloudflare, etc.)
- [ ] Point `DATA_DIR` to a **persistent disk/volume** (so data survives redeployments)
- [ ] Set up automated **backups** of `data/site.db`
- [ ] Ensure `public/uploads/` is also on persistent storage
- [ ] Set `trust proxy` to match your proxy setup (currently `1`)

### Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name vipin-singh.com;

    ssl_certificate     /etc/letsencrypt/live/vipin-singh.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vipin-singh.com/privkey.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Reverse Proxy (Caddy)

```caddyfile
vipin-singh.com {
    reverse_proxy localhost:3000
}
```

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY site/ .
RUN npm ci --omit=dev
ENV DATA_DIR=/data
VOLUME ["/data", "/app/public/uploads"]
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t vipin-site .
docker run -d \
  -p 3000:3000 \
  -v site-data:/data \
  -v site-uploads:/app/public/uploads \
  -e ADMIN_EMAIL=you@domain.com \
  -e ADMIN_PASSWORD='YourSecurePass#1' \
  vipin-site
```

---

## Backup & Restore

### Backup

The SQLite database contains all CMS content, leads, appointments, and admin users:

```bash
# Copy the database file while the server is running (WAL mode is safe for this)
cp data/site.db backups/site-$(date +%Y%m%d).db

# Also backup uploaded images
tar czf backups/uploads-$(date +%Y%m%d).tar.gz public/uploads/
```

### Restore

```bash
# Stop the server, replace the database, restart
cp backups/site-20261021.db data/site.db
tar xzf backups/uploads-20261021.tar.gz
npm start
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| **"The server is not running"** shown in browser | You opened `public/index.html` directly. Use `start.bat` or `npm start`, then go to `http://localhost:3000` |
| **Node.js version error** | This project requires **Node.js 22.13+** because it uses the built-in `node:sqlite` module. Download from [nodejs.org](https://nodejs.org) |
| **Port already in use** | Set a different port: `PORT=3001 npm start` |
| **Forgot admin password** | Delete `data/site.db` and restart — a new admin account will be created |
| **Images not loading** | Ensure `public/uploads/` exists and has write permissions |
| **Booking shows no slots** | Check Settings → Booking availability (days, hours, horizon). Ensure the chosen date falls within the configured range |

---

## License

Proprietary. Developed by **VSM Tech & AI Solutions Agency** for **Vipin Singh**.
