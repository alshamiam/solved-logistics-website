// POST /api/contact — website contact / quote form.
//
// 1. Saves the enquiry in solved_leads (the website admin's Leads tab).
// 2. Opens a ticket in Beyond (the same Supabase database) so the team works
//    it in Cases, with staff notified through the ticket watchers.
// 3. Emails the team (NOTIFY_EMAIL) and sends the customer a confirmation
//    with their ticket number, in the language they used on the site.
//
// Email goes through the Resend API (RESEND_API_KEY). SMTP is a fallback for
// the team notification only. The old GoDaddy SMTP login failed (535) because
// the mailbox lives in Microsoft 365.

const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SMTP_USER    = process.env.SMTP_USER;
const SMTP_PASS    = process.env.SMTP_PASS;
const SMTP_HOST    = process.env.SMTP_HOST || 'smtp.office365.com';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hello@solved-logistics.com';
const RESEND_KEY   = process.env.RESEND_API_KEY;
const MAIL_FROM    = process.env.MAIL_FROM || 'Solved Logistics <hello@solved-logistics.com>';
const REPLY_TO     = process.env.REPLY_TO || 'hello@solved-logistics.com';
const WHATSAPP     = '+965 2209 9120';
const WA_LINK      = 'https://wa.me/96522099120';

// Staff roles that watch website-enquiry tickets (and so get an inbox
// notification for each one). Override with WEBSITE_TICKET_WATCHERS, a
// comma-separated list of user ids.
const WATCH_ROLES = ['admin', 'super_admin', 'operations'];

const nodemailer = require('nodemailer');

const esc = v => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const oneLine = v => String(v).replace(/[\r\n]+/g, ' ');

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function watcherIds() {
  const fixed = (process.env.WEBSITE_TICKET_WATCHERS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (fixed.length) return fixed;
  const r = await sb(`user_profiles?select=id&active=is.true&role=in.(${WATCH_ROLES.join(',')})`);
  if (!r.ok) return [];
  return (await r.json()).map(u => u.id);
}

// The ad visit this form came from, if any (set by js/track.js → /api/track).
async function adSession(key) {
  if (!/^[a-z0-9-]{16,64}$/i.test(String(key || ''))) return null;
  const r = await sb(`utm_sessions?session_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
  if (!r.ok) return null;
  return (await r.json())[0] || null;
}

function sourceLine(s) {
  if (!s) return null;
  const parts = ['Google Ads'];
  if (s.utm_term) parts.push(`keyword: ${s.utm_term}`);
  if (s.utm_campaign) parts.push(`campaign: ${s.utm_campaign}`);
  if (s.landing_page) parts.push(`landed on: ${s.landing_page.split('?')[0]}`);
  if (s.ref_code) parts.push(`ref: ${s.ref_code}`);
  return `Source: ${parts.join(' · ')}`;
}

async function createTicket(lead, session) {
  const lines = [
    'Enquiry from the solved-logistics.com contact form.',
    '',
    `Name: ${lead.name}`,
    lead.company && `Company: ${lead.company}`,
    `Email: ${lead.email}`,
    lead.phone && `Phone: ${lead.phone}`,
    lead.service && `Service: ${lead.service}`,
    `Language: ${lead.lang === 'ar' ? 'Arabic' : 'English'}`,
    sourceLine(session),
    '',
    'Message:',
    lead.message || '(none)',
  ].filter(l => l !== undefined && l !== null && l !== false);
  const r = await sb('tickets', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      title: oneLine(`Website enquiry: ${lead.name}${lead.service ? ` · ${lead.service}` : ''}`).slice(0, 200),
      description: lines.join('\n'),
      type: 'website_enquiry',
      priority: 'medium',
      status: 'open',
      tags: ['website', lead.lang === 'ar' ? 'arabic' : 'english', ...(session ? ['google-ads'] : [])],
      watchers: await watcherIds(),
    }),
  });
  if (!r.ok) throw new Error(`ticket insert ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const [t] = await r.json();
  await sb('ticket_activity', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ticket_id: t.id, actor_name: 'Website', action: 'created', detail: 'From the solved-logistics.com contact form' }),
  }).catch(() => {});
  return t;
}

async function sendResend({ to, subject, html, replyTo }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, html, reply_to: replyTo }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

