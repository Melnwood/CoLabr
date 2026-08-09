// Co·labr — the floating help chat, shared by every member-facing page.
// Include with <script src="help.js"></script> (end of body). Self-contained:
// injects its own styles + markup, talks to /.netlify/functions/support.
(function(){
  if(document.getElementById('helpfab')) return;   // page already has it inline

  const css=`
  #helpfab{position:fixed;right:20px;bottom:20px;z-index:180;width:52px;height:52px;border-radius:50%;background:var(--text,#241f1b);color:#fff;border:none;cursor:pointer;box-shadow:0 10px 30px rgba(36,31,27,.35);display:flex;align-items:center;justify-content:center}
  #helpfab:hover{transform:translateY(-2px)}
  #helpfab svg{width:24px;height:24px;stroke:#fff;stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round}
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
  #helpin{flex:1;border:1px solid var(--line,#e7e4e0);border-radius:20px;padding:10px 14px;font-size:13.5px;font-family:inherit;outline:none;resize:none;max-height:90px}
  #helpin:focus{border-color:var(--acc,#FF6600)}
  #helpsend{background:var(--acc,#FF6600);color:#fff;border:none;border-radius:50%;width:38px;height:38px;cursor:pointer;flex:none;display:flex;align-items:center;justify-content:center}
  #helpsend svg{width:17px;height:17px;stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  const wrap=document.createElement('div');
  wrap.innerHTML=`<button id="helpfab" type="button" title="Need help?" aria-label="Need help?"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-8.4 8.4c-1.5 0-2.9-.4-4.1-1L3 20l1.1-5.2a8.4 8.4 0 1 1 16.9-3.3z"/><path d="M9 10h6M9 13h4"/></svg></button>
  <div id="helpbox">
    <div id="helphead"><img src="https://storage.googleapis.com/colabr-photos-jv/profile/1786207347023-dum1ek.png" alt="Noah" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.35)"><div style="flex:1;min-width:0">Co·labr help<br><span>Noah reads every message and follows up ASAP</span></div><button id="helpx" type="button" aria-label="Close" style="background:none;border:none;color:#fff;opacity:.8;font-size:17px;cursor:pointer;padding:4px 6px">✕</button></div>
    <div id="helpmsgs"></div>
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
})();
