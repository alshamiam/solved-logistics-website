/* Conversion tracking for Google Ads (and any tag in the Google tag container).
 *
 * Counts the actions that matter for SOLVED:
 *   - WhatsApp taps (any link to wa.me)       → event "whatsapp_click"
 *   - Phone taps (tel: links)                 → event "phone_click"
 *   - Email taps (mailto: links)              → event "email_click"
 *   - Quote form sent successfully            → event "generate_lead"
 *     (called from handleSubmit via window.solvedTrack)
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

  // One delegated listener catches every link, including ones added later by the CMS.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    var where = a.getAttribute("data-track") || (a.closest("section[id]") || {}).id || "";
    if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|(www\.)?whatsapp\.com)\//i.test(href)) {
      track("whatsapp_click", { link_location: where });
    } else if (/^tel:/i.test(href)) {
      track("phone_click", { link_location: where });
    } else if (/^mailto:/i.test(href)) {
      track("email_click", { link_location: where });
    }
  }, true);
})();
