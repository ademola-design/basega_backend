require('dotenv').config()
const express     = require('express')
const cors        = require('cors')
const path        = require('path')
const multer      = require('multer')
const rateLimit   = require('express-rate-limit')

const app = express()

// ──────────────────────────────────────────
// CORS — allow the React frontend to call this API
// ──────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:5173',
  'http://localhost:4173',
]

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true)
    else callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))

// ──────────────────────────────────────────
// Body parsers
// ──────────────────────────────────────────
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ──────────────────────────────────────────
// Raw body for Paystack webhook (must come before express.json)
// ──────────────────────────────────────────
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }))

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

// ──────────────────────────────────────────
// Routes
// ──────────────────────────────────────────
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
  res.status(500).json({ error: err.message || 'Internal server error.' })
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
