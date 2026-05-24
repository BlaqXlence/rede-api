require('dotenv').config()
const express = require('express')
const cors = require('cors')

const authRoutes   = require('./routes/auth')
const eventsRoutes = require('./routes/events')

const app = express()

app.use(cors({
  origin: function (origin, callback) {
    const allowed = [
      'https://rede-app.netlify.app',
      'http://localhost:8081',
      'http://localhost:3000',
      'http://localhost:19006',
    ]
    if (!origin) return callback(null, true)
    if (allowed.includes(origin)) return callback(null, true)
    console.warn('Blocked by CORS:', origin)
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.options('*', cors())
app.use(express.json({ limit: '10mb' }))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'REDE API', timestamp: new Date().toISOString() })
})

app.use('/api/v1/auth',   authRoutes)
app.use('/api/v1/events', eventsRoutes)

app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found` })
})

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message)
  res.status(500).json({ message: 'Internal server error' })
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`\n🚀 REDE API running on port ${PORT}`)
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`🔗 Health: http://localhost:${PORT}/health\n`)
})
