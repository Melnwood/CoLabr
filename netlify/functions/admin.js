// CoLabr — staff admin actions (list / publish-unpublish / delete).
// Passcode-gated with EDIT_KEY. Uses AIRTABLE_TOKEN (read+write scope).

const { sessionFromEvent } = require('./_auth');
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const MIS_TABLE = 'tbli1L8AO0JUDL7Wl';          // Missionaries
const MIS_STYLE = 'fldvLZXckaQVUbD7F';           // Style (single select)
const STYLES = ['Field Notes', 'Cover Grid', 'Timeline', 'Gallery Wall'];
const SITE_MISSIONARY = process.env.SITE_MISSIONARY || 'The Ellenwood Family';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Server not configured.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }
  const editKey = process.env.EDIT_KEY;
  const authed = sessionFromEvent(event) || (editKey && b.key === editKey);
  if (!authed) return resp(401, { error: 'Please sign in.' });

  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;

  try {
    if (b.action === 'list') {
      const r = await fetch(`${api}?pageSize=100`, { headers: auth });
      const data = await r.json();
      if (!r.ok) return resp(r.status, { error: 'Airtable read failed.' });
      const rows = (data.records || []).map(rec => {
        const c = rec.fields || {};
        return {
          id: rec.id,
          title: c['Title'] || '(untitled)',
          date: c['Date'] || '',
          type: c['Type'] || '',
          status: c['Status'] || 'Draft',
          opens: c['Opens'] || 0,
          source: c['Source'] || '',
          aud: c['Audiences'] || [],
          hasCover: !!c['Cover Image URL'],
          hasVideo: !!c['Video URL']
        };
      }).sort((a, b2) => (b2.date).localeCompare(a.date));
      return resp(200, { ok: true, rows });
    }

    if (b.action === 'get') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const r = await fetch(`${api}/${b.id}`, { headers: auth });
      const rec = await r.json();
      if (!r.ok) return resp(r.status, { error: 'Could not load that update.' });
      const c = rec.fields || {};
      let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch {}
      return resp(200, { ok: true, record: {
        id: rec.id, title: c['Title'] || '', date: c['Date'] || '',
        type: c['Type'] || 'Newsletter', audiences: c['Audiences'] || [],
        status: c['Status'] || 'Draft', blocks
      }});
    }

    if (b.action === 'setStatus') {
      if (!b.id || !b.status) return resp(400, { error: 'Missing id/status.' });
      const r = await fetch(api, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: b.id, fields: { Status: b.status } }], typecast: true }) });
      if (!r.ok) return resp(r.status, { error: 'Update failed.' });
      return resp(200, { ok: true });
    }

    if (b.action === 'delete') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const r = await fetch(`${api}/${b.id}`, { method: 'DELETE', headers: auth });
      if (!r.ok) return resp(r.status, { error: 'Delete failed.' });
      return resp(200, { ok: true });
    }

    if (b.action === 'getStyle') {
      const rec = await findMissionary(auth);
      if (!rec) return resp(404, { error: 'Missionary record not found.' });
      const s = rec.fields && rec.fields[MIS_STYLE];
      return resp(200, { ok: true, style: (s && s.name) ? s.name : (s || 'Field Notes'), styles: STYLES });
    }

    if (b.action === 'setStyle') {
      if (!b.style || !STYLES.includes(b.style)) return resp(400, { error: 'Unknown style.' });
      const rec = await findMissionary(auth);
      if (!rec) return resp(404, { error: 'Missionary record not found.' });
      const misApi = `https://api.airtable.com/v0/${BASE}/${MIS_TABLE}`;
      const r = await fetch(misApi, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: rec.id, fields: { [MIS_STYLE]: b.style } }], typecast: true }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return resp(r.status, { error: (e.error && e.error.message) || 'Could not save style.' }); }
      return resp(200, { ok: true, style: b.style });
    }

    if (b.action === 'responses') {
      const RTABLE = 'tblVNMG5VnOnFFeto';
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}?pageSize=100`, { headers: auth });
      const data = await r.json();
      if (!r.ok) return resp(r.status, { error: 'Could not load responses.' });
      const rows = (data.records || []).map(rec => {
        const c = rec.fields || {};
        return {
          id: rec.id,
          name: c['Name'] || 'A supporter',
          type: c['Type'] || 'Note',
          message: c['Message'] || '',
          email: c['Email'] || '',
          isPublic: !!c['Public'],
          read: !!c['Read'],
          updateTitle: c['Update Title'] || '',
          updateId: c['Update ID'] || '',
          created: rec.createdTime
        };
      }).sort((a, b2) => (b2.created || '').localeCompare(a.created || ''));
      return resp(200, { ok: true, rows });
    }

    if (b.action === 'markRead') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const RTABLE = 'tblVNMG5VnOnFFeto';
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}`, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: b.id, fields: { Read: b.read !== false } }], typecast: true }) });
      if (!r.ok) return resp(r.status, { error: 'Update failed.' });
      return resp(200, { ok: true });
    }

    return resp(400, { error: 'Unknown action.' });
  } catch (e) {
    return resp(502, { error: 'Could not reach Airtable.' });
  }

  async function findMissionary(headers) {
    const mf = encodeURIComponent(`{Name}='${SITE_MISSIONARY.replace(/'/g, "\\'")}'`);
    const u = `https://api.airtable.com/v0/${BASE}/${MIS_TABLE}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${mf}`;
    const r = await fetch(u, { headers });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.records || [])[0] || null;
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
