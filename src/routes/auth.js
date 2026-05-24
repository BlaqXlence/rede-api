const router = require('express').Router()
const { query } = require('../db')
const { requireAuth, signToken } = require('../middleware/auth')

// Generate a random 6-digit OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Send OTP to phone number
// In production: swap the console.log for Africa's Talking SMS
async function sendSms(phone, code) {
  if (process.env.NODE_ENV === 'production' && process.env.AT_API_KEY) {
    const AfricasTalking = require('africastalking')
    const at = AfricasTalking({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME })
    await at.SMS.send({ to: [phone], message: `Your REDE code is: ${code}. Valid for 10 minutes.`, from: process.env.AT_SENDER_ID })
  } else {
    // Dev mode — log the code to terminal
    console.log(`\n📱 OTP for ${phone}: ${code}\n`)
  }
}

// POST /auth/otp/send
router.post('/otp/send', async (req, res) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ message: 'Phone number required' })

  try {
    const code = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Store OTP — delete old ones for this phone first
    await query('DELETE FROM otps WHERE phone = $1', [phone])
    await query(
      'INSERT INTO otps (phone, code, expires_at) VALUES ($1, $2, $3)',
      [phone, code, expiresAt]
    )

    await sendSms(phone, code)
    res.json({ message: 'Code sent', dev_code: process.env.NODE_ENV !== 'production' ? code : undefined })
  } catch (err) {
    res.status(500).json({ message: 'Failed to send code' })
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

    // Mark OTP as used
    await query('UPDATE otps SET used = TRUE WHERE id = $1', [otpRows[0].id])

    // Get or create user
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
    }

    const user = userRows[0]
    const token = signToken(user.id)

    res.json({ token, user: formatUser(user), isNewUser })
  } catch (err) {
    res.status(500).json({ message: 'Verification failed' })
  }
})

// PUT /auth/profile - update name, email, avatar
router.put('/profile', requireAuth, async (req, res) => {
  const { name, email, avatar_url } = req.body
  try {
    const { rows } = await query(
      'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), avatar_url = COALESCE($3, avatar_url) WHERE id = $4 RETURNING *',
      [name, email, avatar_url, req.user.id]
    )
    res.json({ user: formatUser(rows[0]) })
  } catch (err) {
    res.status(500).json({ message: 'Failed to update profile' })
  }
})

// GET /auth/profile
router.get('/profile', requireAuth, async (req, res) => {
  res.json({ user: formatUser(req.user) })
})

function formatUser(u) {
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    email: u.email,
    avatar: u.avatar_url,
    verified: u.verified,
    createdAt: u.created_at,
  }
}

module.exports = router
