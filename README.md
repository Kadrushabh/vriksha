# ❧ Vriksha Backend — Setup & Deployment Guide

## What's included
```
vriksha-backend/
├── server.js              ← Main entry point
├── .env.example           ← Copy to .env and fill values
├── package.json
├── models/
│   └── Order.js           ← MongoDB order schema
├── routes/
│   ├── payment.js         ← Razorpay + COD endpoints
│   └── admin.js           ← Admin CRUD + Shiprocket actions
├── config/
│   ├── shiprocket.js      ← Shiprocket API wrapper
│   └── mailer.js          ← Order confirmation emails
├── middleware/
│   └── adminAuth.js       ← Admin session check
└── public/admin/
    ├── index.html         ← Admin panel UI
    └── checkout-snippet.html ← Paste into your website
```

---

## STEP 1 — Get your accounts ready (Day 1)

### MongoDB Atlas (free)
1. Go to https://cloud.mongodb.com → Sign up
2. Create a free cluster (M0 Sandbox)
3. Database Access → Add user (username + password)
4. Network Access → Allow from anywhere (0.0.0.0/0)
5. Connect → Drivers → Copy the connection string
6. Replace `<password>` in the string with your DB password

### Razorpay
1. Go to https://dashboard.razorpay.com → Sign up
2. Complete KYC (PAN + bank account — takes 1–2 days)
3. Settings → API Keys → Generate Test Keys first
4. Test with test keys, switch to Live keys before launch

### Shiprocket
1. Go to https://app.shiprocket.in → Create account
2. Add your pickup address (Settings → Pickup Addresses → "Primary")
3. Note your email & password for the API

---

## STEP 2 — Local setup & test

```bash
# 1. Unzip the backend folder
cd vriksha-backend

# 2. Install dependencies
npm install

# 3. Copy env file and fill values
cp .env.example .env
# Open .env in any text editor and fill all values

# 4. Start local server
npm run dev

# 5. Visit http://localhost:3000/admin
#    Login with your ADMIN_EMAIL + ADMIN_PASSWORD from .env
```

---

## STEP 3 — Deploy to Railway (free tier)

Railway gives you a free backend server with a public URL.

1. Go to https://railway.app → Sign up with GitHub
2. New Project → Deploy from GitHub repo
   - Push your vriksha-backend folder to a GitHub repo first
   - OR use: New Project → Empty Project → then Railway CLI
3. Add all environment variables (copy from your .env)
4. Railway auto-detects Node.js and runs `npm start`
5. Get your public URL: `https://vriksha-backend-xxxx.railway.app`

**Update in your website:**
```javascript
const BACKEND_URL = 'https://vriksha-backend-xxxx.railway.app';
```

---

## STEP 4 — Connect your website

1. Open `public/admin/checkout-snippet.html`
2. Copy the full `<script>` block
3. Paste it into your `checkout.html` before `</body>`
4. Update `BACKEND_URL` to your Railway URL
5. Make sure your form fields have the right IDs (listed in the snippet)

---

## STEP 5 — Add Razorpay origins (important!)

In Razorpay Dashboard → Settings → Website/App:
- Add `https://vriksha.in`
- Add `https://www.vriksha.in`

In your `server.js` cors config, the allowed origins are already set:
```javascript
origin: ['https://vriksha.in', 'https://www.vriksha.in', ...]
```

---

## API Endpoints Reference

### Public (your website calls these)
```
POST /api/payment/create-order      ← Start Razorpay payment
POST /api/payment/verify            ← Confirm payment after Razorpay
POST /api/payment/cod-order         ← Cash on delivery order
GET  /api/payment/check-serviceability?pincode=110001  ← Delivery check
```

### Admin (admin panel calls these, require login)
```
POST  /api/admin/login
GET   /api/admin/dashboard
GET   /api/admin/orders             ← ?status=&search=&page=
GET   /api/admin/orders/:orderId
PATCH /api/admin/orders/:orderId/status
POST  /api/admin/orders/:orderId/shiprocket-sync
POST  /api/admin/orders/:orderId/assign-awb
GET   /api/admin/orders/:orderId/track
POST  /api/admin/orders/:orderId/cancel
```

---

## Shiprocket Workflow (after you get an order)

1. **Order placed** → auto-pushed to Shiprocket
2. If auto-push failed → Admin Panel → order → "Push to Shiprocket"
3. In Shiprocket dashboard → assign courier → generate AWB
4. OR use Admin Panel → "Assign AWB" with courier ID
5. Customer gets email with tracking link automatically

---

## Your order flow end-to-end

```
Customer fills form
      ↓
Your website → POST /api/payment/create-order
      ↓
Razorpay opens (UPI / Card / Netbanking)
      ↓
Customer pays
      ↓
Your website → POST /api/payment/verify
      ↓
Backend verifies signature (security)
      ↓
Order saved in MongoDB ✅
Order pushed to Shiprocket ✅
Confirmation email sent ✅
Customer redirected to order-confirmed.html
      ↓
You open Admin Panel → view order → ship it
```

---

## Costs (all pay-per-use, no monthly fees to start)

| Service | Cost |
|---------|------|
| MongoDB Atlas | Free (512MB, plenty for 10,000 orders) |
| Railway hosting | Free tier (500 hrs/month) → ₹500/mo after |
| Razorpay | 2% per transaction (no monthly fee) |
| Shiprocket | ₹20–80 per shipment (weight + distance) |
| Nodemailer via Gmail | Free |
| **Total fixed monthly** | **₹0 to start** |

---

## Need help?

- Razorpay docs: https://razorpay.com/docs/
- Shiprocket API: https://apidocs.shiprocket.in/
- MongoDB Atlas: https://www.mongodb.com/docs/atlas/
- Railway: https://docs.railway.app/

---

*Built for Vriksha Wellness · March 2026*
*vriksha.in · hello@vriksha.in*
