# AGENTS.md — IRS Razorpay Integration Progress Log

## Project: IRS-Razorpay-Integration
**Branch:** `dev1`  
**Repo:** https://github.com/jsurya114/IRS-Razopay-Integration  
**Local Path:** `/Users/jasilm/Desktop/IRS-Razorpay-Integration`

---

## ✅ Completed Work

### 1. Repository Setup
- Cloned the `dev1` branch from the remote GitHub repo into the workspace
- Installed all dependencies via `npm install`

### 2. Project Restructure (EJS + Public Folder)
- Installed `ejs` as the view engine
- Created `views/` folder — moved `workshop.html` → `views/workshop.ejs`
- Created `public/` folder — moved all static assets:
  - `clarity.js`, `meta-pixel.js`, `workshop-tokens.css`
  - `assets/` (images, CSS, JS, webfonts)
  - `workshop-assets/` (videos, posters)
- Updated `server.js`:
  - Set `app.set('view engine', 'ejs')`
  - Changed `express.static` to serve from `public/`
  - Root route `GET /` now uses `res.render('workshop', { razorpayKeyId })`
  - Added `express.urlencoded` middleware

### 3. Razorpay Integration (Working in Test Mode ✅)
- **`config/razorpay.js`** — Razorpay SDK initialized from `.env` keys
- **`POST /api/create-order`** — Creates Razorpay order, returns `orderId`, `keyId`, `amount`, `currency`
- **`POST /api/verify-payment`** — Cryptographically verifies Razorpay signature using HMAC-SHA256; triggers invoice + email on success
- **`POST /api/webhook`** — Webhook endpoint with signature verification (optional; requires public URL via ngrok for local testing)
- **Fixed critical bug:** Razorpay checkout script URL was a broken relative path (`../checkout.razorpay.com/...`) → fixed to `https://checkout.razorpay.com/v1/checkout.js`
- **Test confirmed:** `✅ Payment verified successfully` logged during local test

### 4. Infrastructure Already in Place (Pre-2026-07-06 baseline)
- **`config/mailer.js`** — Nodemailer transporter (baseline Gmail SMTP scaffold)
- **`generateInvoicePDF()`** — Generates PDF invoice using PDFKit in memory
- **`sendPostPaymentEmails()`** — Baseline scaffold (was failing due to placeholder SMTP credentials)

---

### 5. Security Hardening (2026-07-06)

All changes applied to `server.js` and `config/razorpay.js`.

1. **`package.json`** — Added `"start": "node server.js"` script; fixed `"main"` field to `"server.js"`
2. **Helmet middleware** — Added with full Razorpay-compatible CSP: allows `*.razorpay.com`, Google Fonts, Meta Pixel, Microsoft Clarity, `unsafe-inline`, `unsafe-eval`, `blob:` and worker sources
3. **Rate limiting** — `express-rate-limit` applied on `/api/create-order` and `/api/verify-payment` only; webhook intentionally excluded per Razorpay retry policy
4. **CORS restricted** — `app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000' }))` — locked to env var; throws hard in production if `ALLOWED_ORIGIN` is not set
5. **Server-side pricing** — `const PRICING = Object.freeze({ mockPack: 199, basic: 99 })` — amount is now determined server-side; client can no longer manipulate the order amount
6. **`mockPack` type coercion fix** — `mockPackBool = mockPack === true || mockPack === 'true' || mockPack === '1'` — fixes billing bug where the string `"false"` was truthy
7. **Timing-safe signature comparison** — `crypto.timingSafeEqual()` used in both `/api/verify-payment` and `/api/webhook` to prevent timing attacks
8. **`config/razorpay.js` hardened** — Removed `'dummy_key_secret'` hardcoded fallback; server now throws on startup if `RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` are missing
9. **Webhook 503 on missing secret** — Returns `503` (not `200 OK`) when `RAZORPAY_WEBHOOK_SECRET` is not configured
10. **Replay attack guard** — `processedPayments = new Set()` — same `paymentId` on a second `/api/verify-payment` submission is blocked with `409 Conflict`
11. **Webhook idempotency** — `processedWebhookEvents = new Set()` — deduplicates webhook events using `x-razorpay-event-id` header per Razorpay official docs
12. **`orderStore` hard-reject** — `/api/verify-payment` hard-rejects if `orderId` is not found in `orderStore`; no fallback to `req.body`
13. **Input validation** — Email regex validation; CRLF sanitization on name field; length limits enforced (name ≤ 100 chars, email ≤ 254 chars, phone ≤ 20 chars)
14. **Receipt entropy** — `receipt_${Date.now()}_${randomHex}` — prevents collision under burst traffic
15. **`orderStore` TTL** — Abandoned orders auto-expire after 2 hours via `setInterval` — prevents unbounded memory growth
16. **CORS hard fail in production** — Server throws at startup in production if `ALLOWED_ORIGIN` is not set
17. **`.env.example`** — Created with all required keys documented for easy onboarding

---

### 6. Email Flow Implementation (2026-07-06)

