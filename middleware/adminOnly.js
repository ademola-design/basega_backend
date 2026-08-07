/**
 * Must be used AFTER the auth middleware.
 * Rejects any request where the logged-in user is not an admin.
 */
module.exports = function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin only.' })
  }
  next()
}
