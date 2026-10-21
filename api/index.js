import app from '../server/index.js'

export default function handler(req, res) {
  const routePath = req.query.path
  if (typeof routePath !== 'string' || !routePath.startsWith('/api/')) {
    return res.status(400).json({ message: 'Invalid API route.' })
  }
  req.url = routePath
  return app(req, res)
}
