const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SMTP_USER    = process.env.SMTP_USER;
const SMTP_PASS    = process.env.SMTP_PASS;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hello@solved-logistics.com';
const RESEND_KEY   = process.env.RESEND_API_KEY;
const MAIL_FROM    = process.env.MAIL_FROM || 'Solved Logistics Website <website@solved-logistics.com>';
const SMTP_HOST    = process.env.SMTP_HOST || 'smtp.office365.com';

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
  const saved = await fetch(`${SUPABASE_URL}/rest/v1/solved_leads`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ name, company, email, phone, service, message, lang: lang || 'en' })
  }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
  if (!saved.ok) console.error('Lead NOT saved to Supabase:', saved.status, (await saved.text()).slice(0, 300));

  // 2. Email notification.
  // Preferred: Resend HTTP API (RESEND_API_KEY). The old GoDaddy SMTP login
  // fails (535) because the mailbox lives in Microsoft 365, not GoDaddy mail.
  // SMTP stays as a fallback if its env vars are set.
  const esc = v => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const subject = `New enquiry — ${name}${company ? ` (${company})` : ''}`.replace(/[\r\n]+/g, ' ');
  const html = `
<div style="font-family:monospace;max-width:600px;margin:0 auto;padding:32px;background:#F3EDE1;color:#181000">
  <h2 style="font-family:sans-serif;font-weight:900;color:#D04F00;margin:0 0 24px">New Lead — Solved Logistics</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px 0;color:#888;width:120px">Name</td><td style="padding:8px 0;font-weight:bold">${esc(name)}</td></tr>
    ${company ? `<tr><td style="padding:8px 0;color:#888">Company</td><td style="padding:8px 0">${esc(company)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${esc(email)}" style="color:#D04F00">${esc(email)}</a></td></tr>
    ${phone ? `<tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0">${esc(phone)}</td></tr>` : ''}
    ${service ? `<tr><td style="padding:8px 0;color:#888">Service</td><td style="padding:8px 0">${esc(service)}</td></tr>` : ''}
  </table>
  ${message ? `<div style="margin-top:24px;padding:16px;background:#fff;border-left:3px solid #D04F00;white-space:pre-wrap"><strong>Message:</strong><br><br>${esc(message)}</div>` : ''}
  <p style="margin-top:32px;font-size:11px;color:#888">
    Submitted via solved-logistics.com &nbsp;•&nbsp;
    ${new Date().toLocaleString('en-KW', { timeZone: 'Asia/Kuwait', dateStyle: 'medium', timeStyle: 'short' })} KWT
  </p>
</div>`;

  let sent = false;
  if (RESEND_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: NOTIFY_EMAIL.split(',').map(s => s.trim()).filter(Boolean),
          reply_to: email,
          subject, html,
        }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
      sent = true;
    } catch (e) {
      console.error('Resend error:', e.message);
    }
  }
  if (!sent && SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST, port: 587, secure: false, requireTLS: true,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transporter.sendMail({ from: `Solved Logistics <${SMTP_USER}>`, to: NOTIFY_EMAIL, replyTo: email, subject, html });
      sent = true;
    } catch (e) {
      console.error('SMTP error:', e.message);
    }
  }
  if (!sent) console.error('Lead saved but NO notification email was sent (configure RESEND_API_KEY).');

  return res.json({ success: true });
};
