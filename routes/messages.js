const router = require('express').Router()
const pool   = require('../config/db')
const { body, validationResult } = require('express-validator')

// POST /api/messages  — Contact form submission (public)
router.post('/', [
  body('senderName').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('body').trim().notEmpty().withMessage('Message body is required'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { senderName, email, subject, body: msgBody } = req.body
  try {
    await pool.execute(
      'INSERT INTO messages (sender_name, email, subject, body) VALUES (?,?,?,?)',
      [senderName, email, subject || null, msgBody]
    )
    res.status(201).json({ message: 'Message sent. We will get back to you shortly.' })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// GET /api/messages  — Admin: all messages
const auth      = require('../middleware/auth')
const adminOnly = require('../middleware/adminOnly')

router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM messages ORDER BY created_at DESC'
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// PUT /api/messages/:id/read  — Admin marks message as read
router.put('/:id/read', auth, adminOnly, async (req, res) => {
  try {
    await pool.execute('UPDATE messages SET is_read = 1 WHERE id = ?', [req.params.id])
    res.json({ message: 'Marked as read.' })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// DELETE /api/messages/:id  — Admin deletes a message
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.execute('DELETE FROM messages WHERE id = ?', [req.params.id])
    res.json({ message: 'Message deleted.' })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// GET /api/messages/unread-count  — Admin gets count of unread messages
router.get('/unread-count', auth, adminOnly, async (req, res) => {
  try {
    const [[{ count }]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM messages WHERE is_read = 0'
    )
    res.json({ count })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

module.exports = router
