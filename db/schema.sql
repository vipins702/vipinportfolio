-- Vipin Singh site: PostgreSQL schema for Neon.
-- Ported from the SQLite schema in data/site.db. Safe to run more than once
-- (every statement uses IF NOT EXISTS).
--
-- Run in: Neon dashboard -> SQL Editor -> paste -> Run.

-- Site content and settings, stored as JSON text (key: 'content', 'settings', 'secret', ...)
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- Admin users
CREATE TABLE IF NOT EXISTS users (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       TEXT UNIQUE,
  name        TEXT,
  pass        TEXT,
  must_change BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contact-form enquiries
CREATE TABLE IF NOT EXISTS leads (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT,
  email      TEXT,
  phone      TEXT,
  company    TEXT,
  service    TEXT,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  source     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Booked calls
CREATE TABLE IF NOT EXISTS appointments (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT,
  email      TEXT,
  phone      TEXT,
  topic      TEXT,
  mode       TEXT,
  date       DATE,
  time       TEXT,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stops double-booking under a race. Cancelled slots are free to re-book.
CREATE UNIQUE INDEX IF NOT EXISTS ux_slot
  ON appointments (date, time)
  WHERE status <> 'cancelled';

-- Outgoing mail record (SMTP unset -> mail is logged here, never sent)
CREATE TABLE IF NOT EXISTS mail_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_addr    TEXT,
  subject    TEXT,
  body       TEXT,
  status     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Blog posts
CREATE TABLE IF NOT EXISTS posts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug         TEXT UNIQUE,
  title        TEXT,
  summary      TEXT,
  body         TEXT,
  cover        TEXT,
  cover_alt    TEXT,
  tags         TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_posts_pub ON posts (status, published_at DESC);

-- Simple page-view analytics
CREATE TABLE IF NOT EXISTS pageviews (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path       TEXT,
  source     TEXT,
  referrer   TEXT,
  visitor    TEXT,
  device     TEXT,
  day        DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pv_day ON pageviews (day);

-- CRM: customers
CREATE TABLE IF NOT EXISTS customers (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT UNIQUE,
  phone      TEXT,
  company    TEXT,
  title      TEXT,
  stage      TEXT,
  owner      TEXT,
  source     TEXT,
  fields     TEXT NOT NULL DEFAULT '{}',
  last_touch TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cust_stage ON customers (stage);

-- CRM: links a customer to a lead or appointment
CREATE TABLE IF NOT EXISTS customer_links (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  ref_id      BIGINT NOT NULL,
  UNIQUE (kind, ref_id)
);

-- CRM: timeline entries per customer
CREATE TABLE IF NOT EXISTS activities (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT,
  body        TEXT,
  ref_kind    TEXT,
  ref_id      BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_act_cust ON activities (customer_id, created_at DESC);

-- CRM: follow-up tasks
CREATE TABLE IF NOT EXISTS tasks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  notes       TEXT,
  due         DATE,
  priority    TEXT NOT NULL DEFAULT 'normal',
  done_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_task_open ON tasks (done_at, due);

-- Images uploaded from the CMS. Stored in the database because a serverless
-- function cannot keep files on disk.
CREATE TABLE IF NOT EXISTS uploads (
  name       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CRM: links between two customers (e.g. referred-by, same company)
CREATE TABLE IF NOT EXISTS relationships (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_id    BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  to_id      BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_id, to_id, type)
);
