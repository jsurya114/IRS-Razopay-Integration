const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ejs = require('ejs');

// Server-enforced pricing — client cannot manipulate amount
const PRICING = Object.freeze({
  mockPack: 20,
  basic: 15
});

// In-memory store: orderId → { name, email, phone, amount, package, utmSource, utmMedium, utmCampaign }
const orderStore = new Map();
// Idempotency guards — prevents replay attacks and duplicate webhook processing
const processedPayments = new Set(); // tracks razorpay_payment_id
const processedWebhookEvents = new Set(); // tracks x-razorpay-event-id

// Auto-expire orderStore entries after 2 hours — prevents memory leak from abandoned orders
const ORDER_TTL_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of orderStore.entries()) {
    if (now - val.createdAt > ORDER_TTL_MS) {
      orderStore.delete(key);
    }
  }
}, 30 * 60 * 1000);
const PDFDocument = require('pdfkit');
const path = require('path');
require('dotenv').config();

const razorpay = require('./config/razorpay');
const mailer = require('./config/mailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  // CSP disabled — Razorpay checkout requires dynamic inline scripts and multiple
  // third-party origins (cdn.razorpay.com, fonts.googleapis.com, Meta Pixel, Clarity).
  contentSecurityPolicy: false,
  // COEP + COOP disabled — Razorpay opens a cross-origin iframe/popup for checkout.
  // These headers block cross-origin resources and popups, silently preventing the modal.
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
}));

// Rate limiting on API routes (20 requests per 15 minutes)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(['/api/create-order', '/workshop/api/create-order'], apiLimiter);
app.use(['/api/verify-payment', '/workshop/api/verify-payment'], apiLimiter);
// /api/webhook intentionally excluded — Razorpay retries must get 2xx

// Middleware
// ALLOWED_ORIGIN should be set in .env (e.g. ALLOWED_ORIGIN=https://yourdomain.com)
const corsOrigin = process.env.ALLOWED_ORIGIN || (process.env.NODE_ENV === 'production'
  ? (() => { throw new Error('FATAL: ALLOWED_ORIGIN must be set in production'); })()
  : 'http://localhost:3000');

app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.urlencoded({ extended: true }));
// Keep raw body for webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the public directory
app.use('/workshop', express.static(path.join(__dirname, 'public')));

/**
 * Helper: Generate Invoice PDF in memory
 */
