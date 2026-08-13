/* Sandbox feedback module — the drop-in reporter.
 *
 *   <script src="/sandbox-widget.js" data-project="colabr" defer></script>
 *
 * Optional attributes:
 *   data-endpoint       where the function lives   (default /.netlify/functions/sandbox-report)
 *   data-label          button text                (default "Report a problem")
 *   data-accent         button colour              (default #FF6600)
 *   data-position       left | right               (default right)
 *   data-require-invite "1" to show only to people who arrived on an invite link
 *
 * Everything lives in a shadow root, so the host page's CSS and this widget's
 * CSS can never collide. No dependencies.
 */
(function () {
  if (window.__sandboxWidget) return;
  window.__sandboxWidget = true;

  var me = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) if (/sandbox-widget\.js/.test(all[i].src)) return all[i];
    return null;
  })();
  var d = (me && me.dataset) || {};
  var CFG = {
    endpoint: d.endpoint || '/.netlify/functions/sandbox-report',
    label: d.label || 'Report a problem',
    accent: d.accent || '#FF6600',
    left: (d.position || 'right') === 'left',
    inviteOnly: d.requireInvite === '1' || d.requireInvite === 'true'
  };

  /* --- the last few things that went wrong, so a report carries its own evidence --- */
  var ERRORS = [];
  function noteError(text) { ERRORS.push(String(text).slice(0, 200)); if (ERRORS.length > 5) ERRORS.shift(); }
  window.addEventListener('error', function (e) { noteError((e.message || 'Error') + ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || 0)); });
  window.addEventListener('unhandledrejection', function (e) { noteError('Unhandled: ' + ((e.reason && (e.reason.message || e.reason)) || '')); });

  /* ------------------------------ who is reporting ------------------------------- */
  var store = {
    get: function (k) { try { return localStorage.getItem('sbx.' + k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { localStorage.setItem('sbx.' + k, v); } catch (e) {} }
  };
  // An invite link (?sbx=…) names its holder. Keep it, then tidy the address bar.
  var qs = new URLSearchParams(location.search);
  if (qs.get('sbx')) {
    store.set('token', qs.get('sbx'));
    qs.delete('sbx');
    history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash);
  }
  var TOKEN = store.get('token');
  if (CFG.inviteOnly && !TOKEN) return;

  var WHO = { name: store.get('name'), email: store.get('email'), via: TOKEN ? 'invite' : '' };

  /* ---------------------------------- the shell ---------------------------------- */
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483000;' + (CFG.left ? 'left:0;' : 'right:0;') + 'bottom:0;width:0;height:0';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  root.innerHTML =
    '<style>' +
    ':host,*{box-sizing:border-box}' +
    '.f{font:600 13.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
    '#btn{position:fixed;bottom:20px;' + (CFG.left ? 'left:20px' : 'right:20px') + ';display:flex;align-items:center;gap:8px;background:' + CFG.accent + ';color:#fff;border:none;border-radius:24px;padding:12px 18px;cursor:pointer;box-shadow:0 10px 28px rgba(20,15,10,.28)}' +
    '#btn:hover{filter:brightness(1.06)}' +
    '#btn svg{width:16px;height:16px;stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}' +
    '#panel{display:none;position:fixed;bottom:20px;' + (CFG.left ? 'left:20px' : 'right:20px') + ';width:min(380px,calc(100vw - 24px));max-height:min(620px,calc(100vh - 40px));background:#fff;color:#241f1b;border-radius:16px;box-shadow:0 26px 70px rgba(20,15,10,.32);flex-direction:column;overflow:hidden}' +
    '#panel.on{display:flex}' +
    'header{background:#241f1b;color:#fff;padding:13px 16px;display:flex;align-items:center;gap:10px}' +
    'header b{font-size:13.5px}' +
    'header small{display:block;font-weight:500;opacity:.7;font-size:11px;margin-top:2px}' +
    '#x{margin-left:auto;background:none;border:none;color:#fff;opacity:.75;font-size:17px;cursor:pointer;padding:2px 4px;line-height:1}' +
    '.body{padding:14px 16px 16px;overflow-y:auto}' +
    'label{display:block;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8a8178;margin:0 0 5px}' +
    'input,textarea{width:100%;border:1px solid #e2ddd5;border-radius:10px;padding:10px 12px;font:400 13.5px/1.5 inherit;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;outline:none;background:#fff;color:#241f1b}' +
    'input:focus,textarea:focus{border-color:' + CFG.accent + '}' +
    'textarea{min-height:104px;resize:vertical}' +
    '.two{display:flex;gap:8px;margin-bottom:10px}' +
    '.two input{width:50%}' +
    '#drop{margin:10px 0;border:1.5px dashed #ddd6cc;border-radius:12px;padding:14px;text-align:center;cursor:pointer;font-size:12.5px;color:#8a8178;font-weight:600}' +
    '#drop.over{border-color:' + CFG.accent + ';background:#fff8f2}' +
    '#thumb{display:none;max-height:110px;max-width:100%;border-radius:9px;border:1px solid #e2ddd5;margin:0 auto 4px}' +
    '#send{width:100%;background:' + CFG.accent + ';color:#fff;border:none;border-radius:11px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit}' +
    '#send:disabled{opacity:.5;cursor:default}' +
    '#out{font-size:12.5px;line-height:1.5;margin-top:10px;color:#8a8178;font-weight:600}' +
    '#out.bad{color:#c0392b}' +
    '.done{padding:26px 20px;text-align:center}' +
    '.done h3{margin:10px 0 6px;font-size:16px}' +
    '.done p{margin:0;font-size:13px;color:#7a756f;line-height:1.55}' +
    '.tick{width:46px;height:46px;border-radius:50%;background:#eafaf1;color:#2f7d55;display:flex;align-items:center;justify-content:center;margin:0 auto;font-size:23px}' +
    '.again{margin-top:16px;background:none;border:1px solid #e2ddd5;border-radius:10px;padding:9px 15px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;color:#241f1b}' +
    '</style>' +
    '<button id="btn" class="f" type="button" aria-haspopup="dialog">' +
    '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
    '<span>' + esc(CFG.label) + '</span></button>' +
    '<div id="panel" class="f" role="dialog" aria-label="Report a problem">' +
    '<header><b>Report a problem<small id="asme"></small></b><button id="x" type="button" aria-label="Close">✕</button></header>' +
    '<div class="body" id="form">' +
    '<div id="idbox" style="display:none"><div class="two"><input id="nm" placeholder="Your name" autocomplete="name"><input id="em" type="email" placeholder="Email" autocomplete="email"></div></div>' +
    '<label for="note">What happened?</label>' +
    '<textarea id="note" placeholder="What did you expect, and what did it do instead?"></textarea>' +
    '<div id="drop"><img id="thumb" alt=""><span id="dropmsg">Add a screenshot — click, drag one in, or paste</span></div>' +
    '<input id="file" type="file" accept="image/png,image/jpeg,image/webp" hidden>' +
    '<button id="send" type="button">Send report</button>' +
    '<div id="out"></div>' +
    '</div>' +
    '<div class="body done" id="thanks" style="display:none">' +
    '<div class="tick">✓</div><h3>Got it — thank you.</h3>' +
    '<p>It’s on the list with your name and the time, and we can see your screenshot.</p>' +
    '<button class="again" id="again" type="button">Report something else</button>' +
    '</div>' +
    '</div>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function $(id) { return root.getElementById ? root.getElementById(id) : root.querySelector('#' + id); }

  (document.body || document.documentElement).appendChild(host);

  var SHOT = null;   // {data, type}

  /* ------------------------------- open and close -------------------------------- */
  function open() {
    $('panel').classList.add('on');
    $('btn').style.display = 'none';
    ($('idbox').style.display === 'none' ? $('note') : $('nm')).focus();
  }
  function close() { $('panel').classList.remove('on'); $('btn').style.display = ''; }
  $('btn').addEventListener('click', open);
  $('x').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  // Ask the server who it thinks we are — a signed-in account beats anything typed.
  fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'whoami', token: TOKEN }) })
    .then(function (r) { return r.json(); })
    .then(function (dd) {
      if (dd && dd.who && dd.who.email) { WHO = dd.who; }
      paintWho();
    })
    .catch(paintWho);

  function paintWho() {
    var known = !!(WHO.email || WHO.name);
    $('idbox').style.display = (known && WHO.via && WHO.via !== 'typed') ? 'none' : '';
    if (!known || WHO.via === 'typed') { $('nm').value = WHO.name || ''; $('em').value = WHO.email || ''; }
    $('asme').textContent = known ? 'reporting as ' + (WHO.name || WHO.email) : 'your name goes on it';
  }
  paintWho();

  /* --------------------------------- screenshots --------------------------------- */
  var drop = $('drop');
  drop.addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function (e) { take(e.target.files && e.target.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
  // Paste works anywhere in the panel — most people screenshot then hit ⌘V.
  $('panel').addEventListener('paste', function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (/^image\//.test(items[i].type)) { e.preventDefault(); take(items[i].getAsFile()); return; }
    }
  });

  // Shrink before sending: a phone screenshot is 3 MB and nobody needs that.
  function take(file) {
    if (!file || !/^image\//.test(file.type)) return;
    var rd = new FileReader();
    rd.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.width, h = img.height;
        if (Math.max(w, h) > max) { var k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        var url = cv.toDataURL('image/jpeg', 0.82);
        SHOT = { data: url.split(',')[1], type: 'image/jpeg' };
        $('thumb').src = url; $('thumb').style.display = 'block';
        $('dropmsg').textContent = 'Screenshot attached — click to swap it';
      };
      img.onerror = function () { $('dropmsg').textContent = 'That image wouldn’t open — try another.'; };
      img.src = String(rd.result);
    };
    rd.readAsDataURL(file);
  }

  /* ----------------------------------- sending ----------------------------------- */
  function context() {
    var bits = [
      navigator.userAgent,
      'Window ' + innerWidth + '×' + innerHeight + ' · screen ' + screen.width + '×' + screen.height + ' @' + (devicePixelRatio || 1) + 'x',
      'Local time ' + new Date().toString()
    ];
    if (ERRORS.length) bits.push('JS errors on this page:\n- ' + ERRORS.join('\n- '));
    return bits.join('\n');
  }

  $('send').addEventListener('click', function () {
    var note = $('note').value.trim(), out = $('out');
    out.className = '';
    if (!note) { out.className = 'bad'; out.textContent = 'Say what happened first.'; return; }
    var name = $('idbox').style.display === 'none' ? WHO.name : $('nm').value.trim();
    var email = $('idbox').style.display === 'none' ? WHO.email : $('em').value.trim();
    if (!name && !email) { out.className = 'bad'; out.textContent = 'Add your name so we know who found it.'; return; }
    if (name) store.set('name', name);
    if (email) store.set('email', email);

    $('send').disabled = true;
    out.textContent = SHOT ? 'Sending your report and screenshot…' : 'Sending…';
    fetch(CFG.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit', note: note, name: name, email: email, token: TOKEN,
        page: location.href, context: context(),
        shot: SHOT ? SHOT.data : '', shotType: SHOT ? SHOT.type : ''
      })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error((res.j && res.j.error) || 'Could not send.');
        $('form').style.display = 'none'; $('thanks').style.display = '';
      })
      .catch(function (e) { out.className = 'bad'; out.textContent = e.message || 'Could not send — try once more?'; })
      .then(function () { $('send').disabled = false; });
  });

  $('again').addEventListener('click', function () {
    $('note').value = ''; SHOT = null;
    $('thumb').style.display = 'none'; $('dropmsg').textContent = 'Add a screenshot — click, drag one in, or paste';
    $('out').textContent = ''; $('out').className = '';
    $('thanks').style.display = 'none'; $('form').style.display = '';
    $('note').focus();
  });
})();
