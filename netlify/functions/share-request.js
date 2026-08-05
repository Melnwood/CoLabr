// Co-Labr — a signed-in JV staff member asks to feature another teammate's update on their own
// supporter wall. Creates a Pending Feature Share, routed to the update's author for approval.
const { sessionFromEvent } = require('./_auth');
const { BASE, UPDATES, missByEmail, missById } = require('./_shares');
const SHARES = 'tblKLXrYICtkiSp40';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return resp(401, { error: 'Please sign in to share.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Server not configured.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }
  if (!b.updateId) return resp(400, { error: 'Missing update.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    // Look up the update being shared.
    const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}/${b.updateId}`, { headers: auth });
    if (!ur.ok) return resp(404, { error: 'That update could not be found.' });
    const uf = (await ur.json()).fields || {};
    const title = uf['Title'] || (b.title || ''); const cover = uf['Cover Image URL'] || (b.cover || ''); const excerpt = uf['Excerpt'] || '';
    let author = '', country = '', authorPhoto = '';
    const mission = uf['Missionary'];
    if (Array.isArray(mission) && mission.length) { const m = await missById(auth, mission[0]); if (m) { author = m.name; country = m.country; authorPhoto = m.photo || ''; } }

    // The requester is the signed-in member → their own page.
    const me = await missByEmail(auth, session.email);
    const requesterPage = me ? me.name : (session.name || session.email);

    // Don't let someone request to feature their own update on their own page.
    if (author && requesterPage && author === requesterPage) return resp(400, { error: "That's already your own update." });

    // The president's notes are already public JV stories — no approval needed,
    // they land on the requester's wall immediately.
    const autoApproved = author === 'Dave Patty';
    // His cards wear the series name, not his job title.
    if (autoApproved) country = "President's Monthly";
    const fields = {
      'Label': (session.name || 'Someone') + ' → ' + (author || 'update'),
      'Update ID': b.updateId, 'Update Title': title, 'Excerpt': excerpt, 'Cover URL': cover,
      'Author': author || '', 'Country': country || '', 'Author Photo': authorPhoto || '',
      'Requester Page': requesterPage, 'Requester Name': session.name || '', 'Requester Email': session.email || '',
      'Status': autoApproved ? 'Approved' : 'Pending'
    };
    const cr = await fetch(`https://api.airtable.com/v0/${BASE}/${SHARES}`, { method: 'POST', headers: auth, body: JSON.stringify({ records: [{ fields }], typecast: true }) });
    if (!cr.ok) { const t = await cr.text(); return resp(502, { error: 'Could not save the request. ' + t.slice(0, 80) }); }
    return resp(200, { ok: true, author: author || 'the author', approved: autoApproved });
  } catch (e) {
    return resp(502, { error: 'Something went wrong.' });
  }
};

function resp(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
