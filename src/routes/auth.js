const router = require('express').Router()
const { query } = require('../db')
const { requireAuth, signToken } = require('../middleware/auth')

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

router.post('/otp/send', async (req, res) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ message: 'Phone required' })
  try {
    const code = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    await query('DELETE FROM otps WHERE phone = $1', [phone])
    await query('INSERT INTO otps (phone, code, expires_at) VALUES ($1, $2, $3)', [phone, code, expiresAt])
    console.log(`OTP for ${phone} is ${code}`)
    res.json({ message: 'Code sent', dev_code: code })
  } catch (err) {
    console.error('Send OTP error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

router.post('/otp/verify', async (req, res) => {
  const { phone, code } = req.body
  if (!phone || !code) return res.status(400).json({ message: 'Phone and code required' })
  try {
    const { rows: otpRows } = await query(
      'SELECT * FROM otps WHERE phone = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()',
      [phone, code]
    )
    if (!otpRows[0]) return res.status(400).json({ message: 'Invalid or expired code' })
    await query('UPDATE otps SET used = TRUE WHERE id = $1', [otpRows[0].id])
    let { rows: userRows } = await query('SELECT * FROM users WHERE phone = $1', [phone])
    let isNewUser = false
    if (!userRows[0]) {
      const { rows } = await query('INSERT INTO users (phone, verified) VALUES ($1, TRUE) RETURNING *', [phone])
      userRows = rows
      isNewUser = true
    } else {
      await query('UPDATE users SET verified = TRUE WHERE phone = $1', [phone])
    }
    const token = signToken(userRows[0].id)
    res.json({ token, user: formatUser(userRows[0]), isNewUser })
  } catch (err) {
    console.error('Verify OTP error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

router.put('/profile', requireAuth, async (req, res) => {
  const { name, email, avatar_url } = req.body
  try {
    const { rows } = await query(
      'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), avatar_url = COALESCE($3, avatar_url) WHERE id = $4 RETURNING *',
      [name, email, avatar_url, req.user.id]
    )
    res.json({ user: formatUser(rows[0]) })
  } catch (err) {
    console.error('Update profile error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

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
