const router    = require('express').Router()
const pool      = require('../config/db')
const auth      = require('../middleware/auth')
const adminOnly = require('../middleware/adminOnly')
const rateLimit = require('express-rate-limit')
const { body, validationResult } = require('express-validator')

// Fix #6: Dedicated rate limiter for the public contact form.
// Allows 5 submissions per 10 minutes per IP to deter bot spam.
const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many messages sent. Please try again in 10 minutes.' },
})

// POST /api/messages  — Contact form submission (public)
router.post('/', contactLimiter, [
  body('senderName').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('subject').optional().trim().isLength({ max: 250 }).withMessage('Subject is too long'),
  // Fix #6b: cap body length so bots cannot fill the DB with huge strings
  body('body').trim().notEmpty().withMessage('Message body is required')
              .isLength({ max: 5000 }).withMessage('Message must be 5000 characters or fewer'),
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

// Fix #2: GET /api/messages/unread-count MUST be declared BEFORE GET /:id/read.
// Express matches routes in declaration order; placing this after /:id would
// cause Express to treat "unread-count" as an :id param, silently breaking it.
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

// GET /api/messages  — Admin: all messages
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

module.exports = router
