// Admin password check shared by /api/save and /api/leads.
// Set ADMIN_PASSWORD in Vercel to change it; the fallback keeps the current
// password working until then.
const crypto = require('crypto');

function checkAdminPassword(given) {
  const expected = (process.env.ADMIN_PASSWORD || 'solved2026').trim();
  if (typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { checkAdminPassword };
