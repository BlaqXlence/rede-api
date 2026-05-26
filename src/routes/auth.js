/**
 * auth.js
 * OTP via Africa's Talking SMS (real SMS to Uganda numbers)
 * Falls back to console log if AT not configured
 * Profile update with 7-day name change cooldown
 */
const router  = require('express').Router()
const { query } = require('../db')
const { requireAuth, signToken } = require('../middleware/auth')

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Send SMS via Africa's Talking
async function sendSMS(phone, message) {
  const username = process.env.AT_USERNAME
  const apiKey   = process.env.AT_API_KEY
  const senderId = process.env.AT_SENDER_ID || 'REDE'

  if (!username || !apiKey || username === 'sandbox') {
    // Dev mode — just log it
    console.log(`\n📱 SMS to ${phone}: ${message}\n`)
    return { success: true, dev: true }
  }

  try {
    const AfricasTalking = require('africastalking')
    const at  = AfricasTalking({ username, apiKey })
    const sms = at.SMS
    const res = await sms.send({
      to:      [phone],
      message,
      from:    senderId,
    })
    console.log('SMS sent:', JSON.stringify(res))
    return { success: true }
  } catch (err) {
    console.error('SMS error:', err.message)
    // Don't fail — log the code so dev can still test
    console.log(`📱 FALLBACK OTP for ${phone}: ${message}`)
    return { success: false, error: err.message }
  }
}

// POST /auth/otp/send
router.post('/otp/send', async (req, res) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ message: 'Phone required' })

  try {
    const code      = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await query('DELETE FROM otps WHERE phone = $1', [phone])
    await query(
      'INSERT INTO otps (phone, code, expires_at) VALUES ($1, $2, $3)',
      [phone, code, expiresAt]
    )

    const message = `Your REDE verification code is: ${code}. Valid for 10 minutes. Do not share it.`
    await sendSMS(phone, message)

    res.json({
      message:  'Code sent',
      dev_code: process.env.NODE_ENV !== 'production' ? code : undefined,
    })
  } catch (err) {
    console.error('OTP send error:', err.message)
    res.status(500).json({ message: 'Failed to send code: ' + err.message })
  }
})

// POST /auth/otp/verify
router.post('/otp/verify', async (req, res) => {
  const { phone, code } = req.body
  if (!phone || !code) return res.status(400).json({ message: 'Phone and code required' })

  try {
    const { rows: otpRows } = await query(
      'SELECT * FROM otps WHERE phone = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()',
      [phone, code]
    )
    if (!otpRows[0]) {
      return res.status(400).json({ message: 'Invalid or expired code' })
    }

    await query('UPDATE otps SET used = TRUE WHERE id = $1', [otpRows[0].id])

    let { rows: userRows } = await query('SELECT * FROM users WHERE phone = $1', [phone])
    let isNewUser = false

    if (!userRows[0]) {
      const { rows } = await query(
        'INSERT INTO users (phone, verified) VALUES ($1, TRUE) RETURNING *',
        [phone]
      )
      userRows  = rows
      isNewUser = true
    } else {
      await query('UPDATE users SET verified = TRUE WHERE phone = $1', [phone])
      const { rows } = await query('SELECT * FROM users WHERE phone = $1', [phone])
      userRows = rows
    }

    const token = signToken(userRows[0].id)
    console.log(`✅ Verified: ${phone} (new: ${isNewUser})`)

    res.json({ token, user: formatUser(userRows[0]), isNewUser })
  } catch (err) {
    console.error('OTP verify error:', err.message)
    res.status(500).json({ message: 'Verification failed: ' + err.message })
  }
})

// PUT /auth/profile
router.put('/profile', requireAuth, async (req, res) => {
  const { name, email, avatar_url, push_token } = req.body

  try {
    // 7-day name change cooldown
    if (name && name.trim() !== req.user.name) {
      const { rows: logRows } = await query(
        'SELECT changed_at FROM name_change_log WHERE user_id = $1',
        [req.user.id]
      )
      if (logRows[0]) {
        const daysSince = (Date.now() - new Date(logRows[0].changed_at)) / 86400000
        if (daysSince < 7) {
          const daysLeft = Math.ceil(7 - daysSince)
          return res.status(400).json({
            message: `You can change your name again in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`
          })
        }
      }
      await query(`
        INSERT INTO name_change_log (user_id, changed_at) VALUES ($1, NOW())
        ON CONFLICT (user_id) DO UPDATE SET changed_at = NOW()
      `, [req.user.id])
    }

    const { rows } = await query(`
      UPDATE users SET
        name        = COALESCE($1, name),
        email       = COALESCE($2, email),
        avatar_url  = COALESCE($3, avatar_url),
        push_token  = COALESCE($4, push_token)
      WHERE id = $5 RETURNING *
    `, [name?.trim() || null, email?.trim() || null, avatar_url || null, push_token || null, req.user.id])

    res.json({ user: formatUser(rows[0]) })
  } catch (err) {
    console.error('Profile update error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// GET /auth/profile
router.get('/profile', requireAuth, async (req, res) => {
  res.json({ user: formatUser(req.user) })
})

// GET /auth/organizer/:id — public organizer profile
router.get('/organizer/:id', async (req, res) => {
  try {
    const { rows: userRows } = await query(
      'SELECT id, name, avatar_url, verified, created_at FROM users WHERE id = $1',
      [req.params.id]
    )
    if (!userRows[0]) return res.status(404).json({ message: 'User not found' })

    // Get their events
    const { rows: eventRows } = await query(
      `SELECT e.*, 
        COALESCE(AVG(r.rating), 0) as avg_rating,
        COUNT(DISTINCT r.id) as review_count
       FROM events e
       LEFT JOIN reviews r ON r.event_id = e.id
       WHERE e.organizer_id = $1 AND e.is_active = TRUE
       GROUP BY e.id
       ORDER BY e.start_time DESC`,
      [req.params.id]
    )

    res.json({
      organizer: {
        id:        userRows[0].id,
        name:      userRows[0].name,
        avatar:    userRows[0].avatar_url,
        verified:  userRows[0].verified,
        joinedAt:  userRows[0].created_at,
      },
      events:     eventRows,
      totalEvents: eventRows.length,
      avgRating:  eventRows.length > 0
        ? (eventRows.reduce((s, e) => s + parseFloat(e.avg_rating), 0) / eventRows.length).toFixed(1)
        : null,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

function formatUser(u) {
  return {
    id:        u.id,
    phone:     u.phone,
    name:      u.name,
    email:     u.email,
    avatar:    u.avatar_url,
    verified:  u.verified,
    pushToken: u.push_token,
    createdAt: u.created_at,
  }
}

module.exports = router
