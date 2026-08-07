const router   = require('express').Router()
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const multer   = require('multer')
const path     = require('path')
const fs       = require('fs')
const { body, validationResult } = require('express-validator')
const pool     = require('../config/db')
const auth     = require('../middleware/auth')

// ──────────────────────────────────────────
// Optional profile photo on the registration form.
// Mirrors POST /api/members/me/photo, but there is no account yet — so the
// filename is random rather than keyed to a member id.
// ──────────────────────────────────────────
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'profiles')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const unique = `signup-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`
    cb(null, unique)
  },
})

const uploadPhoto = multer({
  storage: photoStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error('Only JPEG, PNG, or WebP images are allowed.'), false)
  },
  limits: { fileSize: 3 * 1024 * 1024 },   // 3MB, same as profile updates
})

/** Registration can fail after multer has already written the file — don't leak it. */
function discardUpload(file) {
  if (!file) return
  fs.unlink(file.path, err => {
    if (err && err.code !== 'ENOENT') console.warn('Could not remove orphaned upload:', err.message)
  })
}

// ──────────────────────────────────────────
// Helper: log activity
// ──────────────────────────────────────────
async function logActivity(memberId, action) {
  try {
    await pool.execute(
      'INSERT INTO activity_log (member_id, action) VALUES (?, ?)',
      [memberId, action]
    )
  } catch (_) { /* non-critical */ }
}

// ──────────────────────────────────────────
// POST /api/auth/register
// ──────────────────────────────────────────
router.post('/register', uploadPhoto.single('photo'), [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('state').trim().notEmpty().withMessage('State is required'),
  body('classSet').notEmpty().withMessage('Class set is required'),
  body('profession').trim().notEmpty().withMessage('Profession is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    discardUpload(req.file)
    return res.status(400).json({ errors: errors.array() })
  }

  const {
    title, firstName, lastName, email, password, phone,
    gender, dob, city, state, classSet, studentId, house,
    classTeacher, waecNum, referee, profession, company,
    industry, linkedin, bio, referralSource,
  } = req.body

  try {
    // Check for duplicate email
    const [existing] = await pool.execute(
      'SELECT id FROM members WHERE email = ?', [email]
    )
    if (existing.length > 0) {
      discardUpload(req.file)
      return res.status(409).json({ error: 'An account with this email already exists.' })
    }

    // Saved on the member row, so the same image serves the profile page, the
    // dashboard, the navbar, and the Alumni of the Month feature.
    const photoUrl = req.file ? `/uploads/profiles/${req.file.filename}` : null

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 12)

    // Generate unique reference number
    const refNumber = 'BSGA-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000)

    // Insert new member
    const [result] = await pool.execute(
      `INSERT INTO members
        (title, first_name, last_name, email, password_hash, phone,
         gender, dob, city, state, class_set, student_id, house,
         class_teacher, waec_num, referee, profession, company,
         industry, linkedin, bio, referral_src, ref_number, photo_url, status, role)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','member')`,
      [
        title || null, firstName, lastName, email, passwordHash, phone,
        gender || null, dob || null, city, state, classSet || null,
        studentId || null, house || null, classTeacher || null,
        waecNum || null, referee || null, profession,
        company || null, industry || null, linkedin || null,
        bio || null, referralSource || null, refNumber, photoUrl,
      ]
    )

    await logActivity(result.insertId, `${firstName} ${lastName} submitted a membership request.`)

    res.status(201).json({
      message: 'Registration submitted successfully. Awaiting admin approval.',
      refNumber,
      photoUrl,
    })
  } catch (err) {
    discardUpload(req.file)
    console.error('Register error:', err)
    res.status(500).json({ error: 'Server error. Please try again.' })
  }
})

