const router    = require('express').Router()
const pool      = require('../config/db')
const auth      = require('../middleware/auth')
const adminOnly = require('../middleware/adminOnly')
const { body, validationResult } = require('express-validator')

// GET /api/news  — Public list of published articles
router.get('/', async (req, res) => {
  try {
    const { category } = req.query
    let sql = `SELECT n.id, n.title, n.excerpt, n.category, n.image_url,
                      n.status, n.created_at,
                      m.first_name, m.last_name
               FROM news n
               LEFT JOIN members m ON n.author_id = m.id
               WHERE n.status = 'published'`
    const params = []
    if (category) {
      sql += ' AND n.category = ?'
      params.push(category)
    }
    sql += ' ORDER BY n.created_at DESC'

    const [rows] = await pool.execute(sql, params)
    res.json(rows)
  } catch (err) {
    console.error('GET /news error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// GET /api/news/:id  — Single article (public)
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT n.*, m.first_name, m.last_name
       FROM news n
       LEFT JOIN members m ON n.author_id = m.id
       WHERE n.id = ? AND n.status = 'published'`,
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Article not found.' })
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// GET /api/news/admin/all  — Admin: all articles incl drafts
router.get('/admin/all', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT n.id, n.title, n.category, n.status, n.created_at,
              m.first_name, m.last_name
       FROM news n
       LEFT JOIN members m ON n.author_id = m.id
       ORDER BY n.created_at DESC`
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// POST /api/news  — Admin creates article
router.post('/', auth, adminOnly, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('body').notEmpty().withMessage('Article body is required'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { title, excerpt, body: articleBody, category, imageUrl, status } = req.body
  try {
    const [result] = await pool.execute(
      'INSERT INTO news (title, excerpt, body, category, image_url, author_id, status) VALUES (?,?,?,?,?,?,?)',
      [title, excerpt || null, articleBody, category || 'General', imageUrl || null, req.user.id, status || 'published']
    )

    await pool.execute(
      'INSERT INTO activity_log (member_id, action) VALUES (?, ?)',
      [req.user.id, `Article "${title}" was published.`]
    )

    res.status(201).json({ message: 'Article created.', id: result.insertId })
  } catch (err) {
    console.error('POST /news error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// PUT /api/news/:id  — Admin updates article
router.put('/:id', auth, adminOnly, async (req, res) => {
  const { title, excerpt, body: articleBody, category, imageUrl, status } = req.body
  try {
    await pool.execute(
      'UPDATE news SET title=?, excerpt=?, body=?, category=?, image_url=?, status=? WHERE id=?',
      [title, excerpt, articleBody, category, imageUrl, status, req.params.id]
    )
    res.json({ message: 'Article updated.' })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// DELETE /api/news/:id  — Admin deletes article
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.execute('DELETE FROM news WHERE id = ?', [req.params.id])
    res.json({ message: 'Article deleted.' })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

module.exports = router
