# Co·labr — how this gets built

## The standard

> "It has to feel like they're not even thinking and they know what to do. I want this
> to be so well thought out that it takes people no work at all to do the things that
> they want to do." — Mel, 2026-08-22

Missionaries are busy, often tired, often on a phone in a language that isn't their
first. Anything that makes them stop and work out what a screen wants is a defect,
even when every function on it works.

Nothing ships from here that was merely wired up. Sit with how it will feel first.

## Rules that follow from it

**One primary action per view.** Exactly one filled, coloured control. If two things
shout, neither is the answer. Everything else steps back to quiet.

**Controls size to their own words.** Never force equal widths across a row. A label
that wraps onto extra lines is the layout failing, not the label being long.

**Group by intent, with air between the groups.** Looking-at-it on one side,
committing-to-it on the other. Order things the way the work actually runs.

**Fewest words that stay true.** If a label needs an explainer appended, the label is
wrong. Shorten it and put the explanation in a `title`.

**Optional has to look optional.** Never nag, never badge, never imply someone should
have done something they chose not to do.

**Never show a placeholder as if it were real.** Markup defaults leak. Every wall once
announced "Frýdek-Místek, Czechia" because one person's location was blank and the
hardcoded sample showed through. Empty means show nothing.

**Never destroy someone's work quietly.** Anything a person typed by hand outranks
anything a machine generated. Regenerate around it, flag it, never overwrite it.

**Confirmations state the consequence in real numbers.** "This will email your 203
supporters", never "Are you sure?".

**Fine-line SVG icons, never emoji.** Mature, not cheeky.

**No em dashes or en dashes anywhere a reader sees.** Commas, full stops, or "and".
This includes anything an AI prompt is allowed to produce.

**Co·labr always carries the interpunct.** Never Co-labr, never Colabr.

**Layouts feel designed.** Small panels share rows. Never solve a problem by appending
another full-width stripe to the bottom of a column.

**The voice is a friend who was there, never a marketer.** Opens are people who
stopped and read, not a score. Someone's illness is never a tactic that performs well.

**Nothing may imply the product doubts itself.** Offering a person control over their
own words is a courtesy, not an apology for the machine.

## Before anything is called done

- `node --check` every inline `<script>` (long single-line files hide real breakage,
  and a `//` comment inside one swallows the rest of the line, closing braces included)
- `<div>` open/close balance on every touched page
- `SMOKE_T=… python3 scripts/smoke.py` — 29 checks, all must pass
- push, then poll Netlify until `commit_ref` matches HEAD and state is `ready`
- verify the change on the live URL, not just locally

Measure before concluding. `getBoundingClientRect` reports the layout box, so an
element can measure full width while painting clipped. Trust the rendered page.
