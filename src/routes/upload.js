/**
 * upload.js
 * Cloudinary image upload endpoint
 * POST /upload — accepts base64 image, returns Cloudinary URL
 */
const router  = require('express').Router()
const { requireAuth } = require('../middleware/auth')

router.post('/', requireAuth, async (req, res) => {
  const { image, folder = 'rede/events' } = req.body

  if (!image) return res.status(400).json({ message: 'No image provided' })

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey    = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    // Cloudinary not configured — return the base64 as-is
    // This works but is slower and has DB size limits
    console.warn('Cloudinary not configured — returning base64 as-is')
    return res.json({ url: image, cloudinary: false })
  }

  try {
    const cloudinary = require('cloudinary').v2
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret })

    const result = await cloudinary.uploader.upload(image, {
      folder,
      transformation: [
        { width: 800, height: 600, crop: 'limit' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    })

    res.json({ url: result.secure_url, cloudinary: true })
  } catch (err) {
    console.error('Cloudinary upload error:', err.message)
    // Fall back to base64 if Cloudinary fails
    res.json({ url: image, cloudinary: false })
  }
})

module.exports = router
