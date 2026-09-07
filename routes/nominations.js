const router    = require('express').Router()
const pool      = require('../config/db')
const auth      = require('../middleware/auth')
const adminOnly = require('../middleware/adminOnly')
const { body, validationResult } = require('express-validator')

// Columns every public/admin nomination read returns. The honoree's photo and
// details come from the linked member row, so they stay in sync with whatever
// that member has on their profile.
const NOMINEE_FIELDS = `
  n.id, n.nominee_name, n.nominee_member_id, n.reason, n.month_year,
  n.status, n.created_at,
  nm.first_name AS nominee_first_name,
  nm.last_name  AS nominee_last_name,
  nm.title      AS nominee_title,
  nm.photo_url  AS nominee_photo_url,
  nm.class_set  AS nominee_class_set,
  nm.profession AS nominee_profession,
  nm.company    AS nominee_company,
  nm.city       AS nominee_city,
  nm.state      AS nominee_state`

const NOMINEE_JOIN = 'LEFT JOIN members nm ON n.nominee_member_id = nm.id'

// ──────────────────────────────────────────
// GET /api/nominations  — Public: selected honorees, newest month first.
// At most one per month, enforced by PUT /:id/select below.
// ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ${NOMINEE_FIELDS}
       FROM nominations n
       ${NOMINEE_JOIN}
       WHERE n.status = 'selected'
       ORDER BY n.created_at DESC
       LIMIT 12`
    )
    res.json(rows)
  } catch (err) {
    console.error('GET /nominations error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// GET /api/nominations/current  — Public: the single current honoree
// ──────────────────────────────────────────
router.get('/current', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ${NOMINEE_FIELDS}
       FROM nominations n
       ${NOMINEE_JOIN}
       WHERE n.status = 'selected'
       ORDER BY n.created_at DESC
       LIMIT 1`
    )
    res.json(rows[0] || null)
  } catch (err) {
    console.error('GET /nominations/current error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// POST /api/nominations  — Any logged-in member nominates a fellow member
// ──────────────────────────────────────────
router.post('/', auth, [
  body('nomineeMemberId').isInt({ min: 1 }).withMessage('Please choose a member to nominate'),
  // Fix #7: Cap reason length to prevent oversized payloads filling the DB.
  body('reason').trim().isLength({ min: 50, max: 2000 }).withMessage('Reason must be between 50 and 2000 characters'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const nomineeMemberId = parseInt(req.body.nomineeMemberId)
  const { reason } = req.body
  const monthYear = new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })

  try {
    // The nominee must be a real, approved member — that is what guarantees
    // there is a profile (and photo) to feature if they win.
    const [members] = await pool.execute(
      `SELECT id, title, first_name, last_name, class_set, profession
       FROM members
       WHERE id = ? AND role = 'member' AND status IN ('approved','financial')`,
      [nomineeMemberId]
    )
    if (members.length === 0) {
      return res.status(400).json({ error: 'That member could not be found, or is not yet approved.' })
    }

    if (nomineeMemberId === req.user.id) {
      return res.status(400).json({ error: 'You cannot nominate yourself.' })
    }

    // One live nomination per nominee per month.
    const [dupes] = await pool.execute(
      `SELECT id FROM nominations
       WHERE nominee_member_id = ? AND month_year = ? AND status <> 'rejected'`,
      [nomineeMemberId, monthYear]
    )
    if (dupes.length > 0) {
      return res.status(409).json({ error: 'This member has already been nominated this month.' })
    }

    const m = members[0]
    // nominee_name is a display snapshot; the live data comes from the join.
    const snapshot = `${m.title ? m.title + ' ' : ''}${m.first_name} ${m.last_name}`

    await pool.execute(
      `INSERT INTO nominations (nominee_name, nominee_member_id, nominator_id, reason, month_year)
       VALUES (?,?,?,?,?)`,
      [snapshot, nomineeMemberId, req.user.id, reason, monthYear]
    )
    res.status(201).json({ message: 'Nomination submitted.' })
  } catch (err) {
    console.error('POST /nominations error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// GET /api/nominations/all  — Admin: every nomination
// ──────────────────────────────────────────
router.get('/all', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ${NOMINEE_FIELDS},
              nr.first_name AS nominator_first_name,
              nr.last_name  AS nominator_last_name
       FROM nominations n
       ${NOMINEE_JOIN}
       LEFT JOIN members nr ON n.nominator_id = nr.id
       ORDER BY n.created_at DESC`
    )
    res.json(rows)
  } catch (err) {
    console.error('GET /nominations/all error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// PUT /api/nominations/:id/select  — Admin crowns the Alumni of the Month
//
// Exactly one honoree per month. Crowning someone new for a month steps the
// previous holder back to 'pending' in the same transaction, so the two
// updates can never both land and leave two winners on the public page.
// ──────────────────────────────────────────
router.put('/:id/select', auth, adminOnly, async (req, res) => {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [rows] = await conn.execute(
      'SELECT id, nominee_name, month_year FROM nominations WHERE id = ? FOR UPDATE',
      [req.params.id]
    )
    if (rows.length === 0) {
      await conn.rollback()
      return res.status(404).json({ error: 'Nomination not found.' })
    }
    const nom = rows[0]

    const [demoted] = await conn.execute(
      `UPDATE nominations SET status = 'pending'
       WHERE month_year = ? AND status = 'selected' AND id <> ?`,
      [nom.month_year, nom.id]
    )

    await conn.execute("UPDATE nominations SET status = 'selected' WHERE id = ?", [nom.id])

    await conn.execute(
      'INSERT INTO activity_log (member_id, action) VALUES (?, ?)',
      [req.user.id, `${nom.nominee_name} was selected as Alumni of the Month for ${nom.month_year}.`]
    )

    await conn.commit()
    res.json({
      message:  'Nominee selected.',
      replaced: demoted.affectedRows,   // lets the admin UI say who was displaced
    })
  } catch (err) {
    await conn.rollback()
    console.error('PUT /nominations/:id/select error:', err)
    res.status(500).json({ error: 'Server error.' })
  } finally {
    conn.release()
  }
})

// ──────────────────────────────────────────
// PUT /api/nominations/:id/reject  — Admin rejects a nomination
// ──────────────────────────────────────────
router.put('/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    await pool.execute(
      "UPDATE nominations SET status = 'rejected' WHERE id = ?", [req.params.id]
    )
    res.json({ message: 'Nomination rejected.' })
  } catch (err) {
    console.error('PUT /nominations/:id/reject error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// DELETE /api/nominations/:id  — Admin deletes a nomination
// ──────────────────────────────────────────
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.execute('DELETE FROM nominations WHERE id = ?', [req.params.id])
    res.json({ message: 'Nomination deleted.' })
  } catch (err) {
    console.error('DELETE /nominations/:id error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

module.exports = router
