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

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

function articleMediaFromBody(body) {
  const videos = Array.isArray(body.videos)
    ? body.videos
    : [body.videoUrl1, body.videoUrl2].filter(Boolean)
  return {
    images: Array.isArray(body.images) ? body.images : [],
    videos,
  }
}

async function saveMedia(connection, newsId, mediaType, urls) {
  await connection.execute(
    'DELETE FROM news_media WHERE news_id = ? AND media_type = ?',
    [newsId, mediaType]
  )
  if (!urls.length) return

  const placeholders = urls.map(() => '(?, ?, ?, ?)').join(', ')
  const values = urls.flatMap((url, index) => [newsId, mediaType, url, index])
  await connection.execute(
    `INSERT INTO news_media (news_id, media_type, url, sort_order) VALUES ${placeholders}`,
    values
  )
}

async function attachMedia(rows) {
  if (!rows.length) return rows
  const ids = rows.map(row => row.id)
  const placeholders = ids.map(() => '?').join(', ')
  const [media] = await pool.execute(
    `SELECT news_id, media_type, url FROM news_media
     WHERE news_id IN (${placeholders})
     ORDER BY sort_order, id`,
    ids
  )
  const grouped = new Map()
  for (const item of media) {
    if (!grouped.has(item.news_id)) grouped.set(item.news_id, { images: [], videos: [] })
    grouped.get(item.news_id)[item.media_type === 'image' ? 'images' : 'videos'].push(item.url)
  }
  return rows.map(row => ({
    ...row,
    images: grouped.get(row.id)?.images || [],
    videos: grouped.get(row.id)?.videos?.length
      ? grouped.get(row.id).videos
      : [row.video_url_1, row.video_url_2].filter(Boolean),
  }))
}

const mediaFields = [
  body('images').optional().isArray({ max: 20 })
    .withMessage('Images must be a list of no more than 20 URLs'),
  body('images.*').isString().withMessage('Each image URL must be text').bail()
    .isLength({ max: 1000 }).withMessage('Image URLs must not exceed 1000 characters').bail()
    .custom(isSafeImageUrl).withMessage('Each image must be an HTTPS URL or an /uploads/ path'),
  body('videos').optional().isArray({ max: 20 })
    .withMessage('Videos must be a list of no more than 20 URLs'),
  body('videos.*').isString().withMessage('Each video URL must be text').bail()
    .isLength({ max: 1000 }).withMessage('Video URLs must not exceed 1000 characters').bail()
    .custom(isHttpsUrl).withMessage('Each video must be a valid HTTPS URL'),
]

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
  ...mediaFields,
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
  ...mediaFields,
]

// GET /api/news  — Public list of published articles
router.get('/', async (req, res) => {
  try {
    const { category } = req.query
    let sql = `SELECT n.id, n.title, n.excerpt, n.category, n.image_url,
                      n.video_url_1, n.video_url_2,
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
    res.json(await attachMedia(rows))
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
    const [article] = await attachMedia(rows)
    res.json(article)
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// GET /api/news/admin/all  — Admin: all articles incl drafts
router.get('/admin/all', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT n.id, n.title, n.category, n.video_url_1, n.video_url_2,
              n.status, n.created_at,
              m.first_name, m.last_name
       FROM news n
       LEFT JOIN members m ON n.author_id = m.id
       ORDER BY n.created_at DESC`
    )
    res.json(await attachMedia(rows))
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// POST /api/news  — Admin creates article
router.post('/', auth, adminOnly, newsFields, async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { title, excerpt, body: articleBody, category, imageUrl, status } = req.body
  const { images, videos } = articleMediaFromBody(req.body)
  const [videoUrl1, videoUrl2] = videos
  try {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [result] = await connection.execute(
      'INSERT INTO news (title, excerpt, body, category, image_url, video_url_1, video_url_2, author_id, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [title, excerpt || null, articleBody, category || 'General', imageUrl || null, videoUrl1 || null, videoUrl2 || null, req.user.id, status || 'published']
      )
      await saveMedia(connection, result.insertId, 'image', images)
      await saveMedia(connection, result.insertId, 'video', videos)

      await connection.execute(
        'INSERT INTO activity_log (member_id, action) VALUES (?, ?)',
        [req.user.id, `Article "${title}" was ${status || 'published'}.`]
      )
      await connection.commit()
      res.status(201).json({ message: 'Article created.', id: result.insertId })
    } catch (err) {
      await connection.rollback()
      throw err
    } finally {
      connection.release()
    }

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
  const hasImages = Object.hasOwn(req.body, 'images')
  const hasVideos = Object.hasOwn(req.body, 'videos')
  const hasLegacyVideoFields = Object.hasOwn(req.body, 'videoUrl1') || Object.hasOwn(req.body, 'videoUrl2')
  const values = Object.entries(fields)
    .filter(([key]) => Object.hasOwn(req.body, key))
    .map(([key, column]) => ({
      column,
      value: ['excerpt', 'imageUrl', 'videoUrl1', 'videoUrl2'].includes(key) && req.body[key] === ''
        ? null
        : key === 'body' ? req.body.body : req.body[key],
    }))

  if (!values.length && !hasImages && !hasVideos) {
    return res.status(400).json({ error: 'Provide at least one article field to update.' })
  }

  try {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [currentRows] = await connection.execute(
        'SELECT video_url_1, video_url_2 FROM news WHERE id = ? FOR UPDATE',
        [req.params.id]
      )
      if (!currentRows.length) {
        await connection.rollback()
        return res.status(404).json({ error: 'Article not found.' })
      }

      const updates = hasVideos
        ? [
            ...values.filter(({ column }) => !['video_url_1', 'video_url_2'].includes(column)),
            { column: 'video_url_1', value: req.body.videos[0] || null },
            { column: 'video_url_2', value: req.body.videos[1] || null },
          ]
        : values
      if (updates.length) {
        const assignments = updates.map(({ column }) => `${column}=?`).join(', ')
        await connection.execute(`UPDATE news SET ${assignments} WHERE id=?`, [
          ...updates.map(({ value }) => value),
          req.params.id,
        ])
      }
      if (hasImages) {
        await saveMedia(connection, req.params.id, 'image', req.body.images)
      }
      if (hasVideos) {
        await saveMedia(connection, req.params.id, 'video', req.body.videos)
      } else if (hasLegacyVideoFields) {
        const current = currentRows[0]
        const [storedVideos] = await connection.execute(
          `SELECT url FROM news_media
           WHERE news_id = ? AND media_type = 'video'
           ORDER BY sort_order, id`,
          [req.params.id]
        )
        const previousVideos = storedVideos.length
          ? storedVideos.map(video => video.url)
          : [current.video_url_1, current.video_url_2].filter(Boolean)
        const currentVideoList = [
          req.body.videoUrl1 ?? current.video_url_1,
          req.body.videoUrl2 ?? current.video_url_2,
        ].filter(Boolean)
        await saveMedia(connection, req.params.id, 'video', [
          ...currentVideoList,
          ...previousVideos.slice(2),
        ])
      }
      await connection.commit()
    } catch (err) {
      await connection.rollback()
      throw err
    } finally {
      connection.release()
    }
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
