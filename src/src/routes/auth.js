/**
 * auth.js — Authentication routes
 * OTP send/verify with proper error logging.
 * Profile update with 7-day name change limit.
 */
const router = require('express').Router()
const { query } = require('../db')
const { requireAuth, signToken } = require('../middleware/auth')

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString()
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

    // Log OTP to Railway console — visible in deployment logs
    console.log(`\n📱 OTP ==============================`)
    console.log(`   Phone: ${phone}`)
    console.log(`   Code:  ${code}`)
    console.log(`   Exp:   ${expiresAt.toISOString()}`)
    console.log(`========================================\n`)

    res.json({ message: 'Code sent', dev_code: code })
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
      return res.status(400).json({ message: 'Invalid or expired code. Check Railway logs for your code.' })
    }

    await query('UPDATE otps SET used = TRUE WHERE id = $1', [otpRows[0].id])

    let { rows: userRows } = await query('SELECT * FROM users WHERE phone = $1', [phone])
    let isNewUser = false

    if (!userRows[0]) {
      const { rows } = await query(
        'INSERT INTO users (phone, verified) VALUES ($1, TRUE) RETURNING *',
        [phone]
      )
      userRows = rows
      isNewUser = true
    } else {
      await query('UPDATE users SET verified = TRUE WHERE phone = $1', [phone])
      // Re-fetch to get latest data
      const { rows } = await query('SELECT * FROM users WHERE phone = $1', [phone])
      userRows = rows
    }

    const token = signToken(userRows[0].id)
    console.log(`✅ User verified: ${phone} (new: ${isNewUser})`)

    res.json({ token, user: formatUser(userRows[0]), isNewUser })
  } catch (err) {
    console.error('OTP verify error:', err.message)
    res.status(500).json({ message: 'Verification failed: ' + err.message })
  }
})

// PUT /auth/profile — update name, email, avatar
// Name can only be changed once every 7 days
router.put('/profile', requireAuth, async (req, res) => {
  const { name, email, avatar_url } = req.body

  try {
    // Check name change cooldown
    if (name && name.trim() !== req.user.name) {
      const { rows: logRows } = await query(
        'SELECT changed_at FROM name_change_log WHERE user_id = $1',
        [req.user.id]
      )
      if (logRows[0]) {
        const daysSince = (Date.now() - new Date(logRows[0].changed_at).getTime()) / 86400000
        if (daysSince < 7) {
          const daysLeft = Math.ceil(7 - daysSince)
          return res.status(400).json({
            message: `You can change your name again in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`
          })
        }
      }
      // Log the name change
      await query(`
        INSERT INTO name_change_log (user_id, changed_at)
        VALUES ($1, NOW())
        ON CONFLICT (user_id) DO UPDATE SET changed_at = NOW()
      `, [req.user.id])
    }

    const { rows } = await query(`
      UPDATE users SET
        name      = COALESCE($1, name),
        email     = COALESCE($2, email),
        avatar_url = COALESCE($3, avatar_url)
      WHERE id = $4 RETURNING *
    `, [name?.trim() || null, email?.trim() || null, avatar_url || null, req.user.id])

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

function formatUser(u) {
  return {
    id: u.id, phone: u.phone, name: u.name,
    email: u.email, avatar: u.avatar_url,
    verified: u.verified, createdAt: u.created_at,
  }
}

module.exports = router
