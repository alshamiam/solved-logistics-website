/* Conversion tracking for Google Ads (and any tag in the Google tag container).
 *
 * Counts the actions that matter for SOLVED:
 *   - WhatsApp taps (any link to wa.me)       → event "whatsapp_click"
 *   - Phone taps (tel: links)                 → event "phone_click"
 *   - Email taps (mailto: links)              → event "email_click"
 *   - Quote form sent successfully            → event "generate_lead"
 *     (called from handleSubmit via window.solvedTrack)
 *
 * Visits from ads also get a reference code (see "Ad attribution" below) that
 * links WhatsApp chats, calls and form tickets back to the ad and keyword.
 *
 * Google Ads conversion actions: once they exist in the account, paste each
 * one's "send_to" value (AW-XXXXXXXXX/abcDEF…) below. Until then the events
 * still reach the Google tag, so they can be used to define conversions.
 */
(function () {
  var ADS_CONVERSIONS = {
    whatsapp_click: "AW-18580474209/QifACOOe4bodEOGS7ptF",  // "WhatsApp click" (Contact goal)
    generate_lead:  "AW-18580474209/IVEBCLOilbodEOGS7ptF",  // "Submit lead form" (quote form sent)
    phone_click:    ""
  };

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  // The Google Ads account behind the conversions above (customer 324-682-6635).
  var ADS_ID = "AW-18580474209";
  gtag("config", ADS_ID);

  function track(name, params) {
    params = params || {};
    params.page_path = location.pathname;
    params.page_language = document.documentElement.lang || "en";
    try {
      gtag("event", name, params);
      var sendTo = ADS_CONVERSIONS[name];
      // beacon: the conversion still reaches Google if the tap opens WhatsApp in this tab.
      if (sendTo) gtag("event", "conversion", { send_to: sendTo, transport_type: "beacon" });
      if (window.va) window.va("event", { name: name, data: { page: params.page_path } });
    } catch (e) { /* never break the page for analytics */ }
  }
  window.solvedTrack = track;

  // ── Ad attribution ────────────────────────────────────────────────────
  // A visit that arrives from an ad (gclid / gbraid / wbraid or utm_medium=cpc)
  // is recorded once via /api/track, which returns a short reference such as
  // "S-7K2QX". It is kept for 90 days, added to the WhatsApp message the
  // visitor sends, and sent with the contact form, so each lead can be traced
  // back to the ad and keyword that brought it.
  var ATTR_KEY = "solved_attr", ATTR_DAYS = 90;
  function readAttr() {
    try {
      var a = JSON.parse(localStorage.getItem(ATTR_KEY) || "null");
      if (a && a.ts && Date.now() - a.ts < ATTR_DAYS * 864e5) return a;
    } catch (e) {}
    return null;
  }
  function saveAttr(a) { try { localStorage.setItem(ATTR_KEY, JSON.stringify(a)); } catch (e) {} }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function post(body, beacon) {
    var json = JSON.stringify(body);
    try {
      if (beacon && navigator.sendBeacon) return navigator.sendBeacon("/api/track", new Blob([json], { type: "application/json" }));
      return fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true })
        .then(function (r) { return r.json(); }).catch(function () { return null; });
    } catch (e) { return null; }
  }
  // ── ChatGPT ads: oppref + measurement consent ─────────────────────────
  // A click on a ChatGPT ad lands with ?oppref=… (OpenAI's privacy-preserving
  // click id). We ask that visitor once whether we may use it to measure the
  // ad. Only after "Allow" is the oppref sent to our server, where the
  // internal system reports conversions (e.g. a quote request) to OpenAI.
  // "No thanks" is recorded and the oppref is dropped. Visitors who did not
  // come from a ChatGPT ad are never asked. The choice is kept 180 days.
  var CONSENT_KEY = "solved_measure_consent", CONSENT_DAYS = 180;
  function readConsent() {
    try {
      var c = JSON.parse(localStorage.getItem(CONSENT_KEY) || "null");
      if (c && (c.v === "granted" || c.v === "denied") && Date.now() - c.ts < CONSENT_DAYS * 864e5) return c.v;
    } catch (e) {}
    return null;
  }
  function saveConsent(v) { try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: v, ts: Date.now() })); } catch (e) {} }
  // Reload de-dup key for an oppref click: a one-way hash, so the raw click id
  // is not kept in storage after the visitor says No.
  function clickHash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return "oai-" + h.toString(36); }
  function cleanOppref(s) { s = String(s || "").trim(); return /^[A-Za-z0-9._~:-]{1,256}$/.test(s) ? s : ""; }
  var consent = readConsent();
  var sessionReq = null;                                          // the consent call waits for the visit row

  var attr = readAttr();
  (function captureAdVisit() {
    var q = new URLSearchParams(location.search);
    var oppref = cleanOppref(q.get("oppref"));
    var v = { gclid: q.get("gclid"), gbraid: q.get("gbraid"), wbraid: q.get("wbraid"),
              utm_source: q.get("utm_source") || (oppref ? "chatgpt" : null),
              utm_medium: q.get("utm_medium") || (oppref ? "cpc" : null), utm_campaign: q.get("utm_campaign"),
              utm_term: q.get("utm_term"), utm_content: q.get("utm_content") };
    var paid = oppref || v.gclid || v.gbraid || v.wbraid || /^(cpc|ppc|paid|paidsearch)$/i.test(v.utm_medium || "");
    if (!paid) return;
    var clickId = oppref ? clickHash(oppref) : (v.gclid || v.gbraid || v.wbraid || "");
    if (attr && clickId && attr.click === clickId) return;        // same ad click, page reload
    // The oppref stays in this browser until the visitor allows measurement.
    var next = { key: uid(), click: clickId, ts: Date.now(), ref: null, term: v.utm_term || "", oppref: oppref || null, opprefSent: false };
    var allowed = !!oppref && consent === "granted";              // already said yes on an earlier visit
    if (allowed) next.opprefSent = true;
    attr = next; saveAttr(next);
    var body = Object.assign({ type: "session", key: next.key, landing: location.pathname + location.search.slice(0, 200), referrer: document.referrer }, v);
    if (allowed) { body.oppref = oppref; body.consent = true; }
    var req = post(body);
    if (req && req.then) {
      sessionReq = req;
      req.then(function (r) { if (r && r.ref && attr && attr.key === next.key) { attr.ref = r.ref; saveAttr(attr); } });
    }
  })();

  function sendConsent(granted) {
    if (!attr || !attr.oppref) return;
    var body = { type: "consent", key: attr.key, granted: !!granted };
    if (granted) body.oppref = attr.oppref;
    Promise.resolve(sessionReq).then(function () { post(body); });
    attr.opprefSent = true;
    if (!granted) attr.oppref = null;                             // never kept after "No thanks"
    saveAttr(attr);
  }

  function showConsentPrompt() {
    if (document.getElementById("solved-measure-consent")) return;
    var ar = (document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
    var t = ar ? {
      title: "هل تسمح بقياس هذه الزيارة؟",
      body: "وصلت إلينا عبر إعلان في ChatGPT. بإذنك نُبلغ OpenAI عندما يتواصل معنا من جاء من هذا الإعلان، لنعرف أي الإعلانات تفيد عملاءنا. لا نشارك اسمك أو رقم هاتفك أو رسائلك.",
      allow: "سماح", deny: "لا، شكراً", more: "سياسة الخصوصية", href: "/ar/privacy"
    } : {
      title: "May we measure this visit?",
      body: "You reached us through an ad in ChatGPT. With your permission we tell OpenAI when someone from that ad contacts us, so we know which ads help our customers. We never share your name, phone number or messages.",
      allow: "Allow", deny: "No thanks", more: "Privacy policy", href: "/privacy"
    };
    var box = document.createElement("div");
    box.id = "solved-measure-consent";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", t.title);
    box.dir = ar ? "rtl" : "ltr";
    // On narrow screens sit above the floating WhatsApp button (.wa-float) instead of covering it.
    var narrow = window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
    box.style.cssText = "position:fixed;z-index:2147483000;left:16px;right:16px;bottom:" + (narrow ? "84px" : "16px") + ";margin:0 auto;max-width:520px;" +
      "background:var(--paper,#FBF8F2);color:var(--ink,#181000);border:1px solid var(--border,rgba(24,16,0,.12));border-radius:16px;" +
      "box-shadow:0 12px 40px -12px rgba(24,16,0,.28);padding:16px 18px;font:14px/1.5 " + (ar ? "'IBM Plex Sans Arabic',sans-serif" : "var(--display,Arial,sans-serif)") + ";";
    var btn = "min-height:40px;padding:0 18px;border-radius:999px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--ink,#181000);";
    box.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px"></div><div style="color:var(--muted,rgba(24,16,0,.7))"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px">' +
      '<button type="button" data-c="granted" style="' + btn + 'background:var(--ink,#181000);color:var(--paper,#FBF8F2)"></button>' +
      '<button type="button" data-c="denied" style="' + btn + 'background:transparent;color:var(--ink,#181000)"></button>' +
      '<a style="margin-inline-start:auto;color:var(--ink,#181000);text-decoration:underline"></a></div>';
    box.children[0].textContent = t.title;
    box.children[1].textContent = t.body;
    var row = box.children[2];
    row.children[0].textContent = t.allow;
    row.children[1].textContent = t.deny;
    row.children[2].textContent = t.more;
    row.children[2].href = t.href;
    row.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("button[data-c]") : null;
      if (!b) return;
      consent = b.getAttribute("data-c");
      saveConsent(consent);
      sendConsent(consent === "granted");
      box.remove();
    });
    document.body.appendChild(box);
  }

  // Ask only visitors from a ChatGPT ad who have not answered yet. If they
  // answered on an earlier visit, act on that answer without asking again.
  if (attr && attr.oppref && !attr.opprefSent) {
    if (consent) sendConsent(consent === "granted");
    else if (document.body) showConsentPrompt();
    else document.addEventListener("DOMContentLoaded", showConsentPrompt);
  }
  window.solvedAttr = function () { return attr ? { attr_key: attr.key, attr_ref: attr.ref || "" } : {}; };

  // Adds "Ref: S-XXXXX" to a wa.me link's pre-filled message.
  function withRef(href, ref) {
    try {
      var u = new URL(href);
      var t = u.searchParams.get("text") || "";
      if (t.indexOf(ref) !== -1) return href;
      u.searchParams.delete("text");
      var rest = u.searchParams.toString();
      // encodeURIComponent (%20 for spaces), not URLSearchParams' "+".
      return u.origin + u.pathname + "?text=" + encodeURIComponent((t ? t + "\n\n" : "") + "Ref: " + ref) + (rest ? "&" + rest : "");
    } catch (e) { return href; }
  }

  // One delegated listener catches every link, including ones added later by the CMS.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    var where = a.getAttribute("data-track") || (a.closest("section[id]") || {}).id || "";
    if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|(www\.)?whatsapp\.com)\//i.test(href)) {
      track("whatsapp_click", { link_location: where });
      if (attr) {
        if (attr.ref) a.setAttribute("href", withRef(href, attr.ref));
        post({ type: "whatsapp_click", key: attr.key, page: location.pathname }, true);
      }
    } else if (/^tel:/i.test(href)) {
      track("phone_click", { link_location: where });
      if (attr) post({ type: "call_click", key: attr.key, page: location.pathname }, true);
    } else if (/^mailto:/i.test(href)) {
      track("email_click", { link_location: where });
    }
  }, true);
})();