async function notifyTeam({ subject, html, replyTo }) {
  if (RESEND_KEY) {
    try {
      await sendResend({ to: NOTIFY_EMAIL.split(',').map(s => s.trim()).filter(Boolean), subject, html, replyTo });
      return true;
    } catch (e) { console.error('Resend (team) error:', e.message); }
  }
  if (SMTP_USER && SMTP_PASS) {
    try {
      const tr = nodemailer.createTransport({ host: SMTP_HOST, port: 587, secure: false, requireTLS: true, auth: { user: SMTP_USER, pass: SMTP_PASS } });
      await tr.sendMail({ from: `Solved Logistics <${SMTP_USER}>`, to: NOTIFY_EMAIL, replyTo, subject, html });
      return true;
    } catch (e) { console.error('SMTP (team) error:', e.message); }
  }
  return false;
}

function teamEmail(lead, ticketNo) {
  const row = (k, v) => v ? `<tr><td style="padding:8px 0;color:#888;width:120px">${k}</td><td style="padding:8px 0">${v}</td></tr>` : '';
  return `
<div style="font-family:monospace;max-width:600px;margin:0 auto;padding:32px;background:#F3EDE1;color:#181000">
  <h2 style="font-family:sans-serif;font-weight:900;color:#D04F00;margin:0 0 8px">New website enquiry</h2>
  ${ticketNo ? `<p style="margin:0 0 24px;color:#555">Ticket <b>${esc(ticketNo)}</b> is open in Beyond → Cases.</p>` : '<p style="margin:0 0 24px;color:#b00">No ticket was created. Check the server logs.</p>'}
  <table style="width:100%;border-collapse:collapse">
    ${row('Name', `<b>${esc(lead.name)}</b>`)}
    ${row('Company', esc(lead.company))}
    ${row('Email', `<a href="mailto:${esc(lead.email)}" style="color:#D04F00">${esc(lead.email)}</a>`)}
    ${row('Phone', esc(lead.phone))}
    ${row('Service', esc(lead.service))}
    ${row('Language', lead.lang === 'ar' ? 'Arabic' : 'English')}
  </table>
  ${lead.message ? `<div style="margin-top:24px;padding:16px;background:#fff;border-left:3px solid #D04F00;white-space:pre-wrap"><strong>Message:</strong><br><br>${esc(lead.message)}</div>` : ''}
  <p style="margin-top:32px;font-size:11px;color:#888">Submitted via solved-logistics.com · ${new Date().toLocaleString('en-KW', { timeZone: 'Asia/Kuwait', dateStyle: 'medium', timeStyle: 'short' })} KWT</p>
</div>`;
}

