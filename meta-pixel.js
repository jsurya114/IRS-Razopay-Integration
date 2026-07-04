/* Meta Pixel — Verbis Edu. Single source of truth for the base pixel.
 *
 * Loaded by BOTH worlds of the hybrid site:
 *   - the static marketing pages (public/*.html) via <script src="/meta-pixel.js">
 *   - the React app (src/app/layout.tsx) via the <MetaPixel> client component
 *
 * This file only initialises the pixel and fires the first PageView. The custom
 * conversion events (Lead, InitiateCheckout, Purchase) are fired from their own
 * locations by calling window.fbq(...). The Pixel ID is public by design.
 */
!(function (f, b, e, v, n, t, s) {
  if (f.fbq) return;
  n = f.fbq = function () {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = !0;
  n.version = "2.0";
  n.queue = [];
  t = b.createElement(e);
  t.async = !0;
  t.src = v;
  s = b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t, s);
})(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

window.fbq("init", "973733552157257");
window.fbq("track", "PageView");
