const mysql = require('mysql2/promise')
const fs = require('fs')
require('dotenv').config()

// Fix #4: Fail fast if critical DB credentials are missing rather than
// silently falling back to root / empty password.
if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
  console.error('❌  DB_USER and DB_PASSWORD must be set in .env — refusing to start.')
  process.exit(1)
}

const sslEnabled = process.env.DB_SSL === 'true' ||
  (process.env.DB_PORT && process.env.DB_PORT !== '3306')

const pool = mysql.createPool({
  host:              process.env.DB_HOST     || 'localhost',
  port:              parseInt(process.env.DB_PORT || '3306'),
  database:          process.env.DB_NAME     || 'basega_db',
  user:              process.env.DB_USER,
  password:          process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  connectTimeout:     10000,   // Fix #12: fail after 10 s if DB is unreachable
  ssl: sslEnabled
    ? {
        rejectUnauthorized: true,
        ...(process.env.DB_SSL_CA
          ? { ca: fs.readFileSync(process.env.DB_SSL_CA, 'utf8') }
          : {}),
      }
    : undefined,
})

// Test the connection on startup
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL connected to:', process.env.DB_NAME)
    conn.release()
  })
  .catch(err => {
    console.error('❌ MySQL connection failed:', err.message)
    process.exit(1)
  })

module.exports = pool