18. **`views/emails/student-confirmation.ejs`** — Created: branded HTML confirmation email with payment summary table and PDF invoice as attachment
19. **`views/emails/owner-notification.ejs`** — Created: HTML lead card with full student details, package info, payment IDs, and UTM attribution for the owner/admin
20. **`config/mailer.js`** — Fully rewritten: uses STARTTLS; reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` from environment variables
21. **`orderStore` Map enriched** — At order creation, stores `name`, `email`, `phone`, `amount`, `package`, and UTM params so they are available at payment verification time
22. **`sendPostPaymentEmails()` rewritten** — Uses `ejs.renderFile()` to render both email templates; sends student confirmation (with PDF invoice attachment) and owner lead notification; skips gracefully if `SMTP_USERNAME` is not configured
23. **UTM tracking** — `utmSource`, `utmMedium`, `utmCampaign` captured from `/api/create-order` request body, stored in `orderStore`, and passed through to the owner notification email

---

### 7. Bug Fixes & Known Issues (2026-07-06)

24. **Helmet CSP blocking Razorpay modal** — Fixed CSP configuration to include all required Razorpay domains (`*.razorpay.com` wildcard), Google Fonts, Meta Pixel, Microsoft Clarity, `unsafe-eval`, and `blob:` sources. Previously the Razorpay checkout modal was silently failing in the browser due to CSP violations.

### 🔴 Known Unfixed Bug

**Razorpay modal not opening on "Claim my seat" click**
- **Status:** Unresolved as of 2026-07-06
- **Symptom:** Clicking the payment button does not open the Razorpay checkout modal. No visible error to the user.
- **Root cause:** Browser console shows CSP violations. Despite multiple CSP fixes applied today, the modal is still not launching in the browser.
- **What was tried:** Added `*.razorpay.com` wildcard, `unsafe-inline`, `unsafe-eval`, `blob:`, `workerSrc`, `frameSrc`, `connectSrc`, `fontSrc` for all known Razorpay domains. Server restarts confirmed after each change.
- **Next step:** Open browser DevTools → Console + Network tabs while clicking the button. Capture the exact CSP error lines and share with Ghost for targeted fix. May also need to check the frontend JS (`workshop.ejs`) to confirm the Razorpay `handler` function is correctly wired to the button click event.

---

## ⬜ Next Steps

1. **Email credentials** — Receive Gmail SMTP credentials from client; wire up `.env` and smoke-test email delivery end-to-end
2. **Deploy to Railway** — Set all production env vars, point domain
3. **Set `ALLOWED_ORIGIN`** — Must be set in production environment or server will refuse to start
4. **Configure Razorpay webhook** — Register public Railway URL in Razorpay dashboard; test with live events
5. **Switch to live Razorpay keys** — Replace `rzp_test_*` keys with production keys in production env

---

## Current Project Structure

```
IRS-Razorpay-Integration/
├── .env                    # Environment variables (git-ignored)
├── .env.example            # Template with all required keys documented
├── .gitignore              # Excludes .env, node_modules, .DS_Store
├── AGENTS.md               # This file — progress log
├── package.json            # Dependencies + "start" script
├── server.js               # Main Express server + all API routes
├── README.md               # Setup guide
├── config/
│   ├── razorpay.js         # Razorpay SDK instance (throws on missing keys)
│   └── mailer.js           # Nodemailer STARTTLS transporter
├── views/
│   ├── workshop.ejs        # Main landing + checkout page
│   └── emails/
│       ├── student-confirmation.ejs  # Payment confirmation email (student)
│       └── owner-notification.ejs   # Lead notification email (owner)
└── public/
    ├── clarity.js          # Microsoft Clarity analytics
    ├── meta-pixel.js       # Meta/Facebook Pixel
    ├── workshop-tokens.css # CSS design tokens
    ├── assets/             # Images, CSS, JS, webfonts
    └── workshop-assets/    # Videos and posters
```

---

## .env Keys Reference

| Key | Purpose | Status |
|---|---|---|
| `RAZORPAY_KEY_ID` | Razorpay API Key (test: `rzp_test_...`) | ✅ Set |
| `RAZORPAY_KEY_SECRET` | Razorpay API Secret (throws on startup if missing) | ✅ Set |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification | ⬜ Needed for production webhook |
| `SMTP_HOST` | SMTP server host (e.g. `smtp.gmail.com`) | ⬜ Pending credentials from client |
| `SMTP_PORT` | SMTP port (e.g. `587`) | ⬜ Pending |
| `SMTP_USERNAME` | SMTP sender email | ⬜ Pending |
| `SMTP_PASSWORD` | SMTP App Password | ⬜ Pending |
| `OWNER_EMAIL` | Notification recipient (e.g. `enquiry@irsgroup.in`) | ⬜ Pending |
| `ALLOWED_ORIGIN` | Allowed CORS origin (required in production) | ⬜ Set at deploy time |
| `NODE_ENV` | Runtime environment (`production` enables strict CORS) | ⬜ Set at deploy time |
| `PORT` | Server port | ✅ `3000` |
