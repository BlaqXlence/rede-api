/**
 * upload.js - handles both base64 and multipart/form-data
 * POST /upload
 */
const router  = require('express').Router()
const { requireAuth } = require('../middleware/auth')
const multer  = require('multer')
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

async function uploadToCloudinary(data) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey    = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) return null

  const cloudinary = require('cloudinary').v2
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret })

  const result = await cloudinary.uploader.upload(data, {
    folder: 'rede/events',
    transformation: [
      { width: 1200, height: 800, crop: 'limit' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  })
  return result.secure_url
}

// Multipart upload (native mobile)
router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  try {
    // Multipart file upload
    if (req.file) {
      const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
      const url = await uploadToCloudinary(b64)
      if (url) return res.json({ url, cloudinary: true })
      return res.json({ url: b64, cloudinary: false })
    }

    // Base64 upload (web)
    const { image } = req.body
    if (image) {
      const url = await uploadToCloudinary(image)
      if (url) return res.json({ url, cloudinary: true })
      return res.json({ url: image, cloudinary: false })
    }

    res.status(400).json({ message: 'No image provided' })
  } catch (err) {
    console.error('Upload error:', err.message)
    // Return whatever we have as fallback
    const fallback = req.file
      ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
      : req.body?.image || null
    if (fallback) return res.json({ url: fallback, cloudinary: false })
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
