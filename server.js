require('dotenv').config()
const express     = require('express')
const cors        = require('cors')
const path        = require('path')
const multer      = require('multer')
const rateLimit   = require('express-rate-limit')

const app = express()

app.disable('x-powered-by')

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000')
  }
  next()
})

// ──────────────────────────────────────────
// CORS — allow the React frontend to call this API
// ──────────────────────────────────────────
const configuredOrigins = process.env.FRONTEND_URLS || process.env.FRONTEND_URL
const allowedOrigins = (configuredOrigins || (process.env.NODE_ENV === 'production'
  ? ''
  : 'http://localhost:5173,http://localhost:4173'))
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error('Set FRONTEND_URL or FRONTEND_URLS to the production frontend origin(s).')
}

if (process.env.NODE_ENV === 'production' && allowedOrigins.some(origin => !origin.startsWith('https://'))) {
  throw new Error('Production FRONTEND_URLS origins must use HTTPS.')
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('replace_with') ||
    (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32)) {
  throw new Error('Set JWT_SECRET to a unique secret of at least 32 characters before starting the backend.')
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true)
    else callback(new Error('Not allowed by CORS'))
  },
}))

// ──────────────────────────────────────────
// Body parsers
// ──────────────────────────────────────────
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '1mb' }))

// ──────────────────────────────────────────
// Static file serving — uploaded images
// ──────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ──────────────────────────────────────────
// Rate Limiting
// ──────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs:    15 * 60 * 1000, // 15 minutes
  max:         10,             // max 10 auth requests per window
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
})

const apiLimiter = rateLimit({
  windowMs:    1 * 60 * 1000, // 1 minute
  max:         120,            // general API limit
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please slow down.' },
})

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1)
}

// ──────────────────────────────────────────
// Routes
// ──────────────────────────────────────────
app.use('/api', apiLimiter)
app.use('/api/auth',        authLimiter, require('./routes/auth'))
app.use('/api/members',     require('./routes/members'))
app.use('/api/events',      require('./routes/events'))
app.use('/api/news',        require('./routes/news'))
app.use('/api/gallery',     require('./routes/gallery'))
app.use('/api/payments',    require('./routes/payments'))
app.use('/api/nominations', require('./routes/nominations'))
app.use('/api/messages',    require('./routes/messages'))

// ──────────────────────────────────────────
// Health check
// ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ──────────────────────────────────────────
// 404 fallback
// ──────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` })
})

// ──────────────────────────────────────────
// Global error handler
// ──────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'This origin is not allowed.' })
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' })
  }
  // Upload problems are the caller's fault, not ours — a 5MB photo or a PDF
  // should read as "file too large" / "wrong type", not "internal server error".
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That image is too large. Please use a file under 3MB.'
      : `Upload failed: ${err.message}`
    return res.status(400).json({ error: message })
  }
  if (/only .*(image|jpeg|png|webp).* allowed/i.test(err.message || '')) {
    return res.status(400).json({ error: err.message })
  }

  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error.' })
})

// ──────────────────────────────────────────
// Start
// ──────────────────────────────────────────
const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 BASEGA API running on port ${PORT}`)
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`)
})

module.exports = app