async function generateInvoicePDF(details) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      let buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
      doc.on('error', reject);

      // PDF Content
      doc.fontSize(20).text('Payment Invoice', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
      doc.moveDown();
      doc.fontSize(14).text('Student Details:');
      doc.fontSize(12)
         .text(`Name: ${details.name}`)
         .text(`Email: ${details.email}`)
         .text(`Phone: ${details.phone}`);
      doc.moveDown();
      doc.fontSize(14).text('Payment Details:');
      doc.fontSize(12)
         .text(`Order ID: ${details.orderId}`)
         .text(`Payment ID: ${details.paymentId}`)
         .text(`Amount Paid: Rs. ${details.amount}`);
      
      doc.moveDown(2);
      doc.fontSize(10).text('Thank you for your purchase!', { align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Helper: Send Emails
 */
async function sendPostPaymentEmails(details, pdfBuffer) {
  if (!process.env.SMTP_USERNAME) {
    console.log('⚠️  Emails skipped — SMTP_USERNAME not configured');
    return;
  }

  try {
    // Render HTML templates
    const studentHtml = await ejs.renderFile(
      path.join(__dirname, 'views/emails/student-confirmation.ejs'),
      details
    );
    const ownerHtml = await ejs.renderFile(
      path.join(__dirname, 'views/emails/owner-notification.ejs'),
      details
    );

    // Student confirmation email
    await mailer.sendMail({
      from: `"IRS Learning" <${process.env.SMTP_USERNAME}>`,
      to: details.email,
      subject: 'Payment Confirmed — IRS Learning',
      html: studentHtml,
      attachments: [{
        filename: `Invoice_${details.paymentId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    });

    // Owner notification email
    await mailer.sendMail({
      from: `"IRS Payments" <${process.env.SMTP_USERNAME}>`,
      to: process.env.OWNER_EMAIL || 'enquiry@irsgroup.in',
      subject: `New Payment — ${details.name} | ₹${details.amount}`,
      html: ownerHtml
    });

    console.log(`✅ Emails sent — student: ${details.email}, owner: ${process.env.OWNER_EMAIL}`);
  } catch (error) {
    console.error('❌ Email send failed:', error);
    // Don't rethrow — payment was successful, email failure is non-fatal
  }
}

/**
 * 1. CREATE ORDER
 */
app.post(['/api/create-order', '/workshop/api/create-order'], async (req, res) => {
  console.log('--- NEW ORDER REQUEST ---');
  console.log('Body:', req.body);
  try {
    const { name, email, phone, mockPack } = req.body;
    
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Missing required student details' });
    }
    // Length limits
    if (name.length > 100 || email.length > 254 || String(phone).length > 20) {
      return res.status(400).json({ error: 'Input fields exceed maximum length' });
    }
    // Email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    // Sanitize name — prevent CRLF header injection in emails
    const safeName = String(name).replace(/[\r\n]/g, '').trim();

    // Server-enforced pricing via PRICING constant (client cannot manipulate)
    const mockPackBool = mockPack === true || mockPack === 'true' || mockPack === '1';
    const amountInRupees = mockPackBool ? PRICING.mockPack : PRICING.basic;
    const amountInPaise = amountInRupees * 100;

    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: `receipt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    };

    console.log('Creating Razorpay order with options:', options);
    const order = await razorpay.orders.create(options);
    console.log('Razorpay order created:', order.id);

    orderStore.set(order.id, {
      name: safeName, email, phone,
      amount: amountInRupees,
      package: mockPackBool ? 'Mock Pack' : 'Basic Pack',
      utmSource: req.body.utmSource || null,
      utmMedium: req.body.utmMedium || null,
      utmCampaign: req.body.utmCampaign || null,
      createdAt: Date.now()
    });

    res.json({
      orderId: order.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency
    });
  } catch (error) {
    console.error('Create Order Error:', error);
    res.status(500).json({ error: 'Could not start the payment.' });
  }
});

/**
 * 2. VERIFY PAYMENT
 */
app.post(['/api/verify-payment', '/workshop/api/verify-payment'], async (req, res) => {
  console.log('--- VERIFY PAYMENT REQUEST ---');
  console.log('Body:', req.body);
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      name, email, phone, mockPack 
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Missing payment details' });
    }

    // Replay attack guard — same paymentId cannot be processed twice
    if (processedPayments.has(razorpay_payment_id)) {
      console.warn(`⚠️ Duplicate payment attempt blocked: ${razorpay_payment_id}`);
      return res.status(409).json({ success: false, error: 'Payment already processed' });
    }

    // Verify signature mathematically
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    const sigBuffer = Buffer.from(razorpay_signature, 'hex');
    const expBuffer = Buffer.from(expectedSignature, 'hex');
    if (sigBuffer.length === expBuffer.length && crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      console.log(`✅ Payment verified successfully for ${email} (ID: ${razorpay_payment_id})`);

      // Hard-fail if orderStore entry is missing — no fallback to req.body
      const stored = orderStore.get(razorpay_order_id);
      if (!stored) {
        console.error(`❌ orderId ${razorpay_order_id} not found in orderStore — possible replay or server restart`);
        return res.status(400).json({ success: false, error: 'Order session expired. Please contact support.' });
      }

      // Mark payment as processed BEFORE async work — prevents race condition
      processedPayments.add(razorpay_payment_id);
      orderStore.delete(razorpay_order_id);

      const details = {
        name: stored.name,
        email: stored.email,
        phone: stored.phone,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        amount: stored.amount,
        package: stored.package,
        utmSource: stored.utmSource || null,
        utmMedium: stored.utmMedium || null,
        utmCampaign: stored.utmCampaign || null,
        date: new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
      };

      // Generate Invoice & Send Emails asynchronously so it doesn't block response
      console.log('Triggering generateInvoicePDF and sendPostPaymentEmails...');
      generateInvoicePDF(details)
        .then(pdfBuffer => sendPostPaymentEmails(details, pdfBuffer))
        .catch(err => console.error('Error in post-payment processing:', err));

      // Return success. A dummy access token is provided since the frontend expects one.
      return res.json({ 
        success: true, 
        accessToken: crypto.randomBytes(16).toString('hex') 
      });
    } else {
      console.error('❌ Invalid payment signature');
      return res.status(400).json({ success: false, error: 'Invalid payment signature' });
    }
  } catch (error) {
    console.error('Verify Payment Error:', error);
    res.status(500).json({ success: false, error: 'Internal server error during verification' });
  }
});

/**
 * 3. WEBHOOK
 */
app.post(['/api/webhook', '/workshop/api/webhook'], (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('❌ RAZORPAY_WEBHOOK_SECRET not configured — rejecting webhook');
      return res.status(503).json({ error: 'Webhook not configured' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature || '', 'hex');
    const expBuf = Buffer.from(expectedSignature, 'hex');
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      // Deduplicate using Razorpay's unique event ID header (official docs recommendation)
      const eventId = req.headers['x-razorpay-event-id'];
      if (eventId && processedWebhookEvents.has(eventId)) {
        console.warn(`⚠️ Duplicate webhook event blocked: ${eventId}`);
        return res.status(200).send('OK'); // Must return 2xx so Razorpay stops retrying
      }
      if (eventId) processedWebhookEvents.add(eventId);

      const event = req.body.event;
      if (event === 'payment.captured') {
        const paymentData = req.body.payload.payment.entity;
        console.log(`🔔 Webhook: Payment captured for ${paymentData.amount / 100} INR (ID: ${paymentData.id})`);
        // We could also trigger invoice and emails here, but since the verify-payment
        // route already does it immediately, we should be careful about sending duplicate emails.
        // For simplicity, we just log it.
      }
      res.status(200).send('OK');
    } else {
      console.error('❌ Invalid webhook signature');
      res.status(400).send('Invalid signature');
    }
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).send('Server Error');
  }
});

// Render the main page — pass Razorpay Key ID to EJS template
app.get(['/','/workshop'], (req, res) => {
    res.render('workshop', {
        razorpayKeyId: process.env.RAZORPAY_KEY_ID
    });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`👉 Open http://localhost:${PORT} to test the integration`);
});
