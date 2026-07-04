const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const path = require('path');
require('dotenv').config();

const razorpay = require('./config/razorpay');
const mailer = require('./config/mailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Keep raw body for webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
// Serve static files from the current directory
app.use(express.static(__dirname));

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
  // Send to Student
  const studentMailOptions = {
    from: `"Support" <${process.env.SMTP_USERNAME}>`,
    to: details.email,
    subject: 'Payment Successful - Invoice Attached',
    text: `Hi ${details.name},\n\nYour payment of Rs. ${details.amount} was successful. Please find your invoice attached.\n\nOrder ID: ${details.orderId}\nPayment ID: ${details.paymentId}\n\nThank you!`,
    attachments: [
      {
        filename: `Invoice_${details.paymentId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  };

  // Send to Course Owner
  const ownerMailOptions = {
    from: `"System" <${process.env.SMTP_USERNAME}>`,
    to: process.env.OWNER_EMAIL,
    subject: `New Payment Received: Rs. ${details.amount}`,
    text: `A new payment has been made.\n\nStudent: ${details.name}\nEmail: ${details.email}\nPhone: ${details.phone}\nAmount: Rs. ${details.amount}\nPayment ID: ${details.paymentId}\nOrder ID: ${details.orderId}`
  };

  try {
    if (process.env.SMTP_USERNAME) {
      await mailer.sendMail(studentMailOptions);
      await mailer.sendMail(ownerMailOptions);
      console.log('✅ Emails sent successfully');
    } else {
      console.log('⚠️ Emails skipped (SMTP_USERNAME not configured)');
    }
  } catch (error) {
    console.error('❌ Error sending emails:', error);
  }
}

/**
 * 1. CREATE ORDER
 */
app.post('/api/create-order', async (req, res) => {
  try {
    const { name, email, phone, mockPack } = req.body;
    
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Missing required student details' });
    }

    // Determine pricing (you can adjust this logic based on your requirements)
    const amountInRupees = mockPack ? 199 : 99;
    const amountInPaise = amountInRupees * 100;

    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: `receipt_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);

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
app.post('/api/verify-payment', async (req, res) => {
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

    // Verify signature mathematically
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      console.log(`✅ Payment verified successfully for ${email} (ID: ${razorpay_payment_id})`);
      
      const amountInRupees = mockPack ? 199 : 99;
      
      const details = {
        name, email, phone,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        amount: amountInRupees
      };

      // Generate Invoice & Send Emails asynchronously so it doesn't block response
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
app.post('/api/webhook', (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.warn('⚠️ Webhook endpoint called but RAZORPAY_WEBHOOK_SECRET is not configured.');
      return res.status(200).send('OK');
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.rawBody)
      .digest('hex');

    if (expectedSignature === signature) {
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

// Fallback to index.html if navigating manually
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`👉 Open http://localhost:${PORT}/workshop.html to test the integration`);
});
