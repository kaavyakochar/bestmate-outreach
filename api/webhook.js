// POST /api/webhook?secret=…
// The sending tool calls this when an email is sent, replied to, or bounces.
// A reply stops being automated: the lead moves to "Needs you" with the reply text attached.
const { env, body, db, logEvent } = require('../lib/core');

function classify(text) {
  const t = String(text || '').toLowerCase();
  if (/unsubscribe|remove me|take me off|not interested|no thanks|stop emailing|do not contact/.test(t)) return 'notint';
  if (/price|pricing|cost|how much|what does (this|it) run/.test(t)) return 'pricing';
  if (/already (use|have)|we use |happy with|don'?t need/.test(t)) return 'objection';
  if (/\?/.test(t)) return 'question';
  return 'interested';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!env(res, 'WEBHOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')) return;
  if ((req.query && req.query.secret) !== process.env.WEBHOOK_SECRET) return res.status(401).json({ error: 'wrong secret' });
  try {
    const b = body(req);
    // Smartlead and Instantly name these fields differently; accept either.
    const email = String(b.lead_email || b.to_email || b.sl_lead_email || (b.lead && b.lead.email) || b.email || '').trim().toLowerCase();
    const event = String(b.event_type || b.event || '').toLowerCase();
    const text = String(b.reply_text || b.reply_text_snippet || (b.reply_message && (b.reply_message.text || b.reply_message.html)) || b.preview_text || b.reply_body || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 4000);
    if (!email) return res.status(200).json({ ok: true, ignored: 'no lead email in payload' });

    const [lead] = await db('leads?email=ilike.' + encodeURIComponent(email) + '&order=pushed_at.desc.nullslast&limit=1');
    if (!lead) return res.status(200).json({ ok: true, ignored: 'no matching lead' });
    const now = new Date().toISOString();

    if (/repl/.test(event)) {
      const type = classify(text);
      const status = type === 'notint' ? 'Not interested' : 'Needs you';
      await db('leads?id=eq.' + lead.id, { method: 'PATCH', prefer: 'return=minimal', body: { status, reply_text: text, reply_type: type, reply_at: now, updated_at: now } });
      await logEvent(lead.id, 'reply', text.slice(0, 500), b);
      if (type === 'notint') await db('suppression', { method: 'POST', body: { email, reason: 'asked to stop' }, prefer: 'resolution=ignore-duplicates,return=minimal' });
      return res.status(200).json({ ok: true, status });
    }
    if (/bounce/.test(event)) {
      await db('leads?id=eq.' + lead.id, { method: 'PATCH', prefer: 'return=minimal', body: { email: '', status: 'Ready to contact', pushed_at: null, updated_at: now } });
      await logEvent(lead.id, 'bounce', 'Email bounced: ' + email, b);
      await db('suppression', { method: 'POST', body: { email, reason: 'bounced' }, prefer: 'resolution=ignore-duplicates,return=minimal' });
      return res.status(200).json({ ok: true, status: 'bounced' });
    }
    if (/sent/.test(event)) {
      const step = parseInt(b.sequence_number || b.step || 1, 10) || 1;
      const patch = { last_contact_at: now, updated_at: now };
      if (['Contacted', 'Follow-up scheduled', 'Awaiting response', 'Ready to contact'].includes(lead.status)) patch.status = step > 1 ? 'Follow-up scheduled' : 'Contacted';
      await db('leads?id=eq.' + lead.id, { method: 'PATCH', prefer: 'return=minimal', body: patch });
      await logEvent(lead.id, 'sent', 'Email ' + step + ' sent');
      return res.status(200).json({ ok: true, status: 'sent' });
    }
    await logEvent(lead.id, 'status', 'Sending tool event: ' + (event || 'unknown'), b);
    return res.status(200).json({ ok: true, ignored: 'event not handled: ' + event });
  } catch (e) { return res.status(502).json({ error: e.message }); }
};
