const router  = require('express').Router()
const { query } = require('../db')
const { requireAuth, signToken } = require('../middleware/auth')

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function sendSMS(phone, message) {
  const username = process.env.AT_USERNAME
  const apiKey   = process.env.AT_API_KEY
  const senderId = process.env.AT_SENDER_ID || 'AFRICASTALKING'

  if (!username || !apiKey || username === 'sandbox') {
    console.log(`\n📱 OTP for ${phone}: ${message}\n`)
    return { success: true, dev: true }
  }

  try {
    const AT = require('africastalking')
    const at  = AT({ username, apiKey })
    await at.SMS.send({ to: [phone], message, from: senderId })
    return { success: true }
  } catch (err) {
    console.error('SMS error:', err.message)
    console.log(`📱 FALLBACK OTP for ${phone}: ${message}`)
    return { success: false }
  }
}

router.post('/otp/send', async (req, res) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ message: 'Phone required' })
  try {
    const code      = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    await query('DELETE FROM otps WHERE phone = $1', [phone])
    await query('INSERT INTO otps (phone, code, expires_at) VALUES ($1, $2, $3)', [phone, code, expiresAt])
    const msg = `Your REDE code is: ${code}. Valid 10 minutes.`
    await sendSMS(phone, msg)
    res.json({ message: 'Code sent', dev_code: process.env.NODE_ENV !== 'production' ? code : undefined })
  } catch (err) {
    console.error('OTP send:', err.message)
    res.status(500).json({ message: err.message })
  }
})

router.post('/otp/verify', async (req, res) => {
  const { phone, code } = req.body
  if (!phone || !code) return res.status(400).json({ message: 'Phone and code required' })
  try {
    const { rows: otpRows } = await query(
      'SELECT * FROM otps WHERE phone=$1 AND code=$2 AND used=FALSE AND expires_at>NOW()',
      [phone, code]
    )
    if (!otpRows[0]) return res.status(400).json({ message: 'Invalid or expired code' })
    await query('UPDATE otps SET used=TRUE WHERE id=$1', [otpRows[0].id])

    let { rows: userRows } = await query('SELECT * FROM users WHERE phone=$1', [phone])
    let isNewUser = false
    if (!userRows[0]) {
      const { rows } = await query('INSERT INTO users (phone, verified) VALUES ($1, TRUE) RETURNING *', [phone])
      userRows = rows; isNewUser = true
    } else {
      await query('UPDATE users SET verified=TRUE WHERE phone=$1', [phone])
      const { rows } = await query('SELECT * FROM users WHERE phone=$1', [phone])
      userRows = rows
    }

    const token = signToken(userRows[0].id)
    res.json({ token, user: formatUser(userRows[0]), isNewUser })
  } catch (err) {
    console.error('OTP verify:', err.message)
    res.status(500).json({ message: err.message })
  }
})

router.put('/profile', requireAuth, async (req, res) => {
  const { name, email, avatar_url, push_token } = req.body
  try {
    if (name && name.trim() !== req.user.name) {
      const { rows: logRows } = await query('SELECT changed_at FROM name_change_log WHERE user_id=$1', [req.user.id])
      if (logRows[0]) {
        const daysSince = (Date.now() - new Date(logRows[0].changed_at)) / 86400000
        if (daysSince < 7) {
          const left = Math.ceil(7 - daysSince)
          return res.status(400).json({ message: `Name can be changed again in ${left} day${left > 1 ? 's' : ''}` })
        }
      }
      await query('INSERT INTO name_change_log (user_id, changed_at) VALUES ($1, NOW()) ON CONFLICT (user_id) DO UPDATE SET changed_at=NOW()', [req.user.id])
    }
    const { rows } = await query(
      `UPDATE users SET
        name       = COALESCE($1, name),
        email      = COALESCE($2, email),
        avatar_url = COALESCE($3, avatar_url),
        push_token = COALESCE($4, push_token),
        first_name = COALESCE($6, first_name),
        last_name  = COALESCE($7, last_name),
        nickname   = COALESCE($8, nickname),
        age        = COALESCE($9, age),
        interests  = COALESCE($10, interests),
        profile_complete = CASE WHEN $6 IS NOT NULL AND $8 IS NOT NULL THEN TRUE ELSE profile_complete END
       WHERE id = $5 RETURNING *`,
      [
        name?.trim()||null, email?.trim()||null, avatar_url||null, push_token||null,
        req.user.id,
        first_name?.trim()||null, last_name?.trim()||null,
        nickname?.trim()||null,
        age ? parseInt(age) : null,
        interests?.length > 0 ? interests : null,
      ]
    )
    res.json({ user: formatUser(rows[0]) })
  } catch (err) {
    console.error('Profile update:', err.message)
    res.status(500).json({ message: err.message })
  }
})

router.get('/profile', requireAuth, async (req, res) => {
  res.json({ user: formatUser(req.user) })
})

