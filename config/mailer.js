// config/mailer.js  —  Order confirmation emails
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS   // Use Gmail App Password
  }
});

function orderConfirmationHTML(order) {
  const itemsHTML = order.items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #EDE5D4;font-family:Georgia,serif;color:#2D4A2D;">${i.name}</td>
      <td style="padding:8px 0;border-bottom:1px solid #EDE5D4;text-align:center;color:#5C7A4E;">${i.quantity}</td>
      <td style="padding:8px 0;border-bottom:1px solid #EDE5D4;text-align:right;color:#2D4A2D;">₹${i.totalPrice}</td>
    </tr>`).join('');

  return `
  <!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#1a1a18;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#F5F0E8;border-radius:8px;overflow:hidden;">

    <!-- Header -->
    <div style="background:#2D4A2D;padding:32px;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:28px;color:#F5F0E8;letter-spacing:0.15em;">❧ VRIKSHA</div>
      <div style="color:#A07840;font-size:11px;letter-spacing:0.3em;margin-top:6px;">ROOTED IN ANCIENT WISDOM</div>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="font-family:Georgia,serif;font-size:18px;color:#2D4A2D;margin:0 0 8px;">
        Thank you, ${order.customer.firstName}. 🌿
      </p>
      <p style="color:#5C7A4E;font-size:13px;margin:0 0 24px;line-height:1.6;">
        Your order has been confirmed. We're preparing it with care and will dispatch it soon.
      </p>

      <!-- Order ID -->
      <div style="background:#EDE5D4;border-radius:4px;padding:12px 16px;margin-bottom:24px;">
        <span style="font-size:11px;letter-spacing:0.2em;color:#A07840;text-transform:uppercase;">Order ID</span>
        <div style="font-family:Georgia,serif;font-size:16px;color:#2D4A2D;font-weight:bold;margin-top:4px;">${order.orderId}</div>
      </div>

      <!-- Items table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <thead>
          <tr>
            <th style="text-align:left;font-size:10px;letter-spacing:0.2em;color:#A07840;text-transform:uppercase;padding-bottom:8px;">Product</th>
            <th style="text-align:center;font-size:10px;letter-spacing:0.2em;color:#A07840;text-transform:uppercase;padding-bottom:8px;">Qty</th>
            <th style="text-align:right;font-size:10px;letter-spacing:0.2em;color:#A07840;text-transform:uppercase;padding-bottom:8px;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemsHTML}</tbody>
      </table>

      <!-- Totals -->
      <div style="border-top:1px solid #A07840;padding-top:12px;">
        ${order.discount > 0 ? `<div style="display:flex;justify-content:space-between;color:#5C7A4E;font-size:13px;margin-bottom:4px;"><span>Discount</span><span>−₹${order.discount}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;color:#5C7A4E;font-size:13px;margin-bottom:4px;"><span>Shipping</span><span>${order.shippingCharge === 0 ? 'Free' : '₹'+order.shippingCharge}</span></div>
        <div style="display:flex;justify-content:space-between;font-family:Georgia,serif;font-size:17px;color:#2D4A2D;font-weight:bold;margin-top:8px;"><span>Total</span><span>₹${order.total}</span></div>
      </div>

      <!-- Shipping address -->
      <div style="margin-top:24px;padding:16px;border:1px solid #EDE5D4;border-radius:4px;">
        <div style="font-size:10px;letter-spacing:0.2em;color:#A07840;text-transform:uppercase;margin-bottom:8px;">Delivering To</div>
        <div style="color:#2D4A2D;font-size:13px;line-height:1.7;">
          ${order.customer.firstName} ${order.customer.lastName}<br>
          ${order.customer.address}<br>
          ${order.customer.city}, ${order.customer.state} — ${order.customer.pincode}<br>
          ${order.customer.phone}
        </div>
      </div>

      <p style="color:#888;font-size:11px;margin-top:24px;line-height:1.6;">
        You'll receive a tracking link once your order is dispatched. For any questions, reply to this email or write to <a href="mailto:${process.env.BRAND_EMAIL}" style="color:#5C7A4E;">${process.env.BRAND_EMAIL}</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#2D4A2D;padding:20px;text-align:center;">
      <div style="color:#A07840;font-size:10px;letter-spacing:0.2em;">vriksha.in &nbsp;·&nbsp; hello@vriksha.in</div>
      <div style="color:#5C7A4E;font-size:10px;margin-top:4px;">Be rooted. Be honest. Be remarkable.</div>
    </div>
  </div>
  </body></html>`;
}

async function sendOrderConfirmation(order) {
  try {
    await transporter.sendMail({
      from:    `"${process.env.BRAND_NAME}" <${process.env.SMTP_USER}>`,
      to:      order.customer.email,
      subject: `✅ Order Confirmed — ${order.orderId} | Vriksha`,
      html:    orderConfirmationHTML(order)
    });
    console.log(`✉️  Confirmation sent to ${order.customer.email}`);
  } catch (err) {
    // Email failure should NOT break order processing
    console.error('Email send failed:', err.message);
  }
}

async function sendShippingUpdate(order) {
  try {
    await transporter.sendMail({
      from:    `"${process.env.BRAND_NAME}" <${process.env.SMTP_USER}>`,
      to:      order.customer.email,
      subject: `🚚 Your Vriksha order is on its way — ${order.orderId}`,
      html: `
        <div style="font-family:Arial;max-width:560px;margin:0 auto;padding:32px;background:#F5F0E8;">
          <div style="font-family:Georgia,serif;font-size:24px;color:#2D4A2D;">❧ VRIKSHA</div>
          <h2 style="color:#2D4A2D;font-family:Georgia,serif;">Your order is on its way 🌿</h2>
          <p style="color:#5C7A4E;">Order <strong>${order.orderId}</strong> has been dispatched via <strong>${order.shiprocket?.courierName || 'our courier partner'}</strong>.</p>
          ${order.shiprocket?.trackingUrl ? `<a href="${order.shiprocket.trackingUrl}" style="display:inline-block;background:#2D4A2D;color:#F5F0E8;padding:12px 24px;border-radius:4px;text-decoration:none;font-size:13px;margin-top:12px;">Track Your Order →</a>` : ''}
          ${order.shiprocket?.awbCode ? `<p style="color:#888;font-size:12px;margin-top:16px;">AWB: ${order.shiprocket.awbCode}</p>` : ''}
        </div>`
    });
  } catch (err) {
    console.error('Shipping email failed:', err.message);
  }
}

module.exports = { sendOrderConfirmation, sendShippingUpdate };
