function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

/**
 * reviews.js — Event review routes
 * POST /events/:id/reviews  — leave a review (must have attended)
 * GET  /events/:id/reviews  — get all reviews for an event
 * PUT  /events/:id/reviews  — edit your review
 */
const router = require('express').Router({ mergeParams: true })
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

// GET /events/:id/reviews
router.get('/', async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.json({ reviews: [], average: null, count: 0 })
  try {
    const { rows } = await query(`
      SELECT r.*, u.name AS reviewer_name, u.avatar_url AS reviewer_avatar
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.event_id = $1
      ORDER BY r.created_at DESC
    `, [req.params.id])

    // Average rating
    const avg = rows.length
      ? (rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1)
      : null

    res.json({ reviews: rows.map(fmt), average: avg, count: rows.length })
  } catch (err) {
    console.error('GET reviews error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// POST /events/:id/reviews
router.post('/', requireAuth, async (req, res) => {
  const { rating, comment } = req.body
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be 1–5' })
  }

  try {
    // Check event exists and has ended (can only review past events)
    const { rows: evtRows } = await query(
      'SELECT * FROM events WHERE id = $1', [req.params.id]
    )
    if (!evtRows[0]) return res.status(404).json({ message: 'Event not found' })

    if (new Date(evtRows[0].end_time) > new Date()) {
      return res.status(400).json({ message: 'You can only review events that have ended' })
    }

    const { rows } = await query(`
      INSERT INTO reviews (event_id, user_id, rating, comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (event_id, user_id) DO UPDATE
        SET rating = $3, comment = $4, created_at = NOW()
      RETURNING *
    `, [req.params.id, req.user.id, rating, comment || null])

    res.status(201).json({ review: fmt(rows[0]) })
  } catch (err) {
    console.error('POST review error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

function fmt(r) {
  return {
    id: r.id, eventId: r.event_id, userId: r.user_id,
    rating: r.rating, comment: r.comment,
    reviewerName: r.reviewer_name, reviewerAvatar: r.reviewer_avatar,
    createdAt: r.created_at,
  }
}

module.exports = router
