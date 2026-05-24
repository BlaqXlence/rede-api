require('dotenv').config()
const express = require('express')
const cors = require('cors')

const authRoutes   = require('./routes/auth')
const eventsRoutes = require('./routes/events')

const app = express()

// CORS — allow frontend (Netlify) to talk to this API
app.use(cors({
  origin: [
    'http://localhost:8081',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
}))

app.use(express.json({ limit: '10mb' }))

// Health check — Railway and Render ping this
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'REDE API', timestamp: new Date().toISOString() })
})

// Routes
app.use('/api/v1/auth',   authRoutes)
app.use('/api/v1/events', eventsRoutes)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found` })
})

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ message: 'Internal server error' })
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`\n🚀 REDE API running on port ${PORT}`)
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`🔗 Health check: http://localhost:${PORT}/health\n`)
})
