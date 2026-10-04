// GET   /api/leads?campaign_id=…   list leads (most recent 5,000)
// PATCH /api/leads                  update { id, status?, owner?, note?, meeting? }
const { guard, body, db, logEvent } = require('../lib/core');
const STATUSES = ['Not contacted', 'Ready to contact', 'Contacted', 'Awaiting response', 'Follow-up scheduled', 'Replied', 'Needs you', 'Meeting booked', 'Not interested', 'Disqualified'];

module.exports = async (req, res) => {
  if (!guard(req, res)) return;
  try {
    if (req.method === 'GET') {
      const c = req.query && req.query.campaign_id;
      const leads = await db('leads?select=*&order=created_at.desc&limit=5000' + (c ? '&campaign_id=eq.' + encodeURIComponent(c) : ''));
      return res.status(200).json({ leads });
    }
    if (req.method === 'PATCH') {
      const b = body(req);
      if (!b.id) return res.status(400).json({ error: 'id is required' });
      const patch = { updated_at: new Date().toISOString() };
      if (b.status) { if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'unknown status' }); patch.status = b.status; }
      if (b.owner) patch.owner = String(b.owner);
      if (b.meeting) patch.meeting_at = new Date().toISOString();
      const [row] = await db('leads?id=eq.' + encodeURIComponent(b.id), { method: 'PATCH', body: patch });
      if (!row) return res.status(404).json({ error: 'lead not found' });
      if (b.status) await logEvent(row.id, 'status', 'Set to ' + b.status + ' by a person');
      if (b.note) await logEvent(row.id, 'note', String(b.note).slice(0, 2000));
      if (b.status === 'Not interested' && row.email) await db('suppression', { method: 'POST', body: { email: row.email.toLowerCase(), reason: 'not interested' }, prefer: 'resolution=ignore-duplicates,return=minimal' });
      return res.status(200).json({ lead: row });
    }
    return res.status(405).json({ error: 'GET or PATCH' });
  } catch (e) { return res.status(502).json({ error: e.message }); }
};
