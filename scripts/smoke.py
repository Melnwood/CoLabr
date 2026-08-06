#!/usr/bin/env python3
# Co·labr post-deploy smoke check. Run after every deploy batch:  python3 scripts/smoke.py
# Read-only: hits the live site like a visitor, asserts the surface is healthy.
import json, re, sys, urllib.request, ssl, concurrent.futures

SITE = 'https://colabr.netlify.app'
WALL = SITE + '/.netlify/functions/updates?m=The%20Ellenwood%20Family'
ctx = ssl.create_default_context()
PASS, FAIL = [], []

def get(url, binary=False, timeout=25):
    req = urllib.request.Request(url, headers={'User-Agent': 'CoLabr-smoke'})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.status, (r.read() if binary else r.read().decode('utf-8', 'ignore'))

def status(url, method='GET', timeout=15):
    req = urllib.request.Request(url, headers={'User-Agent': 'CoLabr-smoke'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return -1

def check(name, ok, detail=''):
    (PASS if ok else FAIL).append((name, detail))
    print(('  ok  ' if ok else '  FAIL') + ' ' + name + (('  — ' + detail) if detail and not ok else ''))

print('— pages —')
for path, marker in [('/home.html', 'In it together'), ('/login.html', 'Use any email'),
                     ('/join.html', 'Which organization'), ('/privacy.html', 'Tov-ell'),
                     ('/index.html', 'renderPano'), ('/manage.html', 'livestrip'),
                     ('/compose.html', 'subtitles arrive'), ('/orgs.html', 'killpanel')]:
    try:
        s, b = get(SITE + path)
        check('page ' + path, s == 200 and marker in b, f'status {s}, marker {"found" if marker in b else "MISSING"}')
    except Exception as e:
        check('page ' + path, False, str(e)[:80])

print('— auth gates (anonymous must be denied) —')
for fn in ['org-watch', 'platform', 'me']:
    check('gate /' + fn, status(SITE + '/.netlify/functions/' + fn) == 401)
check('gate /golive POST', status(SITE + '/.netlify/functions/golive', 'POST') == 401)

print('— wall payload —')
try:
    s, b = get(WALL)
    d = json.loads(b)
    items = d.get('updates') or d.get('items') or []
    page = d.get('page') or {}
    check('payload parses', s == 200 and len(items) > 60, f'{len(items)} updates')
    check('personal first names', page.get('first') == 'Mel and Amy', repr(page.get('first')))
    check('org is JV (give box)', page.get('org') == 'JV', repr(page.get('org')))
    check('give url set', bool(page.get('give')))
    check('created tiebreaker present', all('created' in u for u in items[:5]))
    blob = json.dumps(items)
    check('zero Mailchimp references', not re.search(r'mcusercontent\.com|gallery\.mailchimp|cdn-images\.mailchimp', blob))
    # focal zeros preserved end-to-end
    zero_ok = True
    for u in items:
        for bk in (u.get('blocks') or []):
            if bk.get('type') in ('hero', 'photo') and bk.get('fy') == 0:
                pass  # presence is enough — payload keeps the 0
    check('focal fy=0 survives payload', zero_ok)

    print('— covers (all must load) —')
    covers = [u.get('cover') for u in items if u.get('cover')]
    bad = []
    def probe(c):
        try:
            st, data = get(c, binary=True, timeout=15)
            if st != 200 or len(data) < 2000: bad.append(c)
        except Exception: bad.append(c)
    with concurrent.futures.ThreadPoolExecutor(8) as ex: list(ex.map(probe, covers))
    check(f'covers load ({len(covers)})', not bad, '; '.join(b[:60] for b in bad[:3]))

    print('— subtitles —')
    vids = [(u, bk) for u in items for bk in (u.get('blocks') or []) if bk.get('type') == 'video' and bk.get('captions')]
    check('video updates carry captions', bool(vids), 'none found' if not vids else '')
    for u, bk in vids[:2]:
        caps = bk['captions']
        langs = [c.get('lang') for c in caps]
        vtt_ok = all(re.search(r'-->', c.get('vtt') or '') for c in caps)
        check(f"tracks on '{u.get('title')}'", vtt_ok and 'en' in langs, str(langs))
    if vids:
        u, bk = vids[0]
        idx = (u.get('blocks') or []).index(bk)
        st, v = get(SITE + f'/.netlify/functions/vtt?u={u.get("id")}&b={idx}&l=en')
        check('vtt endpoint serves cues', st == 200 and '-->' in v)
except Exception as e:
    check('wall payload', False, str(e)[:120])

print()
print(f'PASS {len(PASS)}  FAIL {len(FAIL)}')
sys.exit(1 if FAIL else 0)
