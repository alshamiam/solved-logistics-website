const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjcGFhbm1tZGVoc25reG1uZHF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTQxMzEsImV4cCI6MjA4ODk5MDEzMX0.pGpGeFMF3bRHNbVfBFYzgaJzMNn3n4mJXFnf-NVSJ2U';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, updates } = req.body || {};

  // Fetch password from DB
  const pwRes = await fetch(`${SUPABASE_URL}/rest/v1/solved_site_content?key=eq._admin_password&select=en`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const pwRows = await pwRes.json();
  const correctPw = pwRows?.[0]?.en;

  if (!correctPw || password !== correctPw) {
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
}
