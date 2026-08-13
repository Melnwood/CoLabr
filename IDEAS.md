# Co·labr — parked ideas

Things Mel raised that we deliberately did NOT build yet. Each entry keeps enough
context to pick it up cold: what it is, why it's parked, and what would have to be
true to build it well.

---

## Trusted inner circle (private updates for a chosen few)
**Raised:** 2026-08-11 · **Status:** parked — Mel: "I'm not sure I want to do it. We can hold it as an idea."

**The idea.** A missionary picks a small group out of their own supporter list —
people they trust — and can write updates only that group ever sees. Not on the
wall for other supporters, not visible to the organization. Something personal
enough that they'd only say it to their inner circle.

**Why it's not trivial.** It's a *trust promise*, and the promise is only worth
what's true underneath. As the system stands today, an "inner circle" tag alone
would leak in six ways:
1. Any signed-in staff member sees everything (updates.js gives staff a pass through audience filters).
2. Care radar and MPD radar read all update text and summarize it for leadership.
3. The prayer wall lifts prayer blocks out of updates, movement-wide.
4. Feature-sharing / team picks could surface it on someone else's wall.
5. Email is forwardable — a full-body email leaves the fence immediately.
6. Super admins can read anything in Airtable.

**What a credible build requires**
- The circle belongs to the missionary; nobody else can add themselves.
- Wall-only by default: the email says "something personal is waiting," never the words.
- Server-side exclusions from: other supporters, non-author staff, Care radar,
  MPD radar, the prayer wall, team picks, the directory, and ALL AI scans/translation.
- Composer language that states the limits plainly, including that platform admins
  can still access the database. Overstating the promise is worse than not offering it.

**Open questions for Mel**
- Wall-only always, or wall-only by default with an override?
- Is "platform admins can read the database" acceptable to state plainly, or does
  this need real encryption? (Encryption is a much bigger build and breaks search,
  translation, and account recovery.)

**Rough size:** ~half a day for the mechanism; the exclusions are the real work.

---

## JV House style (org-branded wall)
**Raised:** 2026-08-10 · **Status:** in progress, paused by Mel mid-build

Org-only wall style that matches an organization's own website — dark banner, their
colors, their shape language — so a supporter who knows KAM or Veza feels at home.
Driven by the brand record (not hand-coded per org) so every organization gets it.

Done so far: "House header" field added to National Orgs (Dark / Light / Brand).
Still to do: headline-font + corners fields, the House renderer, restricting the
style picker to organization accounts, brand controls in branding.html.

Decided: **org accounts only** — individual missionaries keep the styles that make
them, not the organization, the loudest voice on their page.

---

## Interface chrome translation
**Status:** open, cheap

Update bodies, titles and excerpts translate; the buttons around them don't
("Get updates", "Read the update", rail headings). A Czech reader still meets
English furniture. Small, mechanical, no AI cost at read time.

---

## Per-person send log
**Status:** roadmap

Who received which update, and who opened it — per supporter. Would let the
supporter table show real per-person open history, and make "translate history"
and re-send decisions smarter. Needs a send-log table written at send time.
