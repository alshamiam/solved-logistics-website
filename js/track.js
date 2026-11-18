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
    whatsapp_click: "",   // e.g. "AW-123456789/AbCdEfGhIj"
    generate_lead:  "",
    phone_click:    ""
  };

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  function track(name, params) {
    params = params || {};
    params.page_path = location.pathname;
    params.page_language = document.documentElement.lang || "en";
    try {
      gtag("event", name, params);
      var sendTo = ADS_CONVERSIONS[name];
      if (sendTo) gtag("event", "conversion", { send_to: sendTo });
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
  var attr = readAttr();
  (function captureAdVisit() {
    var q = new URLSearchParams(location.search);
    var v = { gclid: q.get("gclid"), gbraid: q.get("gbraid"), wbraid: q.get("wbraid"),
              utm_source: q.get("utm_source"), utm_medium: q.get("utm_medium"), utm_campaign: q.get("utm_campaign"),
              utm_term: q.get("utm_term"), utm_content: q.get("utm_content") };
    var paid = v.gclid || v.gbraid || v.wbraid || /^(cpc|ppc|paid|paidsearch)$/i.test(v.utm_medium || "");
    if (!paid) return;
    var clickId = v.gclid || v.gbraid || v.wbraid || "";
    if (attr && clickId && attr.click === clickId) return;        // same ad click, page reload
    var next = { key: uid(), click: clickId, ts: Date.now(), ref: null, term: v.utm_term || "" };
    attr = next; saveAttr(next);
    var req = post(Object.assign({ type: "session", key: next.key, landing: location.pathname + location.search.slice(0, 200), referrer: document.referrer }, v));
    if (req && req.then) req.then(function (r) { if (r && r.ref && attr && attr.key === next.key) { attr.ref = r.ref; saveAttr(attr); } });
  })();
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
