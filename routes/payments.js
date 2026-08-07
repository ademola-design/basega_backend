const router    = require('express').Router()
const axios     = require('axios')
const pool      = require('../config/db')
const auth      = require('../middleware/auth')
const adminOnly = require('../middleware/adminOnly')

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

// ──────────────────────────────────────────
// POST /api/payments/initiate
// Logged-in member initiates a payment
// ──────────────────────────────────────────
router.post('/initiate', auth, async (req, res) => {
  const { type, amount } = req.body

  const validTypes = ['annual', 'building', 'scholarship', 'event']
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: 'Invalid payment type.' })
  }
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount.' })
  }

  try {
    // Get member email
    const [rows] = await pool.execute(
      'SELECT email, first_name, last_name FROM members WHERE id = ?',
      [req.user.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Member not found.' })

    const member = rows[0]
    const amountKobo = Math.round(parseFloat(amount) * 100) // Paystack uses kobo

    // Initialize transaction via Paystack API
    const paystackRes = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email:    member.email,
        amount:   amountKobo,
        currency: 'NGN',
        metadata: {
          memberId:  req.user.id,
          type,
          firstName: member.first_name,
          lastName:  member.last_name,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json',
        },
      }
    )

    const { authorization_url, reference } = paystackRes.data.data

    // Save pending payment record
    const year = new Date().getFullYear()
    await pool.execute(
      'INSERT INTO payments (member_id, type, amount, paystack_ref, status, payment_year) VALUES (?,?,?,?,?,?)',
      [req.user.id, type, amount, reference, 'pending', year]
    )

    res.json({
      message:         'Payment initialised.',
      authorizationUrl: authorization_url,
      reference,
    })
  } catch (err) {
    console.error('POST /payments/initiate error:', err.response?.data || err.message)
    res.status(500).json({ error: 'Could not initiate payment. Please try again.' })
  }
})

// ──────────────────────────────────────────
// POST /api/payments/verify/:reference
// Called after user returns from Paystack checkout
// ──────────────────────────────────────────
router.post('/verify/:reference', auth, async (req, res) => {
  const { reference } = req.params

  try {
    // Verify with Paystack
    const paystackRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    )

    const { status: txStatus, metadata } = paystackRes.data.data

    if (txStatus === 'success') {
      // Update payment record
      await pool.execute(
        "UPDATE payments SET status = 'confirmed' WHERE paystack_ref = ?",
        [reference]
      )

      // If it's an annual dues payment, upgrade member to 'financial'
      if (metadata?.type === 'annual') {
        await pool.execute(
          "UPDATE members SET status = 'financial' WHERE id = ?",
          [metadata.memberId]
        )
        await pool.execute(
          'INSERT INTO activity_log (member_id, action) VALUES (?, ?)',
          [metadata.memberId, `Annual dues paid. Member upgraded to Financial.`]
        )
      }

      res.json({ success: true, message: 'Payment confirmed.' })
    } else {
      await pool.execute(
        "UPDATE payments SET status = 'failed' WHERE paystack_ref = ?",
        [reference]
      )
      res.json({ success: false, message: 'Payment was not successful.' })
    }
  } catch (err) {
    console.error('POST /payments/verify error:', err.response?.data || err.message)
    res.status(500).json({ error: 'Could not verify payment.' })
  }
})

// ──────────────────────────────────────────
// POST /api/payments/webhook
// Paystack server-to-server webhook (more reliable)
// ──────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  // Validate Paystack signature
  const crypto = require('crypto')
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex')

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(400).send('Invalid signature.')
  }

  const event = req.body

  if (event.event === 'charge.success') {
    const { reference, metadata } = event.data
    try {
      await pool.execute(
        "UPDATE payments SET status = 'confirmed' WHERE paystack_ref = ?",
        [reference]
      )

      if (metadata?.type === 'annual' && metadata?.memberId) {
        await pool.execute(
          "UPDATE members SET status = 'financial' WHERE id = ?",
          [metadata.memberId]
        )
        await pool.execute(
          'INSERT INTO activity_log (member_id, action) VALUES (?, ?)',
          [metadata.memberId, 'Annual dues payment confirmed via webhook.']
        )
      }
    } catch (err) {
      console.error('Webhook processing error:', err)
    }
  }

  res.sendStatus(200) // Always respond 200 to Paystack
})

// ──────────────────────────────────────────
// GET /api/payments/history  — Member's own payment history
// ──────────────────────────────────────────
router.get('/history', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, type, amount, paystack_ref, status, payment_year, payment_date FROM payments WHERE member_id = ? ORDER BY payment_date DESC',
      [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// GET /api/payments/all  — Admin: all payments
// ──────────────────────────────────────────
router.get('/all', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.type, p.amount, p.status, p.payment_year, p.payment_date,
              m.first_name, m.last_name, m.email
       FROM payments p
       JOIN members m ON p.member_id = m.id
       ORDER BY p.payment_date DESC`
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

// ──────────────────────────────────────────
// PUT /api/payments/:id/confirm  — Admin manually confirms a payment
// ──────────────────────────────────────────
router.put('/:id/confirm', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT member_id, type FROM payments WHERE id = ?', [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Payment not found.' })

    await pool.execute(
      "UPDATE payments SET status = 'confirmed' WHERE id = ?", [req.params.id]
    )

    if (rows[0].type === 'annual') {
      await pool.execute(
        "UPDATE members SET status = 'financial' WHERE id = ?", [rows[0].member_id]
      )
    }

    res.json({ message: 'Payment confirmed manually.' })
  } catch (err) {
    res.status(500).json({ error: 'Server error.' })
  }
})

module.exports = router
