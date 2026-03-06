// config/shiprocket.js  —  Shiprocket API wrapper
const axios = require('axios');

const BASE = 'https://apiv2.shiprocket.in/v1/external';

let cachedToken = null;
let tokenExpiry  = null;

// ── Auth ──────────────────────────────────────────────────────────────
async function getToken() {
  // Re-use token for 24 hours (Shiprocket tokens last ~24h)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  const res = await axios.post(`${BASE}/auth/login`, {
    email:    process.env.SHIPROCKET_EMAIL,
    password: process.env.SHIPROCKET_PASSWORD
  });
  cachedToken = res.data.token;
  tokenExpiry  = Date.now() + 23 * 60 * 60 * 1000; // 23 hours
  return cachedToken;
}

function headers(token) {
  return {
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${token}`
  };
}

// ── Create order in Shiprocket ────────────────────────────────────────
async function createOrder(order) {
  const token = await getToken();

  const payload = {
    order_id:           order.orderId,
    order_date:         new Date().toISOString().split('T')[0],
    pickup_location:    'Primary',          // Must match your Shiprocket pickup address name
    billing_customer_name:  order.customer.firstName,
    billing_last_name:      order.customer.lastName,
    billing_address:        order.customer.address,
    billing_city:           order.customer.city,
    billing_pincode:        order.customer.pincode,
    billing_state:          order.customer.state,
    billing_country:        'India',
    billing_email:          order.customer.email,
    billing_phone:          order.customer.phone,
    shipping_is_billing:    true,
    order_items: order.items.map(i => ({
      name:          i.name,
      sku:           i.sku || i.productId,
      units:         i.quantity,
      selling_price: i.price,
      discount:      0,
      tax:           0
    })),
    payment_method:   order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
    shipping_charges: order.shippingCharge || 0,
    total_discount:   order.discount       || 0,
    sub_total:        order.subtotal,
    // Package dimensions — update to match your actual packaging
    length:  20,
    breadth: 15,
    height:  10,
    weight:  0.3   // kg — update per product
  };

  const res = await axios.post(`${BASE}/orders/create/adhoc`, payload, { headers: headers(token) });
  return res.data;
}

// ── Check courier serviceability ──────────────────────────────────────
async function checkServiceability(pickupPin, deliveryPin, weight = 0.3, cod = false) {
  const token = await getToken();
  const res = await axios.get(`${BASE}/courier/serviceability`, {
    params: {
      pickup_postcode:   pickupPin,
      delivery_postcode: deliveryPin,
      weight,
      cod: cod ? 1 : 0
    },
    headers: headers(token)
  });
  return res.data;
}

// ── Assign AWB (courier) ──────────────────────────────────────────────
async function assignAWB(shipmentId, courierId) {
  const token = await getToken();
  const res = await axios.post(`${BASE}/courier/assign/awb`,
    { shipment_id: shipmentId, courier_id: courierId },
    { headers: headers(token) }
  );
  return res.data;
}

// ── Request pickup ────────────────────────────────────────────────────
async function requestPickup(shipmentId) {
  const token = await getToken();
  const res = await axios.post(`${BASE}/courier/generate/pickup`,
    { shipment_id: [shipmentId] },
    { headers: headers(token) }
  );
  return res.data;
}

// ── Track shipment ────────────────────────────────────────────────────
async function trackShipment(awbCode) {
  const token = await getToken();
  const res = await axios.get(`${BASE}/courier/track/awb/${awbCode}`,
    { headers: headers(token) }
  );
  return res.data;
}

// ── Cancel order ──────────────────────────────────────────────────────
async function cancelOrder(shiprocketOrderId) {
  const token = await getToken();
  const res = await axios.post(`${BASE}/orders/cancel`,
    { ids: [shiprocketOrderId] },
    { headers: headers(token) }
  );
  return res.data;
}

module.exports = { createOrder, checkServiceability, assignAWB, requestPickup, trackShipment, cancelOrder };
