# Razorpay Backend Integration

This is a simple, clean, and modular Node.js backend to handle Razorpay integrations for course registrations. It includes endpoints for creating orders, verifying payments mathematically, processing webhooks securely, and dynamically generating and emailing PDF invoices.

## Project Structure

```text
/
├── .env                  # Environment variables
├── package.json          # Dependencies and scripts
├── server.js             # Express server, API routes, payment logic, invoice generation, and email handling
├── README.md             # Setup guide and API documentation
└── config/
    ├── razorpay.js       # Razorpay configuration
    └── mailer.js         # Email configuration
```

## Setup Instructions

1. **Install Dependencies**
   Run the following command to install the required Node.js packages:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**
   Open the `.env` file and fill in your actual credentials:
   - `RAZORPAY_KEY_ID`: Your Razorpay Key ID
   - `RAZORPAY_KEY_SECRET`: Your Razorpay Key Secret
   - `RAZORPAY_WEBHOOK_SECRET`: A secret string used when you configure webhooks in the Razorpay Dashboard.
   - `SMTP_...`: Your email provider credentials (e.g. Gmail App Password) to allow the server to send emails.
   - `OWNER_EMAIL`: The email address where payment notifications should be sent.

3. **Start the Server**
   Start the backend server by running:
   ```bash
   node server.js
   ```
   The server will run on `http://localhost:3000`. It will also serve your static HTML files.
   Open `http://localhost:3000/workshop.html` in your browser to test the payment flow.

## API Documentation

### `POST /api/create-order`
Creates a new order in Razorpay.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "mockPack": true
}
```

**Response:**
```json
{
  "orderId": "order_Hkg...",
  "keyId": "rzp_test_...",
  "amount": 19900,
  "currency": "INR"
}
```

### `POST /api/verify-payment`
Verifies the payment signature returned by Razorpay Checkout. If valid, generates a PDF invoice and sends emails to the student and course owner.

**Request Body:**
```json
{
  "razorpay_order_id": "order_Hkg...",
  "razorpay_payment_id": "pay_Hkg...",
  "razorpay_signature": "...",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "mockPack": true
}
```

**Response:**
```json
{
  "success": true,
  "accessToken": "dummy_random_hex_string"
}
```

### `POST /api/webhook`
Endpoint for Razorpay to send server-to-server notifications (e.g., `payment.captured`). Verify signature using `RAZORPAY_WEBHOOK_SECRET`.
