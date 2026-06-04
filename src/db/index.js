const { Pool } = require('pg')

const pool = new Pool({
  connectionString:      process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max:                    10,
  idleTimeoutMillis:      600000,   // 10 min — Supabase drops at 10min
  connectionTimeoutMillis:5000,
  keepAlive:              true,
  keepAliveInitialDelayMillis: 10000,
})

pool.on('error', (err) => {
  console.error('Database pool error:', err.message)
})

// ── Keepalive ping every 4 minutes ───────────────────────────
// Supabase terminates idle connections after ~5 minutes
// This prevents that by pinging the DB regularly
setInterval(async () => {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    console.error('Keepalive ping failed:', err.message)
  }
}, 4 * 60 * 1000) // every 4 minutes

async function query(text, params) {
  const start = Date.now()
  try {
    const result = await pool.query(text, params)
    if (process.env.NODE_ENV === 'development') {
      console.log(`Query (${Date.now() - start}ms):`, text.slice(0, 60))
    }
    return result
  } catch (err) {
    // On connection timeout — retry once
    if (err.message?.includes('timeout') || err.message?.includes('terminated')) {
      console.log('Retrying query after connection error...')
      try {
        return await pool.query(text, params)
      } catch (retryErr) {
        console.error('Query error:', retryErr.message, '\nSQL:', text)
        throw retryErr
      }
    }
    console.error('Query error:', err.message, '\nSQL:', text)
    throw err
  }
}

module.exports = { query, pool }
