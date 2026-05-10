import nodemailer from "nodemailer";

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

export async function sendEmailMessage({ to, message }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("SMTP is not configured");
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: process.env.COMPANY_FROM_EMAIL || process.env.SMTP_USER,
    to,
    subject: process.env.COMPANY_EMAIL_SUBJECT || "New Space Properties Update",
    text: message,
  });
  return { messageId: info.messageId };
}

export async function sendWhatsAppMessage({ to, message }) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WhatsApp Cloud API is not configured");
  }
  const recipient = normalizePhone(to);
  if (!recipient) throw new Error("Client phone number is missing");

  const resp = await fetch(
    `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: { body: message },
      }),
    }
  );

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error?.message || "Failed to send WhatsApp message");
  }
  return { messageId: data?.messages?.[0]?.id || null };
}
