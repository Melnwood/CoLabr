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

## Answered-prayer loop — WITHOUT the upkeep that killed the prayer room
**Raised:** 2026-08-11 · **Status:** idea, strongest candidate to build next

**The payoff.** A supporter taps "I'm praying" and it disappears into a counter.
Instead: when a request is answered, everyone who prayed hears about it —
"You prayed for Marek in March. He was baptized Sunday." Nobody in missions does
this because nobody has the data connected. Co·labr already stores who prayed,
for which update, on which request.

**Mel's hard-won caution (JV's old prayer room):** follow-up died under upkeep.
People cannot remember months later to go mark something answered.

**The rule that makes it survivable: never a separate errand.**
1. **Ask inside the composer.** When they're already writing (the only time they
   show up anyway), show 1–2 still-open requests as small cards:
   *Answered · Still praying · It didn't go that way.* One tap.
2. **Let their words answer it.** On publish, check whether the new text echoes an
   open request ("Marek was baptized") and ask once: "Tell the 14 people who
   prayed?" Zero recall required. Cost: a fraction of a cent per update.
3. **Quiet retirement.** Unanswered requests stop being shown after ~90 days. No
   badge, no overdue count, no guilt. The pile never grows.
4. **Supporters are the reminder — as encouragement.** A supporter can tap "still
   praying" on an old request; the missionary sees "6 people are still praying for
   Marek." Being carried, not chased.
5. **Three honest outcomes**, not one. "It didn't go the way we hoped" closes the
   loop just as truly, and is often the most bonding thing they can say.
6. **Hard cap:** at most one prompt per writing session. Never a list of twelve.

---

## Prayer rhythm ("pray for them on Tuesdays")
**Status:** idea

A supporter opts into a weekly nudge for one family, carrying that family's current
requests. Missionaries have mailed fridge magnets for decades to make this happen.
Turns a monthly reader into someone woven into the week. Pairs with the loop above.

---

## Voice notes, both directions
**Status:** idea

Twenty seconds of talking instead of typing. Grandma will never write a note but
will happily speak one; and a missionary's actual voice — tired, laughing, real —
carries what no newsletter can. Also the most meaningful accessibility win for the
older half of the supporter base. (Storage already exists; needs recording UI +
playback in the reader and in Conversations.)

---

## One digest instead of five emails
**Status:** idea — competitive moat

A JV supporter may follow five families and get five separate emails: exactly the
inbox fatigue Co·labr exists to end. A single weekly "your people" digest is
something only a platform can do — individual newsletters structurally cannot.
Needs: supporter-level email preference + a weekly assembly job.

---

## "Our story together" (supporter relationship timeline)
**Status:** idea

The hub already knows: following since 2019, prayed 47 times, wrote 6 notes, last
visit. Show it back to them — and at year's end, "Your year with the Ellenwoods."
The kind of thing people screenshot. Honest emotional accounting of what they've given.

---

## Gratitude nudges for the missionary (two minutes, highest return)
**Status:** idea

- **Gone quiet:** "8 of your people haven't opened anything in six months — send a
  personal note?" (last-visit data already exists; one-click personal messages already exist.)
- **Anniversaries:** "Rebecca has walked with you for five years today."
Nobody remembers these dates; the system does.

---

## Year-end printed keepsake
**Status:** idea — possible paid product

A printed booklet of a family's year of updates. Grandparents put these on coffee
tables. Distinctive, physical, costs nothing until someone orders, and priced like
the history-translation offer (quote → consent → produce).

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
