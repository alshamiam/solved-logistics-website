const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjcGFhbm1tZGVoc25reG1uZHF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTQxMzEsImV4cCI6MjA4ODk5MDEzMX0.pGpGeFMF3bRHNbVfBFYzgaJzMNn3n4mJXFnf-NVSJ2U';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/solved_site_content?select=key,en,ar&key=neq._admin_password`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    });
    const rows = await r.json();
    const content = { en: {}, ar: {} };
    for (const row of rows) {
      content.en[row.key] = row.en;
      content.ar[row.key] = row.ar;
    }
    res.json(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
