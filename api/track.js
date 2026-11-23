// POST /api/track — ad attribution for leads.
//
// Called by js/track.js in the browser:
//   { type: "session", key, gclid?, gbraid?, wbraid?, utm_source?, utm_medium?,
//     utm_campaign?, utm_term?, utm_content?, landing?, referrer? }
//       → records a visit that came from an ad; returns { ref } (e.g. "S-7K2QX"),
//         the short code added to WhatsApp messages so a chat can be traced
//         back to the ad.
//   { type: "whatsapp_click" | "call_click", key, page? }
//       → records a lead action against that visit.
//   { type: "consent", key, granted, oppref? }
//       → ChatGPT ads: the visitor's answer to "May we measure this visit?".
//         Stores utm_sessions.measurement_consent, and the OpenAI click id
//         (oppref) only when granted — a "No" clears it. The internal system
//         reports conversions to OpenAI only for granted visits.
//   A session may carry { oppref, consent: true } when the visitor already
//   allowed measurement on an earlier visit.
//
// Writes with the service key into utm_sessions / marketing_conversions (the
// internal system's Marketing screen reads them). Only ad visits are recorded,
// and every value is length-limited; nothing the browser sends is trusted for
// anything but its own visit.

const SUPABASE_URL = 'https://ccpaanmmdehsnkxmndqt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const KEY_RE = /^[a-z0-9-]{16,64}$/i;
const EVENTS = new Set(['whatsapp_click', 'call_click']);
const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I

const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

// Best-effort per-instance limiter: plenty for real visitors, stops a loop.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 60000, max = 30;
  const h = (hits.get(ip) || []).filter(t => now - t < win);
  h.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > max;
}

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

function newRef() {
  const b = require('crypto').randomBytes(5);
  return 'S-' + [...b].map(x => REF_ALPHABET[x % 32]).join('');
}

const isPaid = s => !!(s.oppref || s.gclid || s.gbraid || s.wbraid || /^(cpc|ppc|paid|paidsearch)$/i.test(s.utm_medium || ''));
// OpenAI's click id. Only accepted together with consent.
const cleanOppref = v => { const t = String(v || '').trim(); return /^[A-Za-z0-9._~:-]{1,256}$/.test(t) ? t : null; };

async function getSession(key) {
  const r = await sb(`utm_sessions?session_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
  if (!r.ok) return null;
  return (await r.json())[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  if (limited(ip)) return res.status(429).json({ ok: false });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const key = String(b.key || '');
  if (!KEY_RE.test(key)) return res.status(400).json({ ok: false });

  try {
    if (b.type === 'session') {
      const s = {
        session_key: key,
        gclid: clip(b.gclid, 200), gbraid: clip(b.gbraid, 200), wbraid: clip(b.wbraid, 200),
        utm_source: clip(b.utm_source, 80), utm_medium: clip(b.utm_medium, 80), utm_campaign: clip(b.utm_campaign, 120),
        utm_term: clip(b.utm_term, 160), utm_content: clip(b.utm_content, 160),
        landing_page: clip(b.landing, 300), referrer: clip(b.referrer, 300),
      };
      const oppref = b.consent === true ? cleanOppref(b.oppref) : null;
      if (oppref) { s.oppref = oppref; s.measurement_consent = true; }
      if (!isPaid(s)) return res.json({ ok: true, ref: null });
      const existing = await getSession(key);
      if (existing) return res.json({ ok: true, ref: existing.ref_code });
      for (let i = 0; i < 3; i++) {
        const row = { ...s, ref_code: newRef(), last_seen_at: new Date().toISOString() };
        const r = await sb('utm_sessions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
        if (r.ok) return res.json({ ok: true, ref: row.ref_code });
        const txt = await r.text();
        if (!/duplicate key/i.test(txt)) { console.error('track session insert', r.status, txt.slice(0, 200)); break; }
        const again = await getSession(key);            // same key raced in
        if (again) return res.json({ ok: true, ref: again.ref_code });
      }
      return res.status(500).json({ ok: false });
    }

    if (b.type === 'consent') {
      if (typeof b.granted !== 'boolean') return res.status(400).json({ ok: false });
      const oppref = b.granted ? cleanOppref(b.oppref) : null;
      if (b.granted && !oppref) return res.status(400).json({ ok: false });
      const s = await getSession(key);
      if (!s) return res.json({ ok: true, skipped: 'no ad visit' });
      const r = await sb(`utm_sessions?id=eq.${encodeURIComponent(s.id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ measurement_consent: b.granted, oppref, last_seen_at: new Date().toISOString() }),
      });
      if (!r.ok) { console.error('track consent update', r.status, (await r.text()).slice(0, 200)); return res.status(500).json({ ok: false }); }
      return res.json({ ok: true });
    }

    if (EVENTS.has(b.type)) {
      const s = await getSession(key);
      if (!s) return res.json({ ok: true, skipped: 'no ad visit' });
      // One per visit and type every 10 minutes: repeated taps are one lead.
      const since = new Date(Date.now() - 10 * 60000).toISOString();
      const dup = await sb(`marketing_conversions?session_id=eq.${encodeURIComponent(s.id)}&event_type=eq.${b.type}&created_at=gte.${since}&select=id&limit=1`);
      if (dup.ok && (await dup.json()).length) return res.json({ ok: true, deduped: true });
      const r = await sb('marketing_conversions', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          session_id: s.id, event_type: b.type, ref_code: s.ref_code, gclid: s.gclid,
          utm_source: s.utm_source, utm_medium: s.utm_medium, utm_campaign: s.utm_campaign, utm_term: s.utm_term,
          landing_page: clip(b.page, 300) || s.landing_page,
        }),
      });
      if (!r.ok) console.error('track event insert', r.status, (await r.text()).slice(0, 200));
      await sb(`utm_sessions?id=eq.${encodeURIComponent(s.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_seen_at: new Date().toISOString() }) });
      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false });
  } catch (e) {
    console.error('track error', e.message);
    return res.status(500).json({ ok: false });
  }
};

module.exports._test = { isPaid, newRef, KEY_RE, cleanOppref };
