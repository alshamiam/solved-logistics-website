const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjcGFhbm1tZGVoc25reG1uZHF0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzQxNDEzMSwiZXhwIjoyMDg4OTkwMTMxfQ.pNHOFDJ7kAXuvuXH3nIZl8yjTSNFBrGVxe0wJ5C3-6Q';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, updates } = req.body;

  // Verify password from DB
  const pwRes = await fetch(`${SUPABASE_URL}/rest/v1/solved_site_content?key=eq._admin_password&select=en`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  const pwRows = await pwRes.json();
  const correctPw = pwRows?.[0]?.en;
  if (!correctPw || password !== correctPw) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  // Apply updates — each update is { key, en, ar }
  const errors = [];
  for (const u of updates) {
    if (!u.key || u.key.startsWith('_')) continue;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/solved_site_content?key=eq.${u.key}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ en: u.en, ar: u.ar, updated_at: new Date().toISOString() })
    });
    if (!r.ok) errors.push(u.key);
  }

  if (errors.length) return res.status(207).json({ saved: updates.length - errors.length, errors });
  return res.json({ saved: updates.length });
}
