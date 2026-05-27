/**
 * notifications.js
 * Push notification helpers using OneSignal
 * Called internally from events routes when someone joins
 */
const { query } = require('../db')

const ONE_SIGNAL_APP_ID  = process.env.ONE_SIGNAL_APP_ID
const ONE_SIGNAL_API_KEY = process.env.ONE_SIGNAL_REST_API_KEY

// Send push to specific user
async function sendPushToUser(userId, title, body, data = {}) {
  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_API_KEY) {
    console.log(`📲 Push (dev) to ${userId}: ${title} — ${body}`)
    return
  }

  try {
    // Get user's push token
    const { rows } = await query(
      'SELECT push_token FROM users WHERE id = $1', [userId]
    )
    if (!rows[0]?.push_token) return

    await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${ONE_SIGNAL_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        app_id:            ONE_SIGNAL_APP_ID,
        include_player_ids: [rows[0].push_token],
        headings:          { en: title },
        contents:          { en: body },
        data,
      }),
    })
  } catch (err) {
    console.error('Push error:', err.message)
  }
}

// Notify organizer when someone joins their event
async function notifyOrganizerJoin(eventId, joinerName) {
  try {
    const { rows } = await query(
      'SELECT organizer_id, title FROM events WHERE id = $1', [eventId]
    )
    if (!rows[0]) return
    await sendPushToUser(
      rows[0].organizer_id,
      'Someone joined your event!',
      `${joinerName || 'A new person'} is going to "${rows[0].title}"`,
      { type: 'join', eventId }
    )
  } catch {}
}

// Remind attendees 24h before event
async function sendEventReminders() {
  try {
    const tomorrow    = new Date(Date.now() + 24 * 3_600_000)
    const tomorrowEnd = new Date(Date.now() + 25 * 3_600_000)

    const { rows: events } = await query(`
      SELECT e.id, e.title, e.start_time
      FROM events e
      WHERE e.start_time BETWEEN $1 AND $2 AND e.is_active = TRUE
    `, [tomorrow, tomorrowEnd])

    for (const event of events) {
      const { rows: attendees } = await query(
        'SELECT user_id FROM attendees WHERE event_id = $1', [event.id]
      )
      for (const a of attendees) {
        await sendPushToUser(
          a.user_id,
          'Event tomorrow! 🎉',
          `"${event.title}" starts tomorrow. Don't miss it!`,
          { type: 'reminder', eventId: event.id }
        )
      }
    }
  } catch (err) {
    console.error('Reminder error:', err.message)
  }
}

module.exports = { sendPushToUser, notifyOrganizerJoin, sendEventReminders }
