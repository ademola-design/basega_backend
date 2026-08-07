const router    = require('express').Router()
const multer    = require('multer')
const path      = require('path')
const fs        = require('fs')
const pool      = require('../config/db')
const auth      = require('../middleware/auth')
const adminOnly = require('../middleware/adminOnly')

// Multer config — store images in /uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads'))
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + path.extname(file.originalname))
  },
})

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (allowed.includes(file.mimetype)) cb(null, true)
  else cb(new Error('Only image files are allowed.'), false)
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } })

// GET /api/gallery  — Public
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT g.id, g.image_url, g.caption, g.created_at,
              m.first_name, m.last_name
       FROM gallery g
       LEFT JOIN members m ON g.uploaded_by = m.id
       ORDER BY g.created_at DESC`
    )
    res.json(rows)
  } catch (err) {
    console.error('GET /gallery error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// POST /api/gallery  — Admin uploads image
router.post('/', auth, adminOnly, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided.' })

  const imageUrl = `/uploads/${req.file.filename}`
  const { caption } = req.body

  try {
    const [result] = await pool.execute(
      'INSERT INTO gallery (image_url, caption, uploaded_by) VALUES (?,?,?)',
      [imageUrl, caption || null, req.user.id]
    )
    res.status(201).json({ message: 'Image uploaded.', id: result.insertId, imageUrl })
  } catch (err) {
    console.error('POST /gallery error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// DELETE /api/gallery/:id  — Admin deletes image
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    // Get the stored image path before deleting
    const [rows] = await pool.execute('SELECT image_url FROM gallery WHERE id = ?', [req.params.id])
    
    await pool.execute('DELETE FROM gallery WHERE id = ?', [req.params.id])

    // Remove physical file from disk (non-critical — don't fail if missing)
    if (rows.length > 0 && rows[0].image_url) {
      const filePath = path.join(__dirname, '..', rows[0].image_url)
      fs.unlink(filePath, err => {
        if (err && err.code !== 'ENOENT') console.warn('Could not delete gallery file:', err.message)
      })
    }

    res.json({ message: 'Image deleted.' })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

module.exports = router
