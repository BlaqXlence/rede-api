require('dotenv').config()
const express = require('express')
const cors    = require('cors')

const authRoutes     = require('./routes/auth')
const eventsRoutes   = require('./routes/events')
const reviewsRoutes  = require('./routes/reviews')
const commentsRoutes = require('./routes/comments')
const searchRoutes   = require('./routes/search')
const uploadRoutes   = require('./routes/upload')

const app = express()

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true)
    if (origin.startsWith('http://localhost:')) return callback(null, true)
    const allowed = ['https://rede-app.netlify.app']
    if (allowed.includes(origin)) return callback(null, true)
    console.warn('CORS blocked:', origin)
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.options('*', cors())
app.use(express.json({ limit: '20mb' })) // 20mb for base64 images

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'REDE API', timestamp: new Date().toISOString() })
})

app.use('/api/v1/auth',                  authRoutes)
app.use('/api/v1/events',                eventsRoutes)
app.use('/api/v1/events/:id/reviews',    reviewsRoutes)
app.use('/api/v1/events/:id/comments',   commentsRoutes)
app.use('/api/v1/search',                searchRoutes)
app.use('/api/v1/upload',                uploadRoutes)

app.use((req, res) => {
  res.status(404).json({ message: `${req.method} ${req.path} not found` })
})

app.use((err, req, res, next) => {
  console.error('Server error:', err.message)
  res.status(500).json({ message: 'Internal server error' })
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`\n🚀 REDE API on port ${PORT}`)
  console.log(`📦 Env: ${process.env.NODE_ENV}`)
  console.log(`📱 AT SMS: ${process.env.AT_USERNAME ? 'configured' : 'dev mode (console log)'}`)
  console.log(`☁️  Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? 'configured' : 'not configured'}`)
  console.log(`🔔 Push: ${process.env.ONE_SIGNAL_APP_ID ? 'configured' : 'not configured'}\n`)
})
