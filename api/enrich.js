// POST /api/enrich  { campaign_id, limit? }
// Looks up an owner email for qualified leads that have a website but no email, using Hunter.
const { guard, env, body, db, logEvent } = require('../lib/core');
const OWNER = /owner|founder|president|ceo|principal|general manager|operations/i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!guard(req, res) || !env(res, 'HUNTER_API_KEY')) return;
  try {
    const b = body(req), limit = Math.min(50, Math.max(1, parseInt(b.limit, 10) || 25));
    const leads = await db('leads?select=id,company,domain&email=is.null&domain=not.is.null&status=eq.Ready%20to%20contact&order=score.desc&limit=' + limit + (b.campaign_id ? '&campaign_id=eq.' + encodeURIComponent(b.campaign_id) : ''));
    let found = 0, generic = 0, none = 0;
    for (const lead of leads) {
      const r = await fetch('https://api.hunter.io/v2/domain-search?limit=10&domain=' + encodeURIComponent(lead.domain) + '&api_key=' + encodeURIComponent(process.env.HUNTER_API_KEY));
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) return res.status(200).json({ checked: found + generic + none, found, generic, none, stopped: 'Hunter rate or credit limit reached' });
      if (!r.ok) throw new Error('Hunter: ' + ((j.errors && j.errors[0] && j.errors[0].details) || r.status));
      const emails = ((j.data && j.data.emails) || []).slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      const pick = emails.find(e => e.type === 'personal' && OWNER.test(e.position || '')) || emails.find(e => e.type === 'personal') || emails[0];
      if (!pick) { none++; await db('leads?id=eq.' + lead.id, { method: 'PATCH', body: { email: '' }, prefer: 'return=minimal' }); continue; }   // '' = looked up, nothing found
      const isGeneric = pick.type !== 'personal';
      await db('leads?id=eq.' + lead.id, { method: 'PATCH', prefer: 'return=minimal', body: {
        email: pick.value, contact: [pick.first_name, pick.last_name].filter(Boolean).join(' ') || null, title: pick.position || null, updated_at: new Date().toISOString() } });
      await logEvent(lead.id, 'enriched', (isGeneric ? 'Generic address found: ' : 'Contact found: ') + pick.value + ' (Hunter confidence ' + (pick.confidence || '?') + ')');
      isGeneric ? generic++ : found++;
    }
    return res.status(200).json({ checked: leads.length, found, generic, none });
  } catch (e) { return res.status(502).json({ error: e.message }); }
};
