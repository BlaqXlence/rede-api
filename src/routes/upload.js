const router  = require('express').Router()
const { requireAuth } = require('../middleware/auth')
const multer  = require('multer')
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

async function uploadToCloudinary(data) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey    = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    console.log('Cloudinary not configured - missing env vars')
    return null
  }

  let cloudinary
  try {
    cloudinary = require('cloudinary').v2
  } catch {
    console.error('cloudinary package not installed - run: npm install cloudinary')
    return null
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret })

  const result = await cloudinary.uploader.upload(data, {
    folder: 'rede',
    transformation: [
      { width: 1200, height: 800, crop: 'limit' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  })
  return result.secure_url
}

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  try {
    let dataToUpload = null

    if (req.file) {
      // Native mobile - multipart form
      dataToUpload = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
    } else if (req.body?.image) {
      // Web - base64 string
      dataToUpload = req.body.image
    } else {
      return res.status(400).json({ message: 'No image provided' })
    }

    const url = await uploadToCloudinary(dataToUpload)

    if (url) {
      console.log('Upload success - Cloudinary URL:', url.substring(0, 60))
      return res.json({ url, cloudinary: true })
    }

    // Cloudinary failed - return base64 as fallback (works in browser, not on mobile)
    console.log('Cloudinary unavailable - returning base64 fallback')
    return res.json({ url: dataToUpload, cloudinary: false })

  } catch (err) {
    const msg = err?.message || err?.error?.message || String(err) || 'Unknown upload error'
    console.error('Upload error:', msg)
    const fallback = req.file
      ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
      : req.body?.image || null
    if (fallback) return res.json({ url: fallback, cloudinary: false })
    res.status(500).json({ message: msg })
  }
})

module.exports = router
