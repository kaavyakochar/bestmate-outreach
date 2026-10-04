// POST /api/send  { to, subject, text }
// Sends one plain-text email from the Gmail account set in Vercel's environment variables.
// Required env vars: GMAIL_USER, GMAIL_APP_PASSWORD, ALLOWED_RECIPIENTS (comma-separated).
// Optional: SENDER_NAME (defaults to "Tarush Bali").
const nodemailer = require('nodemailer');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { GMAIL_USER, GMAIL_APP_PASSWORD, ALLOWED_RECIPIENTS, SENDER_NAME } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return res.status(500).json({ error: 'mailbox is not configured (set GMAIL_USER and GMAIL_APP_PASSWORD)' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};
  const to = String(body.to || '').trim().toLowerCase();
  const subject = String(body.subject || '').replace(/[\r\n]+/g, ' ').trim();
  const text = String(body.text || '').trim();

  if (!EMAIL.test(to)) return res.status(400).json({ error: 'invalid recipient address' });
  if (!subject || subject.length > 200) return res.status(400).json({ error: 'subject is missing or too long' });
  if (!text || text.length > 5000) return res.status(400).json({ error: 'message is missing or too long' });

  // The endpoint is public, so it only ever sends to addresses you have approved.
  const allowed = String(ALLOWED_RECIPIENTS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(to)) {
    return res.status(403).json({ error: 'recipient is not on the approved list (ALLOWED_RECIPIENTS)' });
  }

  try {
    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
    });
    const info = await transport.sendMail({
      from: { name: SENDER_NAME || 'Tarush Bali', address: GMAIL_USER },
      to, subject, text,
    });
    return res.status(200).json({ ok: true, id: info.messageId });
  } catch (err) {
    return res.status(502).json({ error: 'Gmail rejected the send: ' + (err && err.message ? err.message : 'unknown error') });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
