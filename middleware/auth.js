const jwt = require('jsonwebtoken')

/**
 * Verifies the JWT token from the Authorization header.
 * Attaches the decoded payload to req.user on success.
 */
module.exports = function auth(req, res, next) {
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Please log in.' })
  }

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded   // { id, email, role, status }
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' })
  }
}
