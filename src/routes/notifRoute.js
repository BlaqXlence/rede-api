/**
 * GET  /notifications        — user's notification list
 * POST /notifications/read   — mark all as read
 * POST /notifications/:id/read — mark one as read
 */
const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

// GET /notifications
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT n.*, e.cover_image, e.title AS event_title
       FROM notifications n
       LEFT JOIN events e ON e.id = n.event_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user.id]
    )
    const unread = rows.filter(n => !n.read).length
    res.json({ notifications: rows, unread })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// POST /notifications/read — mark all read
router.post('/read', requireAuth, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET read = TRUE WHERE user_id = $1', [req.user.id]
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// POST /notifications/:id/read
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
