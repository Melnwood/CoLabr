// Co-Labr — shared email renderer (wrap + block→HTML). Used by the subscriber send and the
// "send me a preview" endpoint so both produce identical emails.
const { esc } = require('./_mail');

function wrap(inner, site, manage) {
  return `<div style="font-family:-apple-system,Arial,sans-serif;max-width:560px;margin:0 auto;color:#241f1b">
    <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#FF6600;font-weight:800;margin:0 0 10px">The Ellenwoods · Ministry Update</p>
    ${inner}
    <hr style="border:none;border-top:1px solid #e7e4e0;margin:22px 0 12px">
    <p style="font-size:11.5px;color:#7a756f;line-height:1.5">You're receiving this because you chose to follow the Ellenwoods.${manage ? ` <a href="${manage}" style="color:#FF6600">Change how you hear from us or unsubscribe</a>.` : ''}</p>
  </div>`;
}

function renderBlocks(blocks, site) {
  const GIVE = 'https://www.josiahventure.com/give/give-form/?designation=c3c16a55-b527-4490-bb86-3f981460c969';
  // **bold**, _italic_, ++larger++ from the composer's format bar.
  const em = s => {
    let x = esc(s || '');
    const lk = [];
    x = x.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, txt, u) => { lk.push('<a href="' + u + '" target="_blank" style="color:#FF6600;font-weight:600">' + txt + '</a>'); return '\u0000' + (lk.length - 1) + '\u0000'; });
    x = x.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<b>$1</b>')
      .replace(/\+\+([^+\n][^+]*?)\+\+/g, '<span style="font-size:1.35em;line-height:1.4">$1</span>')
      .replace(/_([^_\n]+)_/g, '<i>$1</i>');
    x = x.replace(/\u0000(\d+)\u0000/g, (m, i) => lk[+i]);
    return x.replace(/\n/g, '<br>');
  };
  return (blocks || []).map(bk => {
    switch (bk.type) {
      case 'hero': return `${bk.url ? `<img src="${esc(bk.url)}" style="width:100%;border-radius:12px;margin:0 0 14px">` : ''}${bk.heading ? `<h2 style="font-size:22px;font-weight:800;margin:0 0 6px">${esc(bk.heading)}</h2>` : ''}${bk.sub ? `<p style="color:#7a756f;margin:0 0 14px">${esc(bk.sub)}</p>` : ''}`;
      case 'heading': return `<h3 style="font-size:18px;font-weight:750;margin:14px 0 8px;color:#1c1814">${esc(bk.text)}</h3>`;
      case 'text': return `<p style="font-size:15px;line-height:1.65;color:#3c3733;margin:0 0 14px">${em(bk.text)}</p>`;
      case 'quote': return `<blockquote style="border-left:3px solid #FF6600;margin:0 0 14px;padding:2px 0 2px 14px;font-style:italic;color:#241f1b">${esc(bk.text)}${bk.by ? `<br><span style="font-style:normal;font-size:12.5px;color:#FF6600;font-weight:700">${esc(bk.by)}</span>` : ''}</blockquote>`;
      case 'prayer': return `<div style="background:#eef3fe;border-left:3px solid #2f6df0;border-radius:10px;padding:12px 14px;margin:0 0 14px;color:#3c3733"><b style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#2f6df0;margin-bottom:4px">Prayer</b>${em(bk.text)}</div>`;
      case 'praise': return `<div style="background:#eafaf1;border-left:3px solid #2f9e63;border-radius:10px;padding:12px 14px;margin:0 0 14px;color:#2c4a38"><b style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#2f9e63;margin-bottom:4px">Praise</b>${em(bk.text)}</div>`;
      case 'numbers': { const it = [[bk.a, bk.al], [bk.b, bk.bl], [bk.c, bk.cl]].filter(x => x[0]); if (!it.length) return ''; return `<table style="width:100%;margin:0 0 14px"><tr>${it.map(x => `<td style="text-align:center;padding:8px"><div style="font-size:22px;font-weight:800;color:#FF6600">${esc(x[0])}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:#7a756f">${esc(x[1] || '')}</div></td>`).join('')}</tr></table>`; }
      case 'photo': return bk.url ? `<img src="${esc((bk.url || '').replace(/^http:\/\//i, 'https://'))}" style="width:100%;border-radius:12px;margin:0 0 6px">${bk.caption ? `<div style="font-size:12px;color:#7a756f;margin:0 0 14px">${esc(bk.caption)}</div>` : '<div style="margin-bottom:14px"></div>'}` : '';
      case 'video': { const v = bk.url || ''; return v ? `<p style="margin:0 0 14px"><a href="${esc(v)}" style="color:#FF6600;font-weight:700">▶ Watch the video</a></p>` : ''; }
      case 'give': return `<p style="margin:6px 0 14px"><a href="${esc(bk.url || GIVE)}" style="display:inline-block;background:${/^#[0-9a-fA-F]{6}$/.test(bk.color || '') ? bk.color : '#FF6600'};color:#fff;font-weight:700;text-decoration:none;padding:11px 24px;border-radius:9px">${esc(bk.label || 'Give')}</a></p>`;
      case 'button': return bk.url ? `<p style="margin:6px 0 14px"><a href="${esc(bk.url)}" style="display:inline-block;background:${/^#[0-9a-fA-F]{6}$/.test(bk.color || '') ? bk.color : '#FF6600'};color:#fff;font-weight:700;text-decoration:none;padding:11px 24px;border-radius:9px">${esc(bk.label || 'Open')}</a></p>` : '';
      case 'signoff': return `<p style="font-family:Georgia,serif;font-style:italic;color:#3c3733;margin:6px 0 14px">${em(bk.text)}</p>`;
      case 'divider': return `<hr style="border:none;border-top:1px solid #e7e4e0;margin:16px 0">`;
      default: return '';
    }
  }).join('');
}

module.exports = { wrap, renderBlocks };
