// POST /api/push  { campaign_id, limit? }
// Sends today's batch of qualified leads (with an email) to the sending tool, which runs the sequence.
// SENDER = "smartlead" or "instantly". The campaign must have its sender_campaign_id set.
const { guard, env, body, db, signalLine } = require('../lib/core');

async function toSmartlead(campaignId, leads) {
  const r = await fetch('https://server.smartlead.ai/api/v1/campaigns/' + encodeURIComponent(campaignId) + '/leads?api_key=' + encodeURIComponent(process.env.SENDER_API_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lead_list: leads.map(l => ({ email: l.email, first_name: (l.contact || '').split(' ')[0] || '', last_name: (l.contact || '').split(' ').slice(1).join(' '),
      company_name: l.company, website: l.website || '', phone_number: l.phone || '', location: [l.city, l.state].filter(Boolean).join(', '),
      custom_fields: { trade: l.industry || '', signal_line: signalLine(l), lead_id: l.id } })) }),
  });
  if (!r.ok) throw new Error('Smartlead: ' + (await r.text()).slice(0, 200));
}
async function toInstantly(campaignId, leads) {
  for (const l of leads) {
    const r = await fetch('https://api.instantly.ai/api/v2/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.SENDER_API_KEY },
      body: JSON.stringify({ campaign: campaignId, email: l.email, first_name: (l.contact || '').split(' ')[0] || '', last_name: (l.contact || '').split(' ').slice(1).join(' '),
        company_name: l.company, website: l.website || '', phone: l.phone || '',
        custom_variables: { trade: l.industry || '', city: l.city || '', signal_line: signalLine(l), lead_id: l.id } }),
    });
    if (!r.ok) throw new Error('Instantly: ' + (await r.text()).slice(0, 200));
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!guard(req, res) || !env(res, 'SENDER', 'SENDER_API_KEY')) return;
  try {
    const b = body(req);
    const [camp] = await db('campaigns?id=eq.' + encodeURIComponent(b.campaign_id || ''));
    if (!camp) return res.status(404).json({ error: 'campaign not found' });
    if (!camp.sender_campaign_id) return res.status(400).json({ error: 'set the sending-tool campaign ID on this campaign first' });
    const limit = Math.min(200, Math.max(1, parseInt(b.limit, 10) || camp.daily_target));

    const candidates = await db('leads?select=*&campaign_id=eq.' + camp.id + '&status=eq.Ready%20to%20contact&pushed_at=is.null&email=not.is.null&email=neq.&order=score.desc&limit=' + (limit * 2));
    const blocked = new Set((await db('suppression?select=email')).map(s => s.email));
    const seen = new Set();
    const batch = candidates.filter(l => { const e = l.email.toLowerCase(); if (blocked.has(e) || seen.has(e)) return false; seen.add(e); return true; }).slice(0, limit);
    if (!batch.length) return res.status(200).json({ pushed: 0, note: 'no qualified leads with an email are waiting' });

    const sender = String(process.env.SENDER).toLowerCase();
    if (sender === 'smartlead') await toSmartlead(camp.sender_campaign_id, batch);
    else if (sender === 'instantly') await toInstantly(camp.sender_campaign_id, batch);
    else return res.status(500).json({ error: 'SENDER must be "smartlead" or "instantly"' });

    const now = new Date().toISOString(), ids = batch.map(l => l.id);
    await db('leads?id=in.(' + ids.join(',') + ')', { method: 'PATCH', body: { status: 'Contacted', pushed_at: now, owner: 'Tarush', updated_at: now }, prefer: 'return=minimal' });
    await db('events', { method: 'POST', body: ids.map(id => ({ lead_id: id, kind: 'pushed', detail: 'Added to the ' + sender + ' sequence' })), prefer: 'return=minimal' });
    return res.status(200).json({ pushed: batch.length });
  } catch (e) { return res.status(502).json({ error: e.message }); }
};
