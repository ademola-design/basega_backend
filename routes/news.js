const router    = require('express').Router()
const pool      = require('../config/db')
const auth      = require('../middleware/auth')
const adminOnly = require('../middleware/adminOnly')
const { body, validationResult } = require('express-validator')

function isSafeImageUrl(value) {
  if (typeof value !== 'string') return false
  if (value.startsWith('/uploads/')) {
    return /^\/uploads\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes('..')
  }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

const newsFields = [
  body('title').isString().withMessage('Title must be text').bail()
    .trim().notEmpty().withMessage('Title is required').bail()
    .isLength({ max: 250 }).withMessage('Title must not exceed 250 characters'),
  body('excerpt').optional({ values: 'falsy' }).isString().withMessage('Excerpt must be text').bail().trim()
    .isLength({ max: 5000 }).withMessage('Excerpt must not exceed 5000 characters'),
  body('body').isString().withMessage('Article body must be text').bail()
    .trim().notEmpty().withMessage('Article body is required').bail()
    .isLength({ max: 100000 }).withMessage('Article body must not exceed 100000 characters'),
  body('category').optional({ values: 'falsy' }).isString().withMessage('Category must be text').bail().trim()
    .isLength({ max: 100 }).withMessage('Category must not exceed 100 characters'),
  body('imageUrl').optional({ values: 'falsy' }).isString().withMessage('Image URL must be text').bail()
    .isLength({ max: 255 })
    .withMessage('Image URL must not exceed 255 characters').bail()
    .custom(isSafeImageUrl).withMessage('Image URL must be an HTTPS URL or an /uploads/ path'),
  body('videoUrl1').optional({ values: 'falsy' }).isString().withMessage('Video 1 URL must be text').bail()
    .isLength({ max: 1000 }).withMessage('Video 1 URL must not exceed 1000 characters').bail()
    .isURL({ protocols: ['https'], require_protocol: true }).withMessage('Video 1 must be a valid HTTPS URL'),
  body('videoUrl2').optional({ values: 'falsy' }).isString().withMessage('Video 2 URL must be text').bail()
    .isLength({ max: 1000 }).withMessage('Video 2 URL must not exceed 1000 characters').bail()
    .isURL({ protocols: ['https'], require_protocol: true }).withMessage('Video 2 must be a valid HTTPS URL'),
  body('status').optional().isString().withMessage('Status must be text').bail().isIn(['draft', 'published'])
    .withMessage('Status must be draft or published'),
]

const newsUpdateFields = [
  body('title').optional().isString().withMessage('Title must be text').bail()
    .trim().notEmpty().withMessage('Title cannot be empty').bail()
    .isLength({ max: 250 }).withMessage('Title must not exceed 250 characters'),
  body('excerpt').optional().isString().withMessage('Excerpt must be text').bail().trim()
    .isLength({ max: 5000 })
    .withMessage('Excerpt must not exceed 5000 characters'),
  body('body').optional().isString().withMessage('Article body must be text').bail()
    .trim().notEmpty().withMessage('Article body cannot be empty').bail()
    .isLength({ max: 100000 }).withMessage('Article body must not exceed 100000 characters'),
  body('category').optional().isString().withMessage('Category must be text').bail()
    .trim().notEmpty().withMessage('Category cannot be empty').bail()
    .isLength({ max: 100 }).withMessage('Category must not exceed 100 characters'),
  body('imageUrl').optional({ values: 'falsy' }).isString().withMessage('Image URL must be text').bail()
    .isLength({ max: 255 })
    .withMessage('Image URL must not exceed 255 characters').bail()
    .custom(isSafeImageUrl).withMessage('Image URL must be an HTTPS URL or an /uploads/ path'),
  body('videoUrl1').optional({ values: 'falsy' }).isString().withMessage('Video 1 URL must be text').bail()
    .isLength({ max: 1000 }).withMessage('Video 1 URL must not exceed 1000 characters').bail()
    .isURL({ protocols: ['https'], require_protocol: true }).withMessage('Video 1 must be a valid HTTPS URL'),
  body('videoUrl2').optional({ values: 'falsy' }).isString().withMessage('Video 2 URL must be text').bail()
    .isLength({ max: 1000 }).withMessage('Video 2 URL must not exceed 1000 characters').bail()
    .isURL({ protocols: ['https'], require_protocol: true }).withMessage('Video 2 must be a valid HTTPS URL'),
  body('status').optional().isString().withMessage('Status must be text').bail().isIn(['draft', 'published'])
    .withMessage('Status must be draft or published'),
]

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
router.post('/', auth, adminOnly, newsFields, async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { title, excerpt, body: articleBody, category, imageUrl, videoUrl1, videoUrl2, status } = req.body
  try {
    const [result] = await pool.execute(
      'INSERT INTO news (title, excerpt, body, category, image_url, video_url_1, video_url_2, author_id, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [title, excerpt || null, articleBody, category || 'General', imageUrl || null, videoUrl1 || null, videoUrl2 || null, req.user.id, status || 'published']
    )

    await pool.execute(
      'INSERT INTO activity_log (member_id, action) VALUES (?, ?)',
      [req.user.id, `Article "${title}" was ${status || 'published'}.`]
    )

    res.status(201).json({ message: 'Article created.', id: result.insertId })
  } catch (err) {
    console.error('POST /news error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// PUT /api/news/:id  — Admin updates article
router.put('/:id', auth, adminOnly, newsUpdateFields, async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const fields = {
    title: 'title',
    excerpt: 'excerpt',
    body: 'body',
    category: 'category',
    imageUrl: 'image_url',
    videoUrl1: 'video_url_1',
    videoUrl2: 'video_url_2',
    status: 'status',
  }
  const values = Object.entries(fields)
    .filter(([key]) => Object.hasOwn(req.body, key))
    .map(([key, column]) => ({
      column,
      value: ['excerpt', 'imageUrl', 'videoUrl1', 'videoUrl2'].includes(key) && req.body[key] === ''
        ? null
        : key === 'body' ? req.body.body : req.body[key],
    }))

  if (!values.length) {
    return res.status(400).json({ error: 'Provide at least one article field to update.' })
  }

  try {
    const assignments = values.map(({ column }) => `${column}=?`).join(', ')
    await pool.execute(`UPDATE news SET ${assignments} WHERE id=?`, [
      ...values.map(({ value }) => value),
      req.params.id,
    ])
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
