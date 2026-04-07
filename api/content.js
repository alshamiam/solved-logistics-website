const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/solved_site_content?select=key,en,ar,label,section&key=neq._admin_password&order=section,key`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    });
    const rows = await r.json();
    // Return two formats: flat content for website, full rows for admin
    const content = { en: {}, ar: {} };
    for (const row of rows) {
      content.en[row.key] = row.en;
      content.ar[row.key] = row.ar;
    }
    content._rows = rows; // admin needs label/section too
    res.json(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
