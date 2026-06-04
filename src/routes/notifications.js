/**
 * OneSignal push notification service — backend
 * Uses OneSignal REST API v1
 * Falls back gracefully if keys not set
 */
const { query } = require('../db')

const ONESIGNAL_APP_ID  = process.env.ONE_SIGNAL_APP_ID
const ONESIGNAL_API_KEY = process.env.ONE_SIGNAL_REST_API_KEY
const ONESIGNAL_URL     = 'https://onesignal.com/api/v1/notifications'

// ── Send push via OneSignal ────────────────────────────────────
async function sendPush(playerIds, title, body, data = {}) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    console.log('OneSignal keys not set — skipping push')
    return
  }
  if (!playerIds || playerIds.length === 0) return

  try {
    const res = await fetch(ONESIGNAL_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify({
        app_id:             ONESIGNAL_APP_ID,
        include_player_ids: playerIds,
        headings:           { en: title },
        contents:           { en: body },
        data,
        android_channel_id: 'rede',
        android_accent_color: 'FFFF6600',
        small_icon:           'ic_stat_onesignal_default',
        priority:             10,
      }),
    })

    const json = await res.json()
    if (json.errors?.length) {
      console.error('OneSignal errors:', json.errors)
    } else {
      console.log(`📲 Push sent to ${json.recipients || 0} device(s) — "${title}"`)
    }
  } catch (err) {
    console.error('Push send failed:', err.message)
  }
}

// ── Get player IDs for users ────────────────────────────────────
async function getPlayerIds(userIds) {
  if (!userIds?.length) return []
  try {
    const ph = userIds.map((_, i) => `$${i + 1}`).join(',')
    const { rows } = await query(
      `SELECT push_token FROM users WHERE id IN (${ph}) AND push_token IS NOT NULL`,
      userIds
    )
    return rows.map(r => r.push_token).filter(Boolean)
  } catch { return [] }
}

// ── Store in DB + push ──────────────────────────────────────────
async function notify(userId, type, title, body, eventId = null) {
  try {
    await query(
      `INSERT INTO notifications (user_id, type, title, body, event_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, body, eventId]
    )
    const ids = await getPlayerIds([userId])
    if (ids.length) await sendPush(ids, title, body, { type, eventId })
  } catch (err) {
    console.error('notify() error:', err.message)
  }
}

async function notifyMany(userIds, type, title, body, eventId = null) {
  if (!userIds?.length) return
  try {
    // Bulk insert
    const ph     = userIds.map((_, i) => `($${i*5+1},$${i*5+2},$${i*5+3},$${i*5+4},$${i*5+5})`).join(',')
    const params = userIds.flatMap(id => [id, type, title, body, eventId])
    await query(`INSERT INTO notifications (user_id,type,title,body,event_id) VALUES ${ph}`, params)

    // Single push call for all users
    const ids = await getPlayerIds(userIds)
    if (ids.length) await sendPush(ids, title, body, { type, eventId })
  } catch (err) {
    console.error('notifyMany() error:', err.message)
  }
}

// ── Event triggers ──────────────────────────────────────────────
async function notifyOrganizerJoin(eventId, joinerName) {
  try {
    const { rows } = await query('SELECT organizer_id, title FROM events WHERE id = $1', [eventId])
    if (!rows[0]) return
    await notify(rows[0].organizer_id, 'join',
      'New attendee',
      `${joinerName || 'Someone'} is going to "${rows[0].title}"`,
      eventId)
  } catch {}
}

async function notifyOrganizerLeave(eventId, leaverName) {
  try {
    const { rows } = await query('SELECT organizer_id, title FROM events WHERE id = $1', [eventId])
    if (!rows[0]) return
    await notify(rows[0].organizer_id, 'leave',
      'Attendee left',
      `${leaverName || 'Someone'} left "${rows[0].title}"`,
      eventId)
  } catch {}
}

async function notifyAttendeesCancel(eventId, eventTitle) {
  try {
    const { rows } = await query('SELECT user_id FROM attendees WHERE event_id = $1', [eventId])
    const ids = rows.map(r => r.user_id)
    if (!ids.length) return
    await notifyMany(ids, 'cancel', 'Event cancelled',
      `"${eventTitle}" has been cancelled by the organiser`, eventId)
  } catch {}
}

async function notifyAttendeesUpdate(eventId, eventTitle, change) {
  try {
    const { rows } = await query('SELECT user_id FROM attendees WHERE event_id = $1', [eventId])
    const ids = rows.map(r => r.user_id)
    if (!ids.length) return
    await notifyMany(ids, 'update', 'Event updated',
      `${change || 'Details changed'} for "${eventTitle}"`, eventId)
  } catch {}
}

async function notifyOrganizerComment(eventId, commenterName) {
  try {
    const { rows } = await query('SELECT organizer_id, title FROM events WHERE id = $1', [eventId])
    if (!rows[0]) return
    await notify(rows[0].organizer_id, 'comment',
      'New comment',
      `${commenterName || 'Someone'} commented on "${rows[0].title}"`,
      eventId)
  } catch {}
}

async function sendOneHourReminders() {
  try {
    const from = new Date(Date.now() + 55 * 60_000)
    const to   = new Date(Date.now() + 65 * 60_000)
    const { rows: events } = await query(
      'SELECT id, title FROM events WHERE start_time BETWEEN $1 AND $2', [from, to]
    )
    for (const e of events) {
      const { rows: att } = await query('SELECT user_id FROM attendees WHERE event_id = $1', [e.id])
      const ids = att.map(r => r.user_id)
      if (ids.length) await notifyMany(ids, 'reminder_1h',
        'Starting soon', `"${e.title}" starts in 1 hour`, e.id)
    }
    if (events.length) console.log(`⏰ 1h reminders: ${events.length} event(s)`)
  } catch (err) { console.error('1h reminders error:', err.message) }
}

async function sendDayBeforeReminders() {
  try {
    const from = new Date(Date.now() + 23.5 * 3_600_000)
    const to   = new Date(Date.now() + 24.5 * 3_600_000)
    const { rows: events } = await query(
      'SELECT id, title FROM events WHERE start_time BETWEEN $1 AND $2', [from, to]
    )
    for (const e of events) {
      const { rows: att } = await query('SELECT user_id FROM attendees WHERE event_id = $1', [e.id])
      const ids = att.map(r => r.user_id)
      if (ids.length) await notifyMany(ids, 'reminder_24h',
        'Tomorrow', `"${e.title}" is tomorrow — don't miss it!`, e.id)
    }
    if (events.length) console.log(`📅 24h reminders: ${events.length} event(s)`)
  } catch (err) { console.error('24h reminders error:', err.message) }
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
