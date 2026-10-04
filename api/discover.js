// POST /api/discover  { campaign_id }
// Pulls businesses from Google Places for each trade in the campaign, scores them, and saves the new ones.
const { guard, env, body, db, qualify, STATE_NAMES } = require('../lib/core');
const FIELDS = ['id', 'displayName', 'formattedAddress', 'nationalPhoneNumber', 'websiteUri', 'rating', 'userRatingCount', 'businessStatus', 'regularOpeningHours.weekdayDescriptions', 'reviews.text']
  .map(f => 'places.' + f).join(',') + ',nextPageToken';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(textQuery, pageToken) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify(pageToken ? { textQuery, pageSize: 20, pageToken } : { textQuery, pageSize: 20 }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google Places: ' + ((j.error && j.error.message) || r.status));
  return j;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!guard(req, res) || !env(res, 'GOOGLE_PLACES_KEY')) return;
  try {
    const { campaign_id } = body(req);
    const [camp] = await db('campaigns?id=eq.' + encodeURIComponent(campaign_id || ''));
    if (!camp) return res.status(404).json({ error: 'campaign not found' });

    const where = (camp.city ? camp.city + ', ' : '') + (STATE_NAMES[camp.state] || camp.state);
    const rows = new Map();
    for (const trade of camp.trades) {
      let token = null;
      for (let page = 0; page < 3; page++) {              // Google returns at most 60 per query
        const j = await search(trade + ' company in ' + where, token);
        for (const p of j.places || []) if (p.id && !rows.has(p.id)) rows.set(p.id, { ...qualify(p, trade), campaign_id: camp.id });
        token = j.nextPageToken; if (!token) break;
        await sleep(1500);                                // the next-page token takes a moment to become valid
      }
    }
    const all = [...rows.values()].filter(r => !r.state || r.state === camp.state);   // drop results outside the campaign's state
    // on_conflict=place_id + ignore-duplicates: a business already in the system is never added twice
    const saved = all.length ? await db('leads?on_conflict=place_id', { method: 'POST', body: all, prefer: 'resolution=ignore-duplicates,return=representation' }) : [];
    if (saved.length) await db('events', { method: 'POST', body: saved.map(l => ({ lead_id: l.id, kind: 'discovered', detail: 'Found on Google Places and scored ' + l.score })), prefer: 'return=minimal' });
    await db('campaigns?id=eq.' + camp.id, { method: 'PATCH', body: { status: 'Active' }, prefer: 'return=minimal' });

    return res.status(200).json({
      found: all.length, added: saved.length, already_known: all.length - saved.length,
      qualified: saved.filter(l => l.status === 'Ready to contact').length,
      disqualified: saved.filter(l => l.status === 'Disqualified').length,
    });
  } catch (e) { return res.status(502).json({ error: e.message }); }
};
