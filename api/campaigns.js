// GET  /api/campaigns            list campaigns
// POST /api/campaigns            create  { name?, trades[], state, city?, daily_target? }
// PATCH /api/campaigns           update  { id, status?, sender_campaign_id?, daily_target? }
const { guard, body, db, STATE_NAMES } = require('../lib/core');

module.exports = async (req, res) => {
  if (!guard(req, res)) return;
  try {
    if (req.method === 'GET') return res.status(200).json({ campaigns: await db('campaigns?select=*&order=created_at.asc') });

    const b = body(req);
    if (req.method === 'POST') {
      const trades = Array.isArray(b.trades) ? b.trades.map(String).filter(Boolean) : [];
      const state = String(b.state || '').toUpperCase(), city = String(b.city || '').trim();
      if (!trades.length) return res.status(400).json({ error: 'pick at least one trade' });
      if (!STATE_NAMES[state]) return res.status(400).json({ error: 'unknown state' });
      const target = Math.min(200, Math.max(1, parseInt(b.daily_target, 10) || 25));
      const name = String(b.name || '').trim() || (trades.length > 2 ? trades.length + ' trades' : trades.join(' + ')) + ' · ' + (city ? city + ', ' + state : STATE_NAMES[state]);
      const [row] = await db('campaigns', { method: 'POST', body: { name, trades, state, city, daily_target: target } });
      return res.status(200).json({ campaign: row });
    }
    if (req.method === 'PATCH') {
      if (!b.id) return res.status(400).json({ error: 'id is required' });
      const patch = {};
      if (b.status) patch.status = String(b.status);
      if (b.sender_campaign_id !== undefined) patch.sender_campaign_id = String(b.sender_campaign_id).trim() || null;
      if (b.daily_target) patch.daily_target = Math.min(200, Math.max(1, parseInt(b.daily_target, 10) || 25));
      const [row] = await db('campaigns?id=eq.' + encodeURIComponent(b.id), { method: 'PATCH', body: patch });
      return res.status(200).json({ campaign: row });
    }
    return res.status(405).json({ error: 'GET, POST or PATCH' });
  } catch (e) { return res.status(502).json({ error: e.message }); }
};
