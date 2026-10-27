// Postgres access for the site. Every query goes through here, so the routes stay
// readable: `?` placeholders are converted to $1, $2, ... for the pg driver.
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Keep the shapes the rest of the app already expects, so the date helpers and the
// JSON responses do not change:
//   timestamps -> 'YYYY-MM-DD HH:MM:SS' in UTC (what SQLite stored)
//   dates      -> 'YYYY-MM-DD' strings
//   bigint ids and counts -> plain numbers
types.setTypeParser(1184, v => new Date(v).toISOString().slice(0, 19).replace('T', ' '));
types.setTypeParser(1082, v => v);
types.setTypeParser(20, v => Number(v));

let pool = null;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set. Add your Neon connection string to the environment.');
    }
    // Small pool: a serverless function handles one request at a time, and Neon's
    // free tier caps the number of connections. DB_POOL_MAX=1 is for single-connection
    // local test servers such as PGlite.
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: +(process.env.DB_POOL_MAX || 3), idleTimeoutMillis: 10000 });
    // Timestamps are written as naive UTC strings. Neon projects default to the UTC timezone,
    // so no per-connection SET is needed (and running one races the app's own queries).
  }
  return pool;
}

const toPg = sql => { let n = 0; return sql.replace(/\?/g, () => '$' + (++n)); };

async function all(sql, params = []) {
  const r = await getPool().query(toPg(sql), params);
  return r.rows;
}
async function one(sql, params = []) {
  return (await all(sql, params))[0];
}
// Returns { changes, rows }. For an insert that needs the new id, add RETURNING id.
async function run(sql, params = []) {
  const r = await getPool().query(toPg(sql), params);
  return { changes: r.rowCount, rows: r.rows };
}

// Creates any missing tables and indexes. Safe to run on every cold start.
async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await getPool().query(schema);
}

module.exports = { all, one, run, init };
