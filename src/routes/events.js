const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.get('/', async (req, res) => {
  try {
    const { category, limit = 50, offset = 0 } = req.query
    const params = []
    let where = `e.end_time > NOW() AND e.is_active = TRUE`
    let idx = 1
    if (category && category !== 'all') {
      where += ` AND e.category = $${idx}`
      params.push(category)
      idx++
    }
    params.push(parseInt(limit))
    params.push(parseInt(offset))
    const { rows } = await query(`
      SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone,
             u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
      FROM events e JOIN users u ON u.id = e.organizer_id
      WHERE ${where} ORDER BY e.start_time ASC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, params)
    res.json({ events: rows.map(fmt) })
  } catch (err) {
    console.error('GET /events:', err.message)
    res.status(500).json({ message: err.message })
  }
})

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone, u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
       FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.organizer_id = $1 ORDER BY e.created_at DESC`,
      [req.user.id]
    )
    res.json({ events: rows.map(fmt) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/attending', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone, u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
       FROM events e JOIN attendees a ON a.event_id = e.id JOIN users u ON u.id = e.organizer_id
       WHERE a.user_id = $1 ORDER BY e.start_time ASC`,
      [req.user.id]
    )
    res.json({ events: rows.map(fmt) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone, u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
       FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = $1`,
      [req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ message: 'Event not found' })
    res.json({ event: fmt(rows[0]) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', requireAuth, async (req, res) => {
  const { title, description, category, cover_image, start_time, end_time,
          location_name, location_address, location_lat, location_lng,
          max_attendees, entry_fee, original_fee, tags } = req.body
  if (!title || !description || !category || !start_time || !end_time || !location_name) {
    return res.status(400).json({ message: 'Missing required fields' })
  }
  try {
    const { rows } = await query(`
      INSERT INTO events (title, description, category, cover_image, start_time, end_time,
        location_name, location_address, location_lat, location_lng,
        organizer_id, max_attendees, entry_fee, original_fee, tags)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *
    `, [title, description, category,
        cover_image || 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=600',
        start_time, end_time, location_name, location_address || location_name,
        location_lat || 0.3136, location_lng || 32.5811,
        req.user.id, max_attendees || null, entry_fee || 0, original_fee || null, tags || []])
    const { rows: full } = await query(
      `SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone, u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
       FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = $1`,
      [rows[0].id]
    )
    res.status(201).json({ event: fmt(full[0]) })
  } catch (err) {
    console.error('POST /events:', err.message)
    res.status(500).json({ message: err.message })
  }
})

router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    await query('INSERT INTO attendees (event_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, req.user.id])
    await query('UPDATE events SET attendee_count = attendee_count + 1 WHERE id = $1', [req.params.id])
    res.json({ message: 'Joined' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/:id/leave', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM attendees WHERE event_id=$1 AND user_id=$2', [req.params.id, req.user.id])
    if (rowCount > 0) await query('UPDATE events SET attendee_count = GREATEST(0, attendee_count-1) WHERE id=$1', [req.params.id])
    res.json({ message: 'Left' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM events WHERE id=$1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ message: 'Not found' })
    if (rows[0].organizer_id !== req.user.id) return res.status(403).json({ message: 'Not your event' })
    await query('DELETE FROM events WHERE id=$1', [req.params.id])
    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

function fmt(row) {
  return {
    id: row.id, title: row.title, description: row.description,
    category: row.category, coverImage: row.cover_image,
    startTime: row.start_time, endTime: row.end_time,
    location: {
      name: row.location_name, address: row.location_address,
      lat: parseFloat(row.location_lat) || 0.3136,
      lng: parseFloat(row.location_lng) || 32.5811,
    },
    organizer: {
      id: row.organizer_id, name: row.organizer_name,
      phone: row.organizer_phone, avatar: row.organizer_avatar,
      verified: row.organizer_verified,
    },
    attendeeCount: parseInt(row.attendee_count) || 0,
    maxAttendees: row.max_attendees ? parseInt(row.max_attendees) : null,
    entryFee: parseInt(row.entry_fee) || 0,
    originalFee: row.original_fee ? parseInt(row.original_fee) : null,
    tags: row.tags || [], createdAt: row.created_at,
  }
}

module.exports = router
