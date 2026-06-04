/**
 * notifications.js — OneSignal push notification service
 * Sends via OneSignal REST API + stores in-app notification history in DB
 */
const { query } = require('../db')

const ONE_SIGNAL_APP_ID  = process.env.ONE_SIGNAL_APP_ID
const ONE_SIGNAL_API_KEY = process.env.ONE_SIGNAL_REST_API_KEY
const ONE_SIGNAL_URL     = 'https://onesignal.com/api/v1/notifications'

// ── Send via OneSignal REST API ────────────────────────────────
async function sendOneSignal(playerIds, title, body, data = {}) {
  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_API_KEY) {
    console.log('OneSignal not configured — skipping push')
    return
  }
  if (!playerIds || playerIds.length === 0) return

  try {
    const res = await fetch(ONE_SIGNAL_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${ONE_SIGNAL_API_KEY}`,
      },
      body: JSON.stringify({
        app_id:             ONE_SIGNAL_APP_ID,
        include_player_ids: playerIds,
        headings:           { en: title },
        contents:           { en: body  },
        data,
        android_channel_id: 'rede',
        small_icon:         'notification_icon',
        color:              'FF6600',
        priority:           10,
      }),
    })
    const json = await res.json()
    if (json.errors) console.error('OneSignal error:', json.errors)
    else console.log(`📲 Push sent to ${json.recipients || 0} device(s)`)
  } catch (err) {
    console.error('OneSignal send error:', err.message)
  }
}

// ── Get OneSignal player ID for a user ────────────────────────
async function getPlayerIds(userIds) {
  if (!userIds || userIds.length === 0) return []
  try {
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',')
    const { rows } = await query(
      `SELECT push_token FROM users WHERE id IN (${placeholders}) AND push_token IS NOT NULL`,
      userIds
    )
    return rows.map(r => r.push_token).filter(Boolean)
  } catch { return [] }
}

// ── Store in DB + send push ────────────────────────────────────
async function notify(userId, type, title, body, eventId = null) {
  try {
    await query(
      `INSERT INTO notifications (user_id, type, title, body, event_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, body, eventId]
    )
    const playerIds = await getPlayerIds([userId])
    if (playerIds.length > 0) {
      await sendOneSignal(playerIds, title, body, { type, eventId })
    }
  } catch (err) {
    console.error('notify() error:', err.message)
  }
}

async function notifyMany(userIds, type, title, body, eventId = null) {
  if (!userIds || userIds.length === 0) return
  try {
    // Store for each user in DB
    const values = userIds.map((id, i) =>
      `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
    ).join(', ')
    const params = userIds.flatMap(id => [id, type, title, body, eventId])
    await query(
      `INSERT INTO notifications (user_id, type, title, body, event_id) VALUES ${values}`,
      params
    )
    // Send push to all at once
    const playerIds = await getPlayerIds(userIds)
    if (playerIds.length > 0) {
      await sendOneSignal(playerIds, title, body, { type, eventId })
    }
  } catch (err) {
    console.error('notifyMany() error:', err.message)
  }
}

// ── Notification triggers ──────────────────────────────────────

async function notifyOrganizerJoin(eventId, joinerName) {
  try {
    const { rows } = await query(
      'SELECT organizer_id, title FROM events WHERE id = $1', [eventId]
    )
    if (!rows[0]) return
    await notify(
      rows[0].organizer_id, 'join',
      'New attendee',
      `${joinerName || 'Someone'} is going to "${rows[0].title}"`,
      eventId
    )
  } catch {}
}

async function notifyOrganizerLeave(eventId, leaverName) {
  try {
    const { rows } = await query(
      'SELECT organizer_id, title FROM events WHERE id = $1', [eventId]
    )
    if (!rows[0]) return
    await notify(
      rows[0].organizer_id, 'leave',
      'Attendee left',
      `${leaverName || 'Someone'} left "${rows[0].title}"`,
      eventId
    )
  } catch {}
}

async function notifyAttendeesCancel(eventId, eventTitle) {
  try {
    const { rows } = await query(
      'SELECT user_id FROM attendees WHERE event_id = $1', [eventId]
    )
    const ids = rows.map(r => r.user_id)
    if (ids.length === 0) return
    await notifyMany(
      ids, 'cancel',
      'Event cancelled',
      `"${eventTitle}" has been cancelled by the organiser`,
      eventId
    )
  } catch {}
}

async function notifyAttendeesUpdate(eventId, eventTitle, changeDesc) {
  try {
    const { rows } = await query(
      'SELECT user_id FROM attendees WHERE event_id = $1', [eventId]
    )
    const ids = rows.map(r => r.user_id)
    if (ids.length === 0) return
    await notifyMany(
      ids, 'update',
      'Event updated',
      `${changeDesc || 'Details changed'} for "${eventTitle}"`,
      eventId
    )
  } catch {}
}

async function notifyOrganizerComment(eventId, commenterName) {
  try {
    const { rows } = await query(
      'SELECT organizer_id, title FROM events WHERE id = $1', [eventId]
    )
    if (!rows[0]) return
    await notify(
      rows[0].organizer_id, 'comment',
      'New comment',
      `${commenterName || 'Someone'} commented on "${rows[0].title}"`,
      eventId
    )
  } catch {}
}

async function sendOneHourReminders() {
  try {
    const from = new Date(Date.now() + 55 * 60_000)
    const to   = new Date(Date.now() + 65 * 60_000)
    const { rows: events } = await query(
      `SELECT id, title FROM events WHERE start_time BETWEEN $1 AND $2`, [from, to]
    )
    for (const e of events) {
      const { rows: att } = await query(
        'SELECT user_id FROM attendees WHERE event_id = $1', [e.id]
      )
      const ids = att.map(r => r.user_id)
      if (ids.length > 0) {
        await notifyMany(ids, 'reminder_1h', 'Starting soon',
          `"${e.title}" starts in 1 hour — get ready!`, e.id)
      }
    }
    console.log(`⏰ 1h reminders sent for ${events.length} event(s)`)
  } catch (err) { console.error('1h reminder error:', err.message) }
}

async function sendDayBeforeReminders() {
  try {
    const from = new Date(Date.now() + 23.5 * 3_600_000)
    const to   = new Date(Date.now() + 24.5 * 3_600_000)
    const { rows: events } = await query(
      `SELECT id, title FROM events WHERE start_time BETWEEN $1 AND $2`, [from, to]
    )
    for (const e of events) {
      const { rows: att } = await query(
        'SELECT user_id FROM attendees WHERE event_id = $1', [e.id]
      )
      const ids = att.map(r => r.user_id)
      if (ids.length > 0) {
        await notifyMany(ids, 'reminder_24h', 'Tomorrow',
          `"${e.title}" is tomorrow — don't miss it!`, e.id)
      }
    }
    console.log(`📅 24h reminders sent for ${events.length} event(s)`)
  } catch (err) { console.error('24h reminder error:', err.message) }
}

module.exports = {
  notify,
  notifyMany,
  notifyOrganizerJoin,
  notifyOrganizerLeave,
  notifyAttendeesCancel,
  notifyAttendeesUpdate,
  notifyOrganizerComment,
  sendOneHourReminders,
  sendDayBeforeReminders,
}