// Public organizer profile — returns camelCase for frontend
router.get('/organizer/:id', async (req, res) => {
  try {
    const { rows: userRows } = await query(
      'SELECT id, name, avatar_url, verified, created_at FROM users WHERE id=$1', [req.params.id]
    )
    if (!userRows[0]) return res.status(404).json({ message: 'Not found' })

    const { rows: eventRows } = await query(`
      SELECT
        e.id, e.title, e.description, e.category,
        e.cover_image, e.start_time, e.end_time,
        e.location_name, e.location_address, e.location_lat, e.location_lng,
        e.attendee_count, e.max_attendees, e.entry_fee, e.original_fee,
        e.tags, e.created_at, e.organizer_id,
        u.name AS organizer_name, u.avatar_url AS organizer_avatar, u.verified AS organizer_verified,
        COALESCE(AVG(r.rating), 0) AS avg_rating,
        COUNT(DISTINCT r.id) AS review_count
      FROM events e
      JOIN users u ON u.id = e.organizer_id
      LEFT JOIN reviews r ON r.event_id = e.id
      WHERE e.organizer_id=$1 AND e.is_active=TRUE
      GROUP BY e.id, u.name, u.avatar_url, u.verified
      ORDER BY e.start_time DESC
    `, [req.params.id])

    const totalRating = eventRows.reduce((s, e) => s + parseFloat(e.avg_rating), 0)
    const avgRating   = eventRows.length > 0 ? (totalRating / eventRows.length).toFixed(1) : null

    // Count how many events had rating > 0 (used for verified badge logic)
    const verifiedThreshold = 3

    res.json({
      organizer: {
        id:        userRows[0].id,
        name:      userRows[0].name,
        avatar:    userRows[0].avatar_url,
        verified:  userRows[0].verified,
        joinedAt:  userRows[0].created_at,
      },
      events:      eventRows.map(fmtEvent),
      totalEvents: eventRows.length,
      avgRating,
      canVerify:   eventRows.length >= verifiedThreshold,
    })
  } catch (err) {
    console.error('Organizer profile:', err.message)
    res.status(500).json({ message: err.message })
  }
})

function formatUser(u) {
  return {
    id:              u.id,
    phone:           u.phone,
    name:            u.nickname || u.name,
    nickname:        u.nickname || u.name,
    firstName:       u.first_name  || null,
    lastName:        u.last_name   || null,
    email:           u.email       || null,
    avatar:          u.avatar_url  || null,
    verified:        u.verified    || false,
    age:             u.age         || null,
    interests:       u.interests   || [],
    profileComplete: u.profile_complete || false,
    pushToken:       u.push_token  || null,
    createdAt:       u.created_at,
  }
}
}

// Convert snake_case DB row to camelCase for frontend
function fmtEvent(row) {
  return {
    id:          row.id,
    title:       row.title,
    description: row.description,
    category:    row.category,
    coverImage:  row.cover_image,
    startTime:   row.start_time,
    endTime:     row.end_time,
    location: {
      name:    row.location_name,
      address: row.location_address,
      lat:     parseFloat(row.location_lat) || 0.3476,
      lng:     parseFloat(row.location_lng) || 32.5825,
    },
    organizer: {
      id:       row.organizer_id,
      name:     row.organizer_name,
      avatar:   row.organizer_avatar,
      verified: row.organizer_verified,
    },
    attendeeCount: parseInt(row.attendee_count) || 0,
    maxAttendees:  row.max_attendees ? parseInt(row.max_attendees) : null,
    entryFee:      parseInt(row.entry_fee) || 0,
    originalFee:   row.original_fee ? parseInt(row.original_fee) : null,
    avgRating:     parseFloat(row.avg_rating) || 0,
    tags:          row.tags || [],
    createdAt:     row.created_at,
    isNow:         new Date(row.start_time) <= new Date() && new Date(row.end_time) >= new Date(),
  }
}


// GET /auth/search-organisers?q=name
router.get('/search-organisers', async (req, res) => {
  const q = (req.query.q || '').trim()
  if (!q || q.length < 2) return res.json({ organisers: [] })
  try {
    const { rows } = await query(`
      SELECT u.id, u.name, u.avatar_url AS avatar, u.verified,
             COUNT(DISTINCT e.id) AS event_count,
             ROUND(AVG(r.rating), 1) AS avg_rating
      FROM users u
      LEFT JOIN events e ON e.organizer_id = u.id AND e.is_active = TRUE
      LEFT JOIN reviews r ON r.event_id = e.id
      WHERE u.name ILIKE $1
      GROUP BY u.id
      ORDER BY event_count DESC, u.verified DESC
      LIMIT 20
    `, [`%${q}%`])

    res.json({
      organisers: rows.map(o => ({
        id: o.id, name: o.name, avatar: o.avatar_url || o.avatar,
        verified: o.verified,
        eventCount: parseInt(o.event_count) || 0,
        avgRating: o.avg_rating ? parseFloat(o.avg_rating) : null,
      }))
    })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router

// DELETE /auth/account — remove user and all their data
router.delete('/account', requireAuth, async (req, res) => {
  try {
    // Delete in order to respect foreign keys:
    // comments -> reviews -> attendees -> events -> user
    await query('DELETE FROM comments  WHERE user_id = $1', [req.user.id])
    await query('DELETE FROM reviews   WHERE user_id = $1', [req.user.id])
    await query('DELETE FROM attendees WHERE user_id = $1', [req.user.id])

    // Update attendee counts for events they left
    await query(`
      UPDATE events SET attendee_count = (
        SELECT COUNT(*) FROM attendees WHERE event_id = events.id
      ) WHERE is_active = TRUE
    `)

    // Their events — soft delete (keep for history)
    await query('UPDATE events SET is_active = FALSE WHERE organizer_id = $1', [req.user.id])

    // Delete user
    await query('DELETE FROM users WHERE id = $1', [req.user.id])

    res.json({ message: 'Account deleted' })
  } catch (err) {
    console.error('Delete account:', err.message)
    res.status(500).json({ message: err.message })
  }
})
