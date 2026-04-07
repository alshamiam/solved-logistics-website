const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASSWORD = 'solved2026';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, updates } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (!updates || updates.length === 0) return res.json({ saved: 0 });

  const errors = [];
  for (const u of updates) {
    if (!u.key || u.key.startsWith('_')) continue;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/solved_site_content?key=eq.${encodeURIComponent(u.key)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ en: u.en ?? '', ar: u.ar ?? '', updated_at: new Date().toISOString() })
    });
    if (!r.ok) errors.push(u.key);
  }

  if (errors.length) return res.status(207).json({ saved: updates.length - errors.length, errors });
  return res.json({ saved: updates.length });
};
