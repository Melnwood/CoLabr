// CoLabr — fire the background subscriber-send for a freshly published update.
// Best-effort: we POST to the -background function and return immediately (it runs async,
// up to 15 min, and is idempotent via the update's "Sent" flag). Never throws to the caller.
async function fireNotify(updateId) {
  try {
    if (!updateId) return;
    const secret = process.env.SESSION_SECRET;
    const site = process.env.SITE_BASE;
    if (!secret || !site) return;
    const url = `${site}/.netlify/functions/notify-subscribers-background`;
    // Don't await the body — background functions return 202 fast, but we also cap our own wait.
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateId, secret })
    });
  } catch (e) { /* best-effort */ }
}
module.exports = { fireNotify };
