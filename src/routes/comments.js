/**
 * comments.js
 * Event comment threads — simple, flat, real-time via polling
 * GET  /events/:id/comments — list comments
 * POST /events/:id/comments — post a comment (auth required)
 * DELETE /events/:id/comments/:commentId — delete own comment
 */
const router = require('express').Router({ mergeParams: true })
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

// GET /events/:id/comments
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.*, u.name AS author_name, u.avatar_url AS author_avatar
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.event_id = $1
      ORDER BY c.created_at ASC
      LIMIT 100
    `, [req.params.id])

    res.json({ comments: rows.map(fmt) })
  } catch (err) {
    console.error('GET comments error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// POST /events/:id/comments
router.post('/', requireAuth, async (req, res) => {
  const { text } = req.body
  if (!text || text.trim().length < 1) {
    return res.status(400).json({ message: 'Comment cannot be empty' })
  }
  if (text.trim().length > 500) {
    return res.status(400).json({ message: 'Comment too long (max 500 characters)' })
  }

  try {
    // Check event exists
    const { rows: evtRows } = await query(
      'SELECT id FROM events WHERE id = $1', [req.params.id]
    )
    if (!evtRows[0]) return res.status(404).json({ message: 'Event not found' })

    // Only attendees can comment
    const { rows: attRows } = await query(
      'SELECT id FROM attendees WHERE event_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    if (!attRows[0]) {
      return res.status(403).json({ message: 'You need to join this event to comment' })
    }

    const { rows } = await query(`
      INSERT INTO comments (event_id, user_id, text)
      VALUES ($1, $2, $3) RETURNING *
    `, [req.params.id, req.user.id, text.trim()])

    // Fetch with author info
    const { rows: full } = await query(`
      SELECT c.*, u.name AS author_name, u.avatar_url AS author_avatar
      FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.id = $1
    `, [rows[0].id])

    res.status(201).json({ comment: fmt(full[0]) })
  } catch (err) {
    console.error('POST comment error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// DELETE /events/:id/comments/:commentId
router.delete('/:commentId', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM comments WHERE id = $1', [req.params.commentId]
    )
    if (!rows[0]) return res.status(404).json({ message: 'Comment not found' })
    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'Not your comment' })
    }
    await query('DELETE FROM comments WHERE id = $1', [req.params.commentId])
    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

function fmt(r) {
  return {
    id:           r.id,
    eventId:      r.event_id,
    userId:       r.user_id,
    text:         r.text,
    authorName:   r.author_name,
    authorAvatar: r.author_avatar,
    createdAt:    r.created_at,
  }
}

module.exports = router

// The attendee check is also enforced in the frontend (CommentSection.js)
// For extra security it's also checked here server-side
