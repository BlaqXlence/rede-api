/**
 * search.js
 * Real database search — by title, description, category, location
 * GET /search?q=party&category=music&city=kampala&lat=0.3&lng=32.5
 */
const router  = require('express').Router()
const { query } = require('../db')

router.get('/', async (req, res) => {
  const { q, category, city, limit = 20, offset = 0 } = req.query

  if (!q || q.trim().length < 2) {
    return res.status(400).json({ message: 'Search query too short' })
  }

  try {
    const params  = []
    const conds   = ['e.end_time > NOW()', 'e.is_active = TRUE']
    let   idx     = 1

    // Full text search across title, description, location
    conds.push(`(
      e.title ILIKE $${idx} OR
      e.description ILIKE $${idx} OR
      e.location_name ILIKE $${idx} OR
      e.location_address ILIKE $${idx}
    )`)
    params.push(`%${q.trim()}%`)
    idx++

    if (category && category !== 'all') {
      conds.push(`e.category = $${idx}`)
      params.push(category)
      idx++
    }

    params.push(parseInt(limit))
    params.push(parseInt(offset))

    const { rows } = await query(`
      SELECT
        e.*,
        u.name       AS organizer_name,
        u.avatar_url AS organizer_avatar,
        u.verified   AS organizer_verified,
        COALESCE(AVG(r.rating), 0) AS avg_rating
      FROM events e
      JOIN users u ON u.id = e.organizer_id
      LEFT JOIN reviews r ON r.event_id = e.id
      WHERE ${conds.join(' AND ')}
      GROUP BY e.id, u.name, u.avatar_url, u.verified
      ORDER BY e.start_time ASC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, params)

    res.json({
      results: rows.map(fmt),
      count:   rows.length,
      query:   q,
    })
  } catch (err) {
    console.error('Search error:', err.message)
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
      lat:     parseFloat(row.location_lat),
      lng:     parseFloat(row.location_lng),
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
    avgRating:     parseFloat(row.avg_rating) || 0,
    tags:          row.tags || [],
    createdAt:     row.created_at,
  }
}

module.exports = router
