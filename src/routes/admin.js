/**
 * admin.js — Admin-only routes
 * Protected by both JWT and a special admin check.
 * These routes give full read/write access to all data.
 */
const router    = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

// Admin check middleware — only your phone number can use these
function requireAdmin(req, res, next) {
  const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(p => p.trim())
  if (!req.user || !adminPhones.includes(req.user.phone)) {
    return res.status(403).json({ message: 'Admin access required' })
  }
  next()
}

// GET /admin/users — all users
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, phone, name, email, avatar_url, verified, push_token, created_at FROM users ORDER BY created_at DESC'
    )
    res.json({
      users: rows.map(u => ({
        id: u.id, phone: u.phone, name: u.name,
        email: u.email, avatar: u.avatar_url,
        verified: u.verified, createdAt: u.created_at,
      }))
    })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// PUT /admin/users/:id — edit any user
router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, verified } = req.body
  try {
    const { rows } = await query(
      'UPDATE users SET name=COALESCE($1,name), email=COALESCE($2,email), verified=COALESCE($3,verified) WHERE id=$4 RETURNING *',
      [name||null, email||null, verified !== undefined ? verified : null, req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ message: 'User not found' })
    res.json({ user: rows[0] })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// DELETE /admin/users/:id — delete user and all their data
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM comments  WHERE user_id=$1', [req.params.id])
    await query('DELETE FROM reviews   WHERE user_id=$1', [req.params.id])
    await query('DELETE FROM attendees WHERE user_id=$1', [req.params.id])
    await query('UPDATE events SET attendee_count=(SELECT COUNT(*) FROM attendees WHERE event_id=events.id) WHERE is_active=TRUE')
    await query('UPDATE events SET is_active=FALSE WHERE organizer_id=$1', [req.params.id])
    await query('DELETE FROM users WHERE id=$1', [req.params.id])
    res.json({ message: 'User and all data deleted' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// POST /admin/users — create user directly (no OTP needed)
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { phone, name, email } = req.body
  if (!phone) return res.status(400).json({ message: 'Phone required' })
  try {
    const { rows } = await query(
      'INSERT INTO users (phone, name, email, verified) VALUES ($1,$2,$3,TRUE) RETURNING *',
      [phone, name||null, email||null]
    )
    res.status(201).json({
      user: { id: rows[0].id, phone: rows[0].phone, name: rows[0].name, email: rows[0].email, verified: true, createdAt: rows[0].created_at }
    })
  } catch (err) {
    if (err.message.includes('unique')) return res.status(400).json({ message: 'Phone already registered' })
    res.status(500).json({ message: err.message })
  }
})

// POST /admin/events — create event as any user
router.post('/events', requireAuth, requireAdmin, async (req, res) => {
  const {
    title, description, category, cover_image,
    start_time, end_time, location_name, location_address,
    location_lat, location_lng, max_attendees, entry_fee, tags,
    organizer_id_override,
  } = req.body

  if (!title || !description || !category || !start_time || !end_time || !location_name)
    return res.status(400).json({ message: 'Missing required fields' })

  // Admin can create for any user, or defaults to themselves
  const organizerId = organizer_id_override || req.user.id

  try {
    const { rows } = await query(`
      INSERT INTO events (title, description, category, cover_image, start_time, end_time,
        location_name, location_address, location_lat, location_lng,
        organizer_id, max_attendees, entry_fee, tags)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
    `, [
      title, description, category,
      cover_image || 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=600',
      start_time, end_time, location_name, location_address || location_name,
      parseFloat(location_lat)||0.3476, parseFloat(location_lng)||32.5825,
      organizerId,
      max_attendees ? parseInt(max_attendees) : null,
      parseInt(entry_fee)||0, tags||[],
    ])

    const { rows: full } = await query(`
      SELECT e.*, u.name AS organizer_name, u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
      FROM events e JOIN users u ON u.id=e.organizer_id WHERE e.id=$1
    `, [rows[0].id])

    res.status(201).json({ event: fmtEvent(full[0]) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// PUT /admin/events/:id — edit any event (more fields than regular edit)
router.put('/admin-events/:id', requireAuth, requireAdmin, async (req, res) => {
  const { title, description, max_attendees, is_active } = req.body
  try {
    const { rows } = await query(`
      UPDATE events SET
        title=COALESCE($1,title),
        description=COALESCE($2,description),
        max_attendees=$3,
        is_active=COALESCE($4,is_active)
      WHERE id=$5 RETURNING *
    `, [title||null, description||null, max_attendees ? parseInt(max_attendees) : null, is_active !== undefined ? is_active : null, req.params.id])
    if (!rows[0]) return res.status(404).json({ message: 'Not found' })
    res.json({ event: fmtEvent(rows[0]) })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

function fmtEvent(row) {
  return {
    id: row.id, title: row.title, description: row.description,
    category: row.category, coverImage: row.cover_image,
    startTime: row.start_time, endTime: row.end_time,
    location: { name: row.location_name, address: row.location_address, lat: parseFloat(row.location_lat), lng: parseFloat(row.location_lng) },
    organizer: { id: row.organizer_id, name: row.organizer_name, avatar: row.organizer_avatar, verified: row.organizer_verified },
    attendeeCount: parseInt(row.attendee_count)||0, maxAttendees: row.max_attendees ? parseInt(row.max_attendees) : null,
    entryFee: parseInt(row.entry_fee)||0, isActive: row.is_active, createdAt: row.created_at,
  }
}

module.exports = router
