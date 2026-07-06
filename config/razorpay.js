const Razorpay = require('razorpay');
require('dotenv').config();

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  throw new Error('FATAL: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing from .env. Server cannot start.');
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = razorpay;
