/* Microsoft Clarity — Verbis Edu. Session recordings, heatmaps & scroll maps.
 *
 * The one thing you have to do: create a free project at clarity.microsoft.com,
 * then paste its 10-char project id below (Clarity → Settings → Overview).
 * Until a real id is set this file is a no-op, so it's safe to ship as-is.
 *
 * Clarity reads UTM params + referrer off the URL automatically, so recordings
 * can be filtered by traffic source / campaign with no extra code.
 */
(function () {
  var CLARITY_PROJECT_ID = "xg3h1lzn8f";
  if (!CLARITY_PROJECT_ID || CLARITY_PROJECT_ID.indexOf("REPLACE") !== -1) return;
  (function (c, l, a, r, i, t, y) {
    c[a] =
      c[a] ||
      function () {
        (c[a].q = c[a].q || []).push(arguments);
      };
    t = l.createElement(r);
    t.async = 1;
    t.src = "https://www.clarity.ms/tag/" + i;
    y = l.getElementsByTagName(r)[0];
    y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY_PROJECT_ID);
})();
