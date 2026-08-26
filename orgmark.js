// Co·labr — put the right organisation on the header of a working page.
//
// The wall and the prayer page already know whose org they belong to, because the
// page itself belongs to a missionary. A dashboard does not: it belongs to whoever
// is signed in. So it asks, once, and swaps the mark and the link it sits in.
//
// Include at the end of <body> on any page whose header carries the Josiah Venture
// wordmark as its default. Silent by design: with no org, no logo, or no answer at
// all, the page simply keeps the default it shipped with.
(function () {
  function normalise(u) {
    const s = String(u || '').trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : 'https://' + s;   // a bare domain is not a path
  }
  async function run() {
    const img = document.querySelector('.jvlogo');
    if (!img) return;
    let me;
    try {
      const r = await fetch('/.netlify/functions/me?full=1');
      if (!r.ok) return;
      me = await r.json();
    } catch (_) { return; }
    const m = (me && me.miss) || {};
    if (m.orgLogo) { img.src = m.orgLogo; img.alt = m.orgName || m.org || 'Our organisation'; }
    const site = normalise(m.orgSite);
    const a = img.closest('a');
    if (a && site) { a.href = site; a.title = m.orgName || m.org || 'Our organisation'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