// ──────────────────────────────────────────
// POST /api/auth/login
// ──────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { email, password } = req.body

  try {
    const [rows] = await pool.execute(
      'SELECT id, first_name, last_name, email, password_hash, role, status, photo_url FROM members WHERE email = ?',
      [email]
    )

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    const member = rows[0]

    // Verify password
    const valid = await bcrypt.compare(password, member.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    // Allow pending members to log in but show their status
    // (they can see dashboard but admin must approve for full access)

    // Sign JWT
    const token = jwt.sign(
      {
        id:     member.id,
        email:  member.email,
        role:   member.role,
        status: member.status,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )

    res.json({
      token,
      user: {
        id:        member.id,
        firstName: member.first_name,
        lastName:  member.last_name,
        email:     member.email,
        role:      member.role,
        status:    member.status,
        photoUrl:  member.photo_url,
      },
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Server error. Please try again.' })
  }
})

// ──────────────────────────────────────────
// GET /api/auth/me  (requires token)
// ──────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, title, first_name, last_name, email, phone, gender, dob,
              city, state, class_set, profession, company, industry, linkedin,
              bio, photo_url, status, role, ref_number, created_at
       FROM members WHERE id = ?`,
      [req.user.id]
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Member not found.' })
    }

    // Get payment status for current year
    const year = new Date().getFullYear()
    const [payments] = await pool.execute(
      'SELECT id, type, amount, status, payment_date FROM payments WHERE member_id = ? AND payment_year = ? AND status = ?',
      [req.user.id, year, 'confirmed']
    )

    const member = rows[0]
    res.json({
      ...member,
      duesPaidThisYear: payments.length > 0,
      recentPayments:   payments,
    })
  } catch (err) {
    console.error('/me error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// PUT /api/auth/change-password (requires token)
// ──────────────────────────────────────────
router.put('/change-password', auth, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { currentPassword, newPassword } = req.body
  try {
    const [rows] = await pool.execute(
      'SELECT password_hash FROM members WHERE id = ?', [req.user.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Member not found.' })

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash)
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' })

    const newHash = await bcrypt.hash(newPassword, 12)
    await pool.execute('UPDATE members SET password_hash = ? WHERE id = ?', [newHash, req.user.id])

    res.json({ message: 'Password updated successfully.' })
  } catch (err) {
    console.error('change-password error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// POST /api/auth/forgot-password
// Generates a secure reset token and logs it
// (Plug in nodemailer here when email is configured)
// ──────────────────────────────────────────
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email is required'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { email } = req.body
  try {
    const [rows] = await pool.execute(
      'SELECT id, first_name FROM members WHERE email = ?', [email]
    )

    // Always return success to prevent email enumeration
    if (rows.length === 0) {
      return res.json({ message: 'If that email exists, a reset link has been sent.' })
    }

    const member = rows[0]
    const crypto = require('crypto')
    const token = crypto.randomBytes(32).toString('hex')

    // Expire in 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ')

    // Invalidate any existing tokens for this member
    await pool.execute(
      'UPDATE password_reset_tokens SET used = 1 WHERE member_id = ? AND used = 0',
      [member.id]
    )

    // Save new token
    await pool.execute(
      'INSERT INTO password_reset_tokens (member_id, token, expires_at) VALUES (?,?,?)',
      [member.id, token, expiresAt]
    )

    // --- Replace this with nodemailer when email is configured ---
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`
    console.log(`\n📧 PASSWORD RESET for ${member.first_name} (${email})\n   Link: ${resetLink}\n`)
    // ---

    res.json({ message: 'If that email exists, a reset link has been sent.' })
  } catch (err) {
    console.error('forgot-password error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// POST /api/auth/reset-password
// Validates token and sets new password
// ──────────────────────────────────────────
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { token, password } = req.body
  try {
    const [rows] = await pool.execute(
      `SELECT prt.id, prt.member_id, prt.expires_at, prt.used
       FROM password_reset_tokens prt
       WHERE prt.token = ? AND prt.used = 0`,
      [token]
    )

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or already used reset token.' })
    }

    const record = rows[0]
    if (new Date() > new Date(record.expires_at)) {
      return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' })
    }

    const newHash = await bcrypt.hash(password, 12)

    await pool.execute('UPDATE members SET password_hash = ? WHERE id = ?', [newHash, record.member_id])
    await pool.execute('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [record.id])

    res.json({ message: 'Password reset successfully. You can now log in.' })
  } catch (err) {
    console.error('reset-password error:', err)
    res.status(500).json({ error: 'Server error.' })
  }
})

module.exports = router
