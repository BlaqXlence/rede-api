const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

pool.on('error', (err) => {
  console.error('Database pool error:', err.message)
})

async function query(text, params) {
  const start = Date.now()
  try {
    const result = await pool.query(text, params)
    const duration = Date.now() - start
    if (process.env.NODE_ENV === 'development') {
      console.log(`Query (${duration}ms):`, text.slice(0, 60))
    }
    return result
  } catch (err) {
    console.error('Query error:', err.message, '\nSQL:', text)
    throw err
  }
}

module.exports = { query, pool }
