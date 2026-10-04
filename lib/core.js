// Shared helpers for the API routes: Supabase access, the admin-key check, and ICP scoring.
const SUNBELT = ['TX', 'FL', 'AZ', 'GA', 'NC'];
const CORE_TRADES = ['HVAC', 'Plumbing', 'Electrical', 'Roofing'];
const STATE_NAMES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };
const FRANCHISE = /aire serv|one hour (heating|air)|mr\.? rooter|roto-rooter|mr\.? electric|benjamin franklin plumbing|mister sparky|service experts|rescue rooter|mr\.? handyman|merry maids|molly maid|servpro|terminix|orkin|truly nolen/i;
const COMPLAINT = /call(ed)? back|never (called|showed|heard)|no[- ]show|voicemail|hard to reach|couldn'?t reach|didn'?t (return|answer|show)|resched/i;

function env(res, ...names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) { res.status(500).json({ error: 'not configured: set ' + missing.join(', ') + ' in Vercel' }); return false; }
  return true;
}

// Every route except the webhook requires the admin key the dashboard sends.
function guard(req, res) {
  if (!env(res, 'ADMIN_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')) return false;
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) { res.status(401).json({ error: 'wrong or missing admin key' }); return false; }
  return true;
}

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

// Thin wrapper over Supabase's REST interface, so there is no library to install.
async function db(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: prefer || 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error('database: ' + text.slice(0, 300));
  return text ? JSON.parse(text) : [];
}

const logEvent = (lead_id, kind, detail, payload) => db('events', { method: 'POST', body: { lead_id, kind, detail, payload: payload || null }, prefer: 'return=minimal' });

function domainOf(url) {
  try { return new URL(/^https?:/.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

// Turn one Google Places result into a scored lead row.
// Scoring uses only what Google provides; website, hiring and ownership checks come later.
function qualify(place, trade) {
  const name = (place.displayName && place.displayName.text) || 'Unknown';
  const n = place.userRatingCount || 0;
  const hours = (place.regularOpeningHours && place.regularOpeningHours.weekdayDescriptions) || [];
  const parts = String(place.formattedAddress || '').split(',').map(s => s.trim());
  const city = parts.length >= 3 ? parts[parts.length - 3] : '';
  const state = parts.length >= 2 ? (parts[parts.length - 2].split(' ')[0] || '') : '';
  const reviewTexts = (place.reviews || []).map(r => (r.text && r.text.text) || '');

  let dq = null;
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') dq = 'Not operating (' + place.businessStatus.toLowerCase().replace(/_/g, ' ') + ')';
  else if (FRANCHISE.test(name)) dq = 'Franchise location';
  else if (n > 3000) dq = 'Likely over 50 employees (' + n.toLocaleString('en-US') + ' Google reviews)';
  else if (n < 5 && !place.websiteUri) dq = 'Under 5 reviews and no website';
  else if (place.rating && place.rating < 3.5) dq = 'Rating below 3.5';

  const segment = n >= 100 && n <= 500 ? 'P1' : n > 500 ? 'L2' : 'L1';
  const size = n >= 100 && n <= 500 ? 10 : n > 500 ? 4 : n >= 50 ? 5 : 0;
  const fit = (CORE_TRADES.includes(trade) ? 15 : 9) + (SUNBELT.includes(state) ? 8 : 4) + 6 + size;
  const open24 = hours.length === 7 && hours.every(h => /24 hours/i.test(h));
  const afterHours = hours.length > 0 && !open24;
  const complaint = reviewTexts.some(t => COMPLAINT.test(t));
  const signal_pts = (afterHours ? 10 : 0) + (complaint ? 12 : 0);
  const score = dq ? 0 : Math.round(100 * (fit + signal_pts) / 61);
  const signal = complaint ? 'Reviews: hard to reach' : afterHours ? 'Closed after hours' : '';
  const tier = dq ? 'Disqualified' : score >= 70 ? 'High' : score >= 50 ? 'Medium' : 'Low';

  const closed = hours.filter(h => /closed/i.test(h)).map(h => h.split(':')[0]);
  const found = [
    n.toLocaleString('en-US') + ' Google reviews' + (place.rating ? ', ' + place.rating + ' rating' : ''),
    open24 ? 'Listed as open 24 hours, 7 days' : hours.length ? 'Listed hours: ' + hours[0] + (closed.length ? '; closed ' + closed.join(', ') : '') : 'No hours listed',
    place.websiteUri ? 'Website: ' + domainOf(place.websiteUri) : 'No website on the listing',
  ];
  if (complaint) found.push('A recent review mentions trouble reaching the office or a missed appointment');

  return {
    place_id: place.id, company: name, industry: trade, city, state,
    phone: place.nationalPhoneNumber || null, website: place.websiteUri || null, domain: place.websiteUri ? domainOf(place.websiteUri) : null,
    rating: place.rating || null, reviews: n, hours,
    segment, fit, signal_pts, score, tier, signal, found, dq_reason: dq,
    why: dq ? 'Disqualified: ' + dq + '.' : 'Score ' + score + ' from the checks possible with Google data: trade, market, size, listed hours and review complaints.' + (signal ? ' Primary signal: ' + signal.toLowerCase() + '.' : ' No pain signal yet; qualified on size and trade.'),
    status: dq ? 'Disqualified' : score >= 50 ? 'Ready to contact' : 'Not contacted',
  };
}

// The sentence email 2 uses, by signal. Kept here so the sending tool only needs {{signal_line}}.
function signalLine(lead) {
  const c = lead.company;
  return ({
    'Closed after hours': c + "'s Google listing shows set office hours rather than 24/7, which is exactly the window this pilot is about.",
    'Reviews: hard to reach': c + "'s reviews are strong. The few that aren't are about getting a call back, which is the exact gap this pilot is about.",
  })[lead.signal] || '';
}

module.exports = { env, guard, body, db, logEvent, qualify, signalLine, domainOf, STATE_NAMES };
