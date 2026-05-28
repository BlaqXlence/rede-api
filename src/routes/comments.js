// UUID validation helper - prevents crash on local-only event IDs
function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

/**
 * comments.js
 * - Organizer can always comment on their own event
 * - Attendees can comment
 * - Everyone can read
 * - Author can delete their own comment
 */
const router = require('express').Router({ mergeParams: true })
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

// GET /events/:id/comments
router.get('/', async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.json({ comments: [] })
  try {
    const { rows } = await query(`
      SELECT c.*, u.name AS author_name, u.avatar_url AS author_avatar
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.event_id = $1
      ORDER BY c.created_at ASC
    `, [req.params.id])
    res.json({ comments: rows.map(fmt) })
  } catch (err) {
    console.error('GET comments:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// POST /events/:id/comments
router.post('/', requireAuth, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ message: 'Invalid event' })
  const { text } = req.body
  if (!text || !text.trim()) return res.status(400).json({ message: 'Comment cannot be empty' })
  if (text.trim().length > 500) return res.status(400).json({ message: 'Max 500 characters' })

  try {
    const { rows: evtRows } = await query('SELECT * FROM events WHERE id = $1', [req.params.id])
    if (!evtRows[0]) return res.status(404).json({ message: 'Event not found' })

    const isOrganizer = evtRows[0].organizer_id === req.user.id

    // Allow organizer OR attendee to comment
    if (!isOrganizer) {
      const { rows: attRows } = await query(
        'SELECT 1 FROM attendees WHERE event_id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      )
      if (!attRows[0]) {
        return res.status(403).json({ message: 'Join this event to comment' })
      }
    }

    const { rows } = await query(
      'INSERT INTO comments (event_id, user_id, text) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, req.user.id, text.trim()]
    )

    const { rows: full } = await query(`
      SELECT c.*, u.name AS author_name, u.avatar_url AS author_avatar
      FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1
    `, [rows[0].id])

    res.status(201).json({ comment: fmt(full[0]) })
  } catch (err) {
    console.error('POST comment:', err.message)
    res.status(500).json({ message: err.message })
  }
})


// GET /events/:id/can-comment — can current user post?
router.get('/can-comment', requireAuth, async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.json({ canComment: false })
  try {
    const { rows: evtRows } = await query('SELECT organizer_id FROM events WHERE id=$1', [req.params.id])
    if (!evtRows[0]) return res.json({ canComment: false })
    if (evtRows[0].organizer_id === req.user.id) return res.json({ canComment: true, reason: 'organizer' })
    const { rows: attRows } = await query(
      'SELECT 1 FROM attendees WHERE event_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    )
    res.json({ canComment: attRows.length > 0, reason: attRows.length > 0 ? 'attendee' : 'not_member' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /events/:id/comments/:commentId
router.delete('/:commentId', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM comments WHERE id = $1', [req.params.commentId])
    if (!rows[0]) return res.status(404).json({ message: 'Comment not found' })
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ message: 'Not your comment' })
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
