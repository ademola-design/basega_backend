/**
 * BASEGA Alumni Association — Automated Database Backup Utility
 *
 * Can be run manually:
 *   node scripts/backup.js
 * Or automated via crontab / Task Scheduler / PM2:
 *   0 2 * * * cd /path/to/basega-backend && node scripts/backup.js >> backups/backup.log 2>&1
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const mysql = require('mysql2/promise')

const BACKUP_DIR = path.join(__dirname, '..', 'backups')
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10)

// Ensure backup folder exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupFilename = `basega_backup_${timestamp}.sql`
const backupPath = path.join(BACKUP_DIR, backupFilename)

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '3306',
  database: process.env.DB_NAME || 'basega_db',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
}

console.log(`\n📦 [${new Date().toISOString()}] Starting database backup...`)
console.log(`   Database: ${dbConfig.database} @ ${dbConfig.host}`)

/**
 * Fallback pure Node.js table dumper in case mysqldump binary isn't in PATH
 */
async function fallbackNodeDump() {
  console.log('   Using internal MySQL streaming dump engine...')
  const pool = mysql.createPool({
    host: dbConfig.host,
    port: parseInt(dbConfig.port),
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
  })

  let sqlDump = `-- ========================================================\n`
  sqlDump += `-- BASEGA Alumni Association Database Backup\n`
  sqlDump += `-- Generated: ${new Date().toISOString()}\n`
  sqlDump += `-- ========================================================\n\n`
  sqlDump += `SET FOREIGN_KEY_CHECKS=0;\n\n`

  try {
    const [tables] = await pool.query('SHOW TABLES')
    const tableKey = Object.keys(tables[0])[0]

    for (const row of tables) {
      const tableName = row[tableKey]

      // Get CREATE TABLE statement
      const [[createTableResult]] = await pool.query(`SHOW CREATE TABLE \`${tableName}\``)
      sqlDump += `-- Table structure for table \`${tableName}\`\n`
      sqlDump += `DROP TABLE IF EXISTS \`${tableName}\`;\n`
      sqlDump += `${createTableResult['Create Table']};\n\n`

      // Get table data
      const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``)
      if (rows.length > 0) {
        sqlDump += `-- Dumping data for table \`${tableName}\`\n`
        for (const dataRow of rows) {
          const keys = Object.keys(dataRow).map(k => `\`${k}\``).join(', ')
          const values = Object.values(dataRow).map(val => {
            if (val === null || val === undefined) return 'NULL'
            if (typeof val === 'number') return val
            if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`
            return mysql.escape(String(val))
          }).join(', ')
          sqlDump += `INSERT INTO \`${tableName}\` (${keys}) VALUES (${values});\n`
        }
        sqlDump += `\n`
      }
    }

    sqlDump += `SET FOREIGN_KEY_CHECKS=1;\n`
    fs.writeFileSync(backupPath, sqlDump, 'utf8')
    console.log(`✅ Backup successfully created at: ${backupPath}`)
  } finally {
    await pool.end()
  }
}

/**
 * Executes mysqldump if available; falls back to Node.js dump
 */
function runBackup() {
  const mysqldumpCmd = `mysqldump -h ${dbConfig.host} -P ${dbConfig.port} -u ${dbConfig.user} ${dbConfig.password ? `-p"${dbConfig.password}"` : ''} ${dbConfig.database} > "${backupPath}"`

  exec(mysqldumpCmd, async (err) => {
    if (err) {
      // mysqldump failed or missing in environment PATH; use native streaming fallback
      try {
        await fallbackNodeDump()
        cleanOldBackups()
      } catch (fallbackErr) {
        console.error('❌ Backup failed:', fallbackErr.message)
        process.exit(1)
      }
    } else {
      console.log(`✅ mysqldump completed successfully: ${backupPath}`)
      cleanOldBackups()
    }
  })
}

/**
 * Prunes backups older than RETENTION_DAYS
 */
function cleanOldBackups() {
  const now = Date.now()
  const cutoffTime = now - RETENTION_DAYS * 24 * 60 * 60 * 1000

  fs.readdir(BACKUP_DIR, (err, files) => {
    if (err) return
    files.forEach(file => {
      if (file.endsWith('.sql')) {
        const filePath = path.join(BACKUP_DIR, file)
        fs.stat(filePath, (statErr, stats) => {
          if (!statErr && stats.mtimeMs < cutoffTime) {
            fs.unlink(filePath, () => {
              console.log(`🧹 Pruned expired backup: ${file}`)
            })
          }
        })
      }
    })
  })
}

runBackup()
