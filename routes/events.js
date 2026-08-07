const router    = require('express').Router()
const pool      = require('../config/db')
const auth      = require('../middleware/auth')
const adminOnly = require('../middleware/adminOnly')
const { body, validationResult } = require('express-validator')

// GET /api/events  — Public list
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.title, e.description, e.event_date, e.location, e.type, e.image_url,
              m.first_name, m.last_name
       FROM events e
       LEFT JOIN members m ON e.created_by = m.id
       ORDER BY e.event_date ASC`
    )
    res.json(rows)
  } catch (err) {
    console.error('GET /events error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// GET /api/events/:id  — Single event
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM events WHERE id = ?', [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Event not found.' })
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// POST /api/events  — Admin creates event
router.post('/', auth, adminOnly, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('eventDate').notEmpty().withMessage('Event date is required'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { title, description, eventDate, location, type, imageUrl } = req.body
  try {
    const [result] = await pool.execute(
      'INSERT INTO events (title, description, event_date, location, type, image_url, created_by) VALUES (?,?,?,?,?,?,?)',
      [title, description || null, eventDate, location || null, type || 'General', imageUrl || null, req.user.id]
    )
    res.status(201).json({ message: 'Event created.', id: result.insertId })
  } catch (err) {
    console.error('POST /events error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// PUT /api/events/:id  — Admin updates event
router.put('/:id', auth, adminOnly, async (req, res) => {
  const { title, description, eventDate, location, type, imageUrl } = req.body
  try {
    await pool.execute(
      'UPDATE events SET title=?, description=?, event_date=?, location=?, type=?, image_url=? WHERE id=?',
      [title, description, eventDate, location, type, imageUrl, req.params.id]
    )
    res.json({ message: 'Event updated.' })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// DELETE /api/events/:id  — Admin deletes event
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.execute('DELETE FROM events WHERE id = ?', [req.params.id])
    res.json({ message: 'Event deleted.' })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

module.exports = router
