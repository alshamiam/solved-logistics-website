// POST /api/leads  { password }  → latest contact-form leads for the admin page.
// solved_leads has RLS with insert-only for the public, so the browser can't
// read it with the anon key; this endpoint reads with the service key after
// checking the admin password.
const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const { checkAdminPassword } = require('./_admin');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password } = req.body || {};
  if (!checkAdminPassword(password)) return res.status(401).json({ error: 'Wrong password' });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/solved_leads?select=*&order=submitted_at.desc&limit=500`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) {
    console.error('leads read failed', r.status, (await r.text()).slice(0, 300));
    return res.status(500).json({ error: 'Could not load leads' });
  }
  return res.json(await r.json());
};
