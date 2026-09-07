/**
 * BASEGA Alumni Association — Database Disaster Recovery & Restore Utility
 *
 * Usage:
 *   node scripts/restore.js <optional_filename_in_backups_folder>
 * Example:
 *   node scripts/restore.js basega_backup_2026-09-07T22-00-00.sql
 * (If no file is specified, it automatically restores the latest backup found)
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')

const BACKUP_DIR = path.join(__dirname, '..', 'backups')

async function runRestore() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.error('❌ No backups directory found at:', BACKUP_DIR)
    process.exit(1)
  }

  const requestedFile = process.argv[2]
  let targetPath = ''

  if (requestedFile) {
    targetPath = path.isAbsolute(requestedFile) ? requestedFile : path.join(BACKUP_DIR, requestedFile)
  } else {
    // Pick newest .sql file in backups directory
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time)

    if (files.length === 0) {
      console.error('❌ No .sql backup files found in:', BACKUP_DIR)
      process.exit(1)
    }
    targetPath = path.join(BACKUP_DIR, files[0].name)
  }

  if (!fs.existsSync(targetPath)) {
    console.error('❌ Backup file not found at:', targetPath)
    process.exit(1)
  }

  console.log(`\n🔄 [${new Date().toISOString()}] Restoring database...`)
  console.log(`   Source file: ${targetPath}`)
  console.log(`   Target DB:   ${process.env.DB_NAME} @ ${process.env.DB_HOST || 'localhost'}`)

  const sqlContent = fs.readFileSync(targetPath, 'utf8')

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  })

  try {
    console.log('   Executing recovery statements...')
    await connection.query(sqlContent)
    console.log('✅ Database restore completed successfully!\n')
  } catch (err) {
    console.error('❌ Recovery execution error:', err.message)
    process.exit(1)
  } finally {
    await connection.end()
  }
}

runRestore()
