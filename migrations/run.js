/**
 * Runs a .sql migration using the same database credentials the server uses,
 * so there is no password to type and no mysql.exe path to get right.
 *
 *   node migrations/run.js 001_nominee_member_link.sql
 *
 * Safe to run twice: steps that are already applied are reported as "skipped"
 * rather than failing the whole run.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const fs    = require('fs')
const path  = require('path')
const mysql = require('mysql2/promise')

// Errors that mean "this step is already done".
const ALREADY_APPLIED = new Set([
  'ER_DUP_FIELDNAME',   // column already exists
  'ER_DUP_KEYNAME',     // index or constraint already exists
  'ER_FK_DUP_NAME',     // foreign key already exists
])

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node migrations/run.js <file.sql>')
    process.exit(1)
  }

  const fullPath = path.isAbsolute(file) ? file : path.join(__dirname, file)
  if (!fs.existsSync(fullPath)) {
    console.error(`Not found: ${fullPath}`)
    process.exit(1)
  }

  if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
    console.error('DB_USER and DB_PASSWORD must be set in .env before running migrations.')
    process.exit(1)
  }

  // Strip comment lines, then split into statements.
  const statements = fs.readFileSync(fullPath, 'utf8')
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME     || 'basega_db',
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' || (process.env.DB_PORT && process.env.DB_PORT !== '3306')
      ? {
          rejectUnauthorized: true,
          ...(process.env.DB_SSL_CA
            ? { ca: fs.readFileSync(process.env.DB_SSL_CA, 'utf8') }
            : {}),
        }
      : undefined,
    multipleStatements: false,
  })

  console.log(`Connected to ${process.env.DB_NAME || 'basega_db'}`)
  console.log(`Running ${path.basename(fullPath)} — ${statements.length} statement(s)\n`)

  let applied = 0, skipped = 0

  for (const [i, sql] of statements.entries()) {
    const label = sql.replace(/\s+/g, ' ').slice(0, 70)
    try {
      const [result] = await conn.query(sql)
      const rows = result?.affectedRows
      console.log(`  ✅ [${i + 1}] ${label}${rows !== undefined ? `  (${rows} row(s))` : ''}`)
      applied++
    } catch (err) {
      if (ALREADY_APPLIED.has(err.code)) {
        console.log(`  ⏭️  [${i + 1}] ${label}\n        already applied — skipping`)
        skipped++
      } else {
        console.error(`\n  ❌ [${i + 1}] ${label}\n        ${err.code}: ${err.message}\n`)
        await conn.end()
        process.exit(1)
      }
    }
  }

  console.log(`\nDone. ${applied} applied, ${skipped} already in place.`)
  await conn.end()
}

main().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
