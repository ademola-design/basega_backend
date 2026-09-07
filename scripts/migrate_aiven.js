/**
 * One-click migration runner for Aiven Cloud MySQL
 */

const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')

async function runAivenMigration() {
  const password = process.argv[2]
  if (!password) {
    console.error('❌ Please pass the Aiven password: node scripts/migrate_aiven.js <password>')
    process.exit(1)
  }

  const config = {
    host: 'mysql-183d74f5-ademolaadegbola7209-5a0c.g.aivencloud.com',
    port: 28655,
    user: 'avnadmin',
    password: password,
    database: 'defaultdb',
    multipleStatements: true,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 15000,
  }

  console.log('\n🚀 Connecting to Aiven Cloud MySQL...')
  const connection = await mysql.createConnection(config)
  console.log('✅ Connected to Aiven!')

  try {
    let sql = fs.readFileSync(path.join(__dirname, '..', 'database.sql'), 'utf8')
    
    // Strip "CREATE DATABASE" and "USE basega_db;" since Aiven uses "defaultdb"
    sql = sql.replace(/CREATE DATABASE IF NOT EXISTS basega_db[^;]*;/i, '')
    sql = sql.replace(/USE basega_db;/i, '')

    console.log('📦 Creating all tables and initial admin seed on Aiven...')
    await connection.query(sql)
    console.log('✅ All tables successfully created on Aiven Cloud MySQL!\n')
  } catch (err) {
    console.error('❌ Migration failed:', err.message)
  } finally {
    await connection.end()
  }
}

runAivenMigration()
