const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hello@solved-logistics.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, company, email, phone, service, message, lang } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  // 1. Save to Supabase
  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/solved_leads`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ name, company, email, phone, service, message, lang: lang || 'en' })
  });

  if (!dbRes.ok) {
    return res.status(500).json({ error: 'Failed to save submission' });
  }

  // 2. Send email notification via Resend (if key configured)
  if (RESEND_KEY) {
    const emailBody = `
<div style="font-family: monospace; max-width: 600px; margin: 0 auto; padding: 32px; background: #F3EDE1; color: #181000;">
  <h2 style="font-family: sans-serif; font-weight: 900; color: #D04F00; margin: 0 0 24px;">New Lead — SOLVED Logistics</h2>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 8px 0; color: #888; width: 120px;">Name</td><td style="padding: 8px 0; font-weight: bold;">${name}</td></tr>
    ${company ? `<tr><td style="padding: 8px 0; color: #888;">Company</td><td style="padding: 8px 0;">${company}</td></tr>` : ''}
    <tr><td style="padding: 8px 0; color: #888;">Email</td><td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #D04F00;">${email}</a></td></tr>
    ${phone ? `<tr><td style="padding: 8px 0; color: #888;">Phone</td><td style="padding: 8px 0;">${phone}</td></tr>` : ''}
    ${service ? `<tr><td style="padding: 8px 0; color: #888;">Service</td><td style="padding: 8px 0;">${service}</td></tr>` : ''}
  </table>
  ${message ? `<div style="margin-top: 24px; padding: 16px; background: #fff; border-left: 3px solid #D04F00;"><strong>Message:</strong><br><br>${message}</div>` : ''}
  <p style="margin-top: 32px; font-size: 11px; color: #888;">Submitted via solved-logistics.com • ${new Date().toLocaleString('en-KW', { timeZone: 'Asia/Kuwait' })} (KWT)</p>
</div>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SOLVED Logistics <onboarding@resend.dev>',
        to: [NOTIFY_EMAIL],
        subject: `New enquiry from ${name}${company ? ` — ${company}` : ''}`,
        html: emailBody,
      })
    });
  }

  return res.json({ success: true });
};
