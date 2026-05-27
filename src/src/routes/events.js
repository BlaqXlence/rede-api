/**
 * events.js — Full event CRUD + join/leave + search
 * Push notifications fire on join
 */
const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { notifyOrganizerJoin } = require('./notifications')

// GET /events — list events (no haversine — caused IPv6 issues)
router.get('/', async (req, res) => {
  try {
    const { category, city, limit = 50, offset = 0 } = req.query
    const params = []
    const conds  = ['e.end_time > NOW()', 'e.is_active = TRUE']
    let idx = 1

    if (category && category !== 'all') {
      conds.push(`e.category = $${idx}`)
      params.push(category)
      idx++
    }

    if (city && city !== 'all') {
      conds.push(`LOWER(e.location_address) LIKE $${idx}`)
      params.push(`%${city.toLowerCase()}%`)
      idx++
    }

    params.push(parseInt(limit))
    params.push(parseInt(offset))

    const { rows } = await query(`
      SELECT
        e.*,
        u.name       AS organizer_name,
        u.phone      AS organizer_phone,
        u.avatar_url AS organizer_avatar,
        u.verified   AS organizer_verified,
        COALESCE(AVG(r.rating), 0) AS avg_rating
      FROM events e
      JOIN users u ON u.id = e.organizer_id
      LEFT JOIN reviews r ON r.event_id = e.id
      WHERE ${conds.join(' AND ')}
      GROUP BY e.id, u.name, u.phone, u.avatar_url, u.verified
      ORDER BY e.start_time ASC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, params)

    res.json({ events: rows.map(fmt) })
  } catch (err) {
    console.error('GET /events error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// GET /events/mine
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone,
             u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
      FROM events e JOIN users u ON u.id = e.organizer_id
      WHERE e.organizer_id = $1 ORDER BY e.created_at DESC
    `, [req.user.id])
    res.json({ events: rows.map(fmt) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /events/attending
router.get('/attending', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone,
             u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
      FROM events e
      JOIN attendees a ON a.event_id = e.id
      JOIN users u ON u.id = e.organizer_id
      WHERE a.user_id = $1 ORDER BY e.start_time ASC
    `, [req.user.id])
    res.json({ events: rows.map(fmt) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /events/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone,
             u.avatar_url AS organizer_avatar, u.verified AS organizer_verified,
             COALESCE(AVG(r.rating), 0) AS avg_rating
      FROM events e
      JOIN users u ON u.id = e.organizer_id
      LEFT JOIN reviews r ON r.event_id = e.id
      WHERE e.id = $1 GROUP BY e.id, u.name, u.phone, u.avatar_url, u.verified
    `, [req.params.id])
    if (!rows[0]) return res.status(404).json({ message: 'Event not found' })
    res.json({ event: fmt(rows[0]) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /events — create
router.post('/', requireAuth, async (req, res) => {
  const {
    title, description, category, cover_image,
    start_time, end_time,
    location_name, location_address, location_lat, location_lng,
    max_attendees, entry_fee, original_fee, tags,
  } = req.body

  if (!title || !description || !category || !start_time || !end_time || !location_name) {
    return res.status(400).json({ message: 'Missing required fields' })
  }

  // Max 7 days ahead
  const maxDate = new Date(Date.now() + 7 * 86400000)
  if (new Date(start_time) > maxDate) {
    return res.status(400).json({ message: 'Events can only be planned up to 7 days ahead' })
  }

  try {
    const { rows } = await query(`
      INSERT INTO events (
        title, description, category, cover_image,
        start_time, end_time,
        location_name, location_address, location_lat, location_lng,
        organizer_id, max_attendees, entry_fee, original_fee, tags
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      title, description, category,
      cover_image || 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=600',
      start_time, end_time,
      location_name, location_address || location_name,
      parseFloat(location_lat) || 0.3476,
      parseFloat(location_lng) || 32.5825,
      req.user.id,
      max_attendees ? parseInt(max_attendees) : null,
      parseInt(entry_fee) || 0,
      original_fee ? parseInt(original_fee) : null,
      tags || [],
    ])

    const { rows: full } = await query(`
      SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone,
             u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
      FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = $1
    `, [rows[0].id])

    res.status(201).json({ event: fmt(full[0]) })
  } catch (err) {
    console.error('POST /events error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// PUT /events/:id — edit
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: evtRows } = await query('SELECT * FROM events WHERE id = $1', [req.params.id])
    if (!evtRows[0]) return res.status(404).json({ message: 'Event not found' })
    if (evtRows[0].organizer_id !== req.user.id) return res.status(403).json({ message: 'Not your event' })

    const hoursUntil = (new Date(evtRows[0].start_time) - Date.now()) / 3_600_000
    const { title, description, max_attendees } = req.body

    const { rows } = await query(`
      UPDATE events SET
        title        = COALESCE($1, title),
        description  = COALESCE($2, description),
        max_attendees = $3
      WHERE id = $4 RETURNING *
    `, [title?.trim() || null, description?.trim() || null,
        max_attendees ? parseInt(max_attendees) : null, req.params.id])

    const { rows: full } = await query(`
      SELECT e.*, u.name AS organizer_name, u.phone AS organizer_phone,
             u.avatar_url AS organizer_avatar, u.verified AS organizer_verified
      FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = $1
    `, [rows[0].id])

    res.json({ event: fmt(full[0]) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /events/:id — only if 0 attendees
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM events WHERE id = $1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ message: 'Not found' })
    if (rows[0].organizer_id !== req.user.id) return res.status(403).json({ message: 'Not your event' })
    if (rows[0].attendee_count > 0) {
      return res.status(400).json({ message: 'Cannot delete — people have already joined' })
    }
    await query('DELETE FROM events WHERE id = $1', [req.params.id])
    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /events/:id/join
router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    const { rows: evtRows } = await query('SELECT * FROM events WHERE id = $1', [req.params.id])
    if (!evtRows[0]) return res.status(404).json({ message: 'Event not found' })
    if (evtRows[0].max_attendees && evtRows[0].attendee_count >= evtRows[0].max_attendees) {
      return res.status(400).json({ message: 'Event is full' })
    }

    await query(
      'INSERT INTO attendees (event_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, req.user.id]
    )
    await query(
      'UPDATE events SET attendee_count = attendee_count + 1 WHERE id = $1',
      [req.params.id]
    )

    // Notify organizer in background
    notifyOrganizerJoin(req.params.id, req.user.name).catch(() => {})

    res.json({ message: 'Joined' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /events/:id/leave
router.post('/:id/leave', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM attendees WHERE event_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    )
    if (rowCount > 0) {
      await query(
        'UPDATE events SET attendee_count = GREATEST(0, attendee_count - 1) WHERE id = $1',
        [req.params.id]
      )
    }
    res.json({ message: 'Left' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

function fmt(row) {
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
      phone:    row.organizer_phone,
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

module.exports = router
