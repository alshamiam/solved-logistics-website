const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SMTP_USER    = process.env.SMTP_USER;
const SMTP_PASS    = process.env.SMTP_PASS;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hello@solved-logistics.com';

const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, company, email, phone, service, message, lang } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  // 1. Save to Supabase
  await fetch(`${SUPABASE_URL}/rest/v1/solved_leads`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ name, company, email, phone, service, message, lang: lang || 'en' })
  });

  // 2. Send email via GoDaddy SMTP
  if (SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtpout.secureserver.net',
        port: 465,
        secure: true,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });

      await transporter.sendMail({
        from: `SOLVED Logistics <${SMTP_USER}>`,
        to: NOTIFY_EMAIL,
        replyTo: email,
        subject: `New enquiry — ${name}${company ? ` (${company})` : ''}`,
        html: `
<div style="font-family:monospace;max-width:600px;margin:0 auto;padding:32px;background:#F3EDE1;color:#181000">
  <h2 style="font-family:sans-serif;font-weight:900;color:#D04F00;margin:0 0 24px">New Lead — SOLVED Logistics</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px 0;color:#888;width:120px">Name</td><td style="padding:8px 0;font-weight:bold">${name}</td></tr>
    ${company ? `<tr><td style="padding:8px 0;color:#888">Company</td><td style="padding:8px 0">${company}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${email}" style="color:#D04F00">${email}</a></td></tr>
    ${phone ? `<tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0">${phone}</td></tr>` : ''}
    ${service ? `<tr><td style="padding:8px 0;color:#888">Service</td><td style="padding:8px 0">${service}</td></tr>` : ''}
  </table>
  ${message ? `<div style="margin-top:24px;padding:16px;background:#fff;border-left:3px solid #D04F00"><strong>Message:</strong><br><br>${message}</div>` : ''}
  <p style="margin-top:32px;font-size:11px;color:#888">
    Submitted via solved-logistics.com &nbsp;•&nbsp; 
    ${new Date().toLocaleString('en-KW', { timeZone: 'Asia/Kuwait', dateStyle: 'medium', timeStyle: 'short' })} KWT
  </p>
</div>`,
      });
    } catch (e) {
      console.error('SMTP error:', e.message);
      // Don't fail the request if email fails — lead is already saved
    }
  }

  return res.json({ success: true });
};