function customerEmail(lead, ticketNo) {
  const ar = lead.lang === 'ar';
  const ref = ticketNo ? esc(ticketNo) : '';
  const t = ar ? {
    subject: `استلمنا طلبك${ref ? ` — ${ticketNo}` : ''} | Solved Logistics`,
    hi: `مرحباً ${esc(lead.name)}،`,
    p1: 'شكراً لتواصلك مع Solved Logistics. استلمنا طلبك وسيتواصل معك فريقنا خلال يوم عمل واحد بالخيارات والأسعار.',
    refLabel: 'رقم الطلب',
    summary: 'ملخص طلبك',
    service: 'الخدمة', msg: 'رسالتك',
    wa: 'تحتاج رداً أسرع؟ راسلنا على واتساب',
    hours: 'ساعات العمل: السبت – الخميس، ٩ صباحاً – ٦ مساءً',
    sign: 'فريق Solved Logistics',
    dir: 'rtl',
  } : {
    subject: `We received your enquiry${ref ? ` — ${ticketNo}` : ''} | Solved Logistics`,
    hi: `Hi ${esc(lead.name)},`,
    p1: 'Thanks for contacting Solved Logistics. We have your enquiry and our team will get back to you within one business day with options and pricing.',
    refLabel: 'Your reference',
    summary: 'Your enquiry',
    service: 'Service', msg: 'Message',
    wa: 'Need a faster answer? Message us on WhatsApp',
    hours: 'Hours: Saturday – Thursday, 9 am – 6 pm (Kuwait)',
    sign: 'The Solved Logistics team',
    dir: 'ltr',
  };
  const html = `
<div dir="${t.dir}" style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#FBF8F2;color:#181000;line-height:1.6">
  <div style="font-weight:900;font-size:22px;letter-spacing:-0.5px;margin-bottom:24px" dir="ltr">SOLVE<span style="color:#D04F00">D</span></div>
  <p style="margin:0 0 12px">${t.hi}</p>
  <p style="margin:0 0 20px">${t.p1}</p>
  ${ref ? `<div style="background:#fff;border:1px solid #eadfcc;border-radius:10px;padding:14px 18px;margin:0 0 20px"><span style="color:#888;font-size:13px">${t.refLabel}</span><br><b style="font-size:18px" dir="ltr">${ref}</b></div>` : ''}
  <p style="margin:0 0 6px;font-weight:bold">${t.summary}</p>
  <p style="margin:0 0 20px;color:#444">${lead.service ? `${t.service}: ${esc(lead.service)}<br>` : ''}${lead.message ? `${t.msg}: <span style="white-space:pre-wrap">${esc(lead.message)}</span>` : ''}</p>
  <p style="margin:0 0 24px"><a href="${WA_LINK}" style="display:inline-block;background:#D04F00;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">${t.wa}</a><br><span style="color:#888;font-size:13px" dir="ltr">${WHATSAPP}</span></p>
  <p style="margin:0;color:#888;font-size:13px">${t.hours}</p>
  <p style="margin:16px 0 0">${t.sign}<br><a href="https://www.solved-logistics.com" style="color:#D04F00">solved-logistics.com</a></p>
</div>`;
  return { subject: oneLine(t.subject), html };
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b = req.body || {};
  // Hidden "website" field: humans never fill it, bots usually do. Pretend success.
  if (b.website) return res.json({ success: true });

  const lead = {
    name: clip(b.name, 120), company: clip(b.company, 120), email: clip(b.email, 160),
    phone: clip(b.phone, 40), service: clip(b.service, 80), message: clip(b.message, 4000),
    lang: b.lang === 'ar' ? 'ar' : 'en',
  };
  if (!lead.name || !lead.email) return res.status(400).json({ error: 'Name and email required' });
  if (!EMAIL_RE.test(lead.email)) return res.status(400).json({ error: 'Invalid email' });

  // 1. Save the lead (the record of truth for the website admin).
  const saved = await sb('solved_leads', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(lead) })
    .catch(e => ({ ok: false, status: 0, text: async () => e.message }));
  if (!saved.ok) console.error('Lead NOT saved to Supabase:', saved.status, (await saved.text()).slice(0, 300));

  // 2. Ticket in Beyond.
  const session = await adSession(b.attr_key).catch(() => null);
  let ticket = null;
  try { ticket = await createTicket(lead, session); }
  catch (e) { console.error('Ticket NOT created:', e.message); }
  const ticketNo = ticket?.ticket_no || null;

  // Record the lead against the ad visit so Marketing can count it.
  if (session) {
    await sb('marketing_conversions', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        session_id: session.id, event_type: 'form_submit', ticket_id: ticket?.id || null,
        ref_code: session.ref_code, gclid: session.gclid, phone: lead.phone || null,
        utm_source: session.utm_source, utm_medium: session.utm_medium, utm_campaign: session.utm_campaign,
        utm_term: session.utm_term, landing_page: session.landing_page,
      }),
    }).catch(e => console.error('conversion insert', e.message));
    await sb(`utm_sessions?id=eq.${encodeURIComponent(session.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ converted: true, converted_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  // 3. Emails: team notification, then the customer's confirmation.
  const teamSent = await notifyTeam({
    subject: oneLine(`New enquiry${ticketNo ? ` ${ticketNo}` : ''} — ${lead.name}${lead.company ? ` (${lead.company})` : ''}`),
    html: teamEmail(lead, ticketNo),
    replyTo: lead.email,
  });
  if (!teamSent) console.error('Lead saved but NO team email was sent (configure RESEND_API_KEY).');

  let customerSent = false;
  if (RESEND_KEY) {
    try {
      const m = customerEmail(lead, ticketNo);
      await sendResend({ to: [lead.email], subject: m.subject, html: m.html, replyTo: REPLY_TO });
      customerSent = true;
    } catch (e) { console.error('Resend (customer) error:', e.message); }
  }

  if (ticket) {
    await sb('ticket_activity', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        ticket_id: ticket.id, actor_name: 'Website', action: 'commented',
        detail: customerSent ? `Confirmation email sent to ${lead.email}` : 'No confirmation email was sent to the customer',
      }),
    }).catch(() => {});
  }

  return res.json({ success: true, ticket_no: ticketNo });
};

module.exports._test = { customerEmail, teamEmail, EMAIL_RE };
