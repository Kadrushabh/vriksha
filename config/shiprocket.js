// config/shiprocket.js — Shiprocket API wrapper
const axios = require('axios');

const BASE = 'https://apiv2.shiprocket.in/v1/external';
let cachedToken = null;
let tokenExpiry  = null;

async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  try {
    const res = await axios.post(`${BASE}/auth/login`, {
      email:    process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD
    });
    cachedToken = res.data.token;
    tokenExpiry  = Date.now() + 23 * 60 * 60 * 1000;
    console.log('✅ Shiprocket authenticated:', process.env.SHIPROCKET_EMAIL);
    return cachedToken;
  } catch (err) {
    const detail = err?.response?.data || err?.message;
    console.error('❌ Shiprocket auth FAILED:', JSON.stringify(detail));
    console.error('   Email used:', process.env.SHIPROCKET_EMAIL);
    throw new Error('Shiprocket auth failed: ' + JSON.stringify(detail));
  }
}

function headers(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function createOrder(order) {
  const token = await getToken();
  const payload = {
    order_id:                  order.orderId,
    order_date:                new Date().toISOString().split('T')[0],
    pickup_location:           'Primary',
    channel_id:                process.env.SHIPROCKET_CHANNEL_ID || '',
    billing_customer_name:     order.customer.firstName,
    billing_last_name:         order.customer.lastName || '',
    billing_address:           order.customer.address,
    billing_city:              order.customer.city,
    billing_pincode:           String(order.customer.pincode),
    billing_state:             order.customer.state,
    billing_country:           'India',
    billing_email:             order.customer.email,
    billing_phone:             String(order.customer.phone),
    shipping_is_billing:       true,
    order_items: order.items.map(i => ({
      name:          i.name,
      sku:           String(i.sku || i.productId || 'SKU001'),
      units:         i.quantity,
      selling_price: i.price,
      discount:      0,
      tax:           0
    })),
    payment_method:   order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
    shipping_charges: order.shippingCharge || 0,
    total_discount:   order.discount       || 0,
    sub_total:        order.subtotal,
    length:  20,
    breadth: 15,
    height:  10,
    weight:  0.3
  };

  console.log('📦 Pushing to Shiprocket:', order.orderId);

  try {
    const res = await axios.post(`${BASE}/orders/create/adhoc`, payload, { headers: headers(token) });
    console.log('✅ Shiprocket order pushed! SR Order ID:', res.data?.order_id, '| Shipment ID:', res.data?.shipment_id);
    return res.data;
  } catch (err) {
    const detail = err?.response?.data || err?.message;
    console.error('❌ Shiprocket createOrder FAILED:', JSON.stringify(detail));
    throw new Error(JSON.stringify(detail));
  }
}

async function checkServiceability(pickupPin, deliveryPin, weight = 0.3, cod = false) {
  const token = await getToken();
  const res = await axios.get(`${BASE}/courier/serviceability`, {
    params: { pickup_postcode: pickupPin, delivery_postcode: deliveryPin, weight, cod: cod ? 1 : 0 },
    headers: headers(token)
  });
  return res.data;
}

async function assignAWB(shipmentId, courierId) {
  const token = await getToken();
  const res = await axios.post(`${BASE}/courier/assign/awb`,
    { shipment_id: shipmentId, courier_id: courierId },
    { headers: headers(token) }
  );
  return res.data;
}

async function requestPickup(shipmentId) {
  const token = await getToken();
  const res = await axios.post(`${BASE}/courier/generate/pickup`,
    { shipment_id: [shipmentId] },
    { headers: headers(token) }
  );
  return res.data;
}

async function trackShipment(awbCode) {
  const token = await getToken();
  const res = await axios.get(`${BASE}/courier/track/awb/${awbCode}`, { headers: headers(token) });
  return res.data;
}

async function cancelOrder(shiprocketOrderId) {
  const token = await getToken();
  const res = await axios.post(`${BASE}/orders/cancel`,
    { ids: [shiprocketOrderId] },
    { headers: headers(token) }
  );
  return res.data;
}

module.exports = { createOrder, checkServiceability, assignAWB, requestPickup, trackShipment, cancelOrder };
