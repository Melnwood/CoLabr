// Co·labr — the floating help chat, shared by every member-facing page.
// Include with <script src="help.js"></script> (end of body). Self-contained:
// injects its own styles + markup, talks to /.netlify/functions/support.
(async function(){
  if(document.getElementById('helpfab')) return;   // page already has it inline
  // Members only — on public pages (the wall, composer) the bubble appears
  // solely for signed-in people, never for supporters.
  try{ const mr=await fetch('/.netlify/functions/me'); if(!mr.ok) return; }catch(_){ return; }

  const css=`
  #helpfab{position:fixed;right:20px;bottom:20px;z-index:180;width:72px;height:72px;border-radius:50%;background:#fff;border:none;padding:0;cursor:pointer;box-shadow:0 12px 34px rgba(36,31,27,.4);overflow:visible}
  #helpfab:hover{transform:translateY(-2px)}
  #helpfab img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;border:3px solid #fff;box-sizing:border-box}
  #helpbadge{position:absolute;right:-2px;bottom:-2px;width:26px;height:26px;border-radius:50%;background:var(--acc,#FF6600);border:2.5px solid #fff;display:flex;align-items:center;justify-content:center}
  #helpbadge svg{width:13px;height:13px;stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
  #helpbox{display:none;position:fixed;right:20px;bottom:84px;z-index:181;width:min(360px,calc(100vw - 32px));height:min(480px,70vh);background:#fff;border:1px solid var(--line,#e7e4e0);border-radius:16px;box-shadow:0 24px 70px rgba(36,31,27,.3);flex-direction:column;overflow:hidden}
  #helpbox.on{display:flex}
  #helphead{background:var(--text,#241f1b);color:#fff;padding:13px 16px;font-size:13.5px;font-weight:700;display:flex;align-items:center;gap:8px}
  #helphead span{font-weight:500;opacity:.75;font-size:11.5px}
  #helpmsgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px}
  .hmsg{max-width:85%;padding:9px 13px;border-radius:13px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .hmsg.me{align-self:flex-end;background:var(--acc,#FF6600);color:#fff;border-bottom-right-radius:4px}
  .hmsg.bot{align-self:flex-start;background:#f4f1ec;color:var(--text,#241f1b);border-bottom-left-radius:4px}
  .hmsg.think{color:var(--muted,#7a756f);background:#f4f1ec;font-style:italic}
  #helprow{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line,#e7e4e0)}
  #fbmode{display:none;flex:1;overflow-y:auto;padding:14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  #helpbox.fb #helpmsgs,#helpbox.fb #helprow{display:none}
  #helpbox.fb #fbmode{display:block}
  #fbmode p{font-size:12.5px;color:var(--muted,#7a756f);line-height:1.55;margin:0 0 10px}
  #fbnote{display:block;width:100%;box-sizing:border-box;border:1px solid var(--line,#e7e4e0);border-radius:11px;padding:10px 12px;font-size:13.5px;font-family:inherit;min-height:90px;resize:vertical;outline:none}
  #fbnote:focus{border-color:var(--acc,#FF6600)}
  .fbatt{display:flex;gap:8px;align-items:center;margin:10px 0}
  #fbpick{background:#fff;border:1px dashed var(--line,#e7e4e0);border-radius:10px;font-size:12px;font-weight:700;color:var(--text,#241f1b);padding:8px 13px;cursor:pointer;font-family:inherit}
  #fbthumb{max-height:52px;border-radius:8px;border:1px solid var(--line,#e7e4e0);display:none}
  #fbsend{background:var(--text,#241f1b);color:#fff;border:none;border-radius:10px;padding:11px 20px;font-size:13.5px;font-weight:700;cursor:pointer}
  #fbsend:disabled{opacity:.55}
  #fbout{font-size:12.5px;margin-top:9px;color:var(--muted,#7a756f)}
  #fbtab{margin-left:auto;background:rgba(255,255,255,.14);border:none;color:#fff;font-size:11px;font-weight:700;border-radius:14px;padding:5px 11px;cursor:pointer;font-family:inherit}
  #helpin{flex:1;border:1px solid var(--line,#e7e4e0);border-radius:20px;padding:10px 14px;font-size:13.5px;font-family:inherit;outline:none;resize:none;max-height:90px}
  #helpin:focus{border-color:var(--acc,#FF6600)}
  #helpsend{background:var(--acc,#FF6600);color:#fff;border:none;border-radius:50%;width:38px;height:38px;cursor:pointer;flex:none;display:flex;align-items:center;justify-content:center}
  #helpsend svg{width:17px;height:17px;stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  const wrap=document.createElement('div');
  wrap.innerHTML=`<button id="helpfab" type="button" title="Need help? Chat with Noah" aria-label="Need help? Chat with Noah"><img src="/noah-help.png" alt=""><span id="helpbadge"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-8.4 8.4c-1.5 0-2.9-.4-4.1-1L3 20l1.1-5.2a8.4 8.4 0 1 1 16.9-3.3z"/></svg></span></button>
  <div id="helpbox">
    <div id="helphead"><img src="/noah-help.png" alt="Noah" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.4)"><div style="flex:1;min-width:0">Co·labr help<br><span>Noah reads every message and follows up ASAP</span></div><button id="fbtab" type="button">Found a problem?</button><button id="helpx" type="button" aria-label="Close" style="background:none;border:none;color:#fff;opacity:.8;font-size:17px;cursor:pointer;padding:4px 6px">✕</button></div>
    <div id="helpmsgs"></div>
    <div id="fbmode">
      <p><b>Sandbox report.</b> Say what you expected and what actually happened. Attach a screenshot (or paste one right into the box) — it goes straight to Mel and onto the fix list.</p>
      <textarea id="fbnote" placeholder="What went wrong? Paste a screenshot here if you have one…"></textarea>
      <div class="fbatt"><button id="fbpick" type="button">Attach screenshot…</button><input id="fbfile" type="file" accept="image/png,image/jpeg,image/webp" hidden><img id="fbthumb" alt=""></div>
      <button id="fbsend" type="button">Send report</button>
      <div id="fbout"></div>
    </div>
    <div id="helprow"><textarea id="helpin" rows="1" placeholder="Ask anything, or tell us what's wrong…"></textarea><button id="helpsend" type="button" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button></div>
  </div>`;
  while(wrap.firstChild) document.body.appendChild(wrap.firstChild);

  const HHIST=[];
  function hAdd(role,text,cls){
    const m=document.createElement('div'); m.className='hmsg '+(cls||(role==='user'?'me':'bot'));
    m.textContent=text;
    document.getElementById('helpmsgs').appendChild(m);
    document.getElementById('helpmsgs').scrollTop=1e6;
    return m;
  }
  document.getElementById('helpfab').addEventListener('click',()=>{
    const box=document.getElementById('helpbox');
    box.classList.toggle('on');
    if(box.classList.contains('on')){
      if(!document.getElementById('helpmsgs').children.length)
        hAdd('assistant','Hi! I’m the Co·labr helper. Ask me anything, or tell me what’s not working — I’ll help right away, and Mel or Noah will follow up with you personally ASAP.');
      document.getElementById('helpin').focus();
    }
  });
  async function helpSend(){
    const inp=document.getElementById('helpin');
    const text=inp.value.trim(); if(!text) return;
    inp.value=''; hAdd('user',text);
    HHIST.push({role:'user',content:text});
    const think=hAdd('assistant','…','think');
    document.getElementById('helpsend').disabled=true;
    try{
      const r=await fetch('/.netlify/functions/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history:HHIST.slice(0,-1)})});
      const d=await r.json();
      think.remove();
      const reply=(r.ok&&d.reply)?d.reply:(d.error||'Something hiccuped — your message is logged and the team will follow up ASAP.');
      hAdd('assistant',reply);
      HHIST.push({role:'assistant',content:reply});
    }catch(_){ think.remove(); hAdd('assistant','I couldn’t reach the server — try once more? Your connection may have blinked.'); }
    document.getElementById('helpsend').disabled=false;
    inp.focus();
  }
  document.getElementById('helpx').addEventListener('click',()=>document.getElementById('helpbox').classList.remove('on'));
  document.getElementById('helpsend').addEventListener('click',helpSend);
  document.getElementById('helpin').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); helpSend(); } });

  /* ---- Sandbox reports: screenshot + note -> Feedback table + Mel's inbox ---- */
  let FBSHOT=null;   // {data, type}
  const fbtab=document.getElementById('fbtab');
  fbtab.addEventListener('click',()=>{
    const box=document.getElementById('helpbox');
    box.classList.toggle('fb');
    fbtab.textContent=box.classList.contains('fb')?'Back to chat':'Found a problem?';
    if(box.classList.contains('fb')) document.getElementById('fbnote').focus();
  });
  // Shrink first — a phone screenshot is 3 MB and nothing is gained by sending all of it.
  function fbSetShot(file){
    if(!file||!/^image\//.test(file.type)) return;
    const rd=new FileReader();
    rd.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height; const max=1600;
        if(Math.max(w,h)>max){ const k=max/Math.max(w,h); w=Math.round(w*k); h=Math.round(h*k); }
        const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        const url=cv.toDataURL('image/jpeg',0.82);
        FBSHOT={data:url.split(',')[1],type:'image/jpeg'};
        const t=document.getElementById('fbthumb'); t.src=url; t.style.display='block';
        document.getElementById('fbpick').textContent='Screenshot attached ✓';
      };
      img.src=String(rd.result);
    };
    rd.readAsDataURL(file);
  }
  // What a report should carry without anyone having to type it.
  const FBERR=[];
  addEventListener('error',e=>{ FBERR.push((e.message||'Error')+' @ '+String(e.filename||'').split('/').pop()+':'+(e.lineno||0)); if(FBERR.length>5) FBERR.shift(); });
  addEventListener('unhandledrejection',e=>{ FBERR.push('Unhandled: '+((e.reason&&(e.reason.message||e.reason))||'')); if(FBERR.length>5) FBERR.shift(); });
  function fbContext(){
    const bits=[navigator.userAgent,
      'Window '+innerWidth+'×'+innerHeight+' · screen '+screen.width+'×'+screen.height+' @'+(devicePixelRatio||1)+'x',
      'Local time '+new Date().toString()];
    if(FBERR.length) bits.push('JS errors on this page:\n- '+FBERR.join('\n- '));
    return bits.join('\n');
  }
  document.getElementById('fbpick').addEventListener('click',()=>document.getElementById('fbfile').click());
  document.getElementById('fbfile').addEventListener('change',e=>fbSetShot(e.target.files&&e.target.files[0]));
  document.getElementById('fbnote').addEventListener('paste',e=>{
    const it=[...(e.clipboardData&&e.clipboardData.items||[])].find(x=>/^image\//.test(x.type));
    if(it){ e.preventDefault(); fbSetShot(it.getAsFile()); }
  });
  document.getElementById('fbsend').addEventListener('click',async()=>{
    const note=document.getElementById('fbnote').value.trim(), out=document.getElementById('fbout'), btn=document.getElementById('fbsend');
    if(!note){ out.textContent='Describe what you saw first.'; return; }
    btn.disabled=true; out.textContent=FBSHOT?'Sending your report and screenshot…':'Sending…';
    try{
      const r=await fetch('/.netlify/functions/sandbox-report',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'submit',note,page:location.href,context:fbContext(),
          shot:FBSHOT?FBSHOT.data:'',shotType:FBSHOT?FBSHOT.type:''})});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||'Could not send.');
      out.textContent='Got it — thank you! It’s on the fix list and Mel has it in his inbox.';
      document.getElementById('fbnote').value=''; FBSHOT=null;
      document.getElementById('fbthumb').style.display='none';
      document.getElementById('fbpick').textContent='Attach screenshot…';
    }catch(e){ out.textContent=e.message||'Could not send — try again.'; }
    btn.disabled=false;
  });
})();
