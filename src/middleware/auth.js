const jwt = require('jsonwebtoken')
const { query } = require('../db')

async function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' })
  }

  const token = header.split(' ')[1]
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.userId])
    if (!rows[0]) return res.status(401).json({ message: 'User not found' })
    req.user = rows[0]
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '365d' })
}

module.exports = { requireAuth, signToken }
