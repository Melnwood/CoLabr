# Sandbox kit

A drop-in way to let invited people report what's broken — screenshot, in their own
words — and have it land on one list per project, stamped with **who** and **when**.

Four files. No npm packages, no build step, no framework. Copy them into any
project on Netlify with an Airtable base and it works.

## Why it isn't a chatbot

A chat window invites prose. You end up reading three messages to learn which page
someone was on, and the screenshot is in a fourth. The kit asks for one thing —
*what happened* — and collects everything else silently: the page URL, the browser,
the window size, and any JavaScript errors that fired before they clicked. The
tester writes a sentence; you get a filed bug.

Keep a chatbot for questions if you want one. This is for reports.

---

## Install

**1. Copy the files**

| From | To | What it is |
|---|---|---|
| `_sandbox.js` | `netlify/functions/_sandbox.js` | storage, identity, notifications |
| `sandbox-report.js` | `netlify/functions/sandbox-report.js` | the one endpoint |
| `sandbox.config.json` | `netlify/functions/sandbox.config.json` | the file you edit |
| `sandbox-widget.js` | site root | the button testers press |
| `sandbox-board.html` | site root | the list you and I work from |

**2. Edit `sandbox.config.json`**

```json
{
  "project": "myproject",
  "label": "My Project",
  "table": "Sandbox Reports",
  "sessionCookie": "",
  "includeUntagged": false
}
```

`project` is the key every report is tagged with — that's what keeps each project's
list separate when several projects share one Airtable base.

**3. Set two environment variables**

```
AIRTABLE_TOKEN=pat…      # needs data.records:read/write on the base
AIRTABLE_BASE=app…       # or SANDBOX_AIRTABLE_BASE if the project uses Airtable for other things
```

If the token also has `schema.bases:write`, the table creates itself on the first
report. Otherwise make it by hand with these fields:

| Field | Type |
|---|---|
| Note | Long text |
| Name | Single line text |
| Email | Email |
| Project | Single line text |
| Page | URL |
| Shot | Attachment |
| Context | Long text |
| Status | Single select — New, Working on it, Fixed, Not a bug |

**4. Put the button on the pages you want tested**

```html
<script src="/sandbox-widget.js" defer></script>
```

Done. Open `/sandbox-board.html` to read the list.

---

## Who gets in

Three ways the kit learns a reporter's name, best first:

1. **The project's own sign-in.** If your app already sets an HMAC-signed session
   cookie shaped `base64url(payload).base64url(sig)` — the common pattern — set
   `sessionCookie` to its name and `SANDBOX_SECRET` to the same secret it's signed
   with. Signed-in people are named automatically and never see a name field.
2. **An invite link.** On the board, type a name and email and press *Make a link*.
   The link carries their name, signed — no account, nothing stored, and every
   report they file arrives attributed. Needs `SANDBOX_SECRET` set.
3. **They type it.** Remembered on their device after the first report.

## Who can read the list

Either your email is in `SANDBOX_ADMINS` (or `ADMIN_EMAILS`) and the kit can see
you're signed in, or you set `SANDBOX_ADMIN_KEY` to a passphrase and type it into
the board once — it keeps you signed in on that device for a month.

## Everything you can set

| Variable | What it does |
|---|---|
| `AIRTABLE_TOKEN` / `SANDBOX_AIRTABLE_TOKEN` | **required** |
| `AIRTABLE_BASE` / `SANDBOX_AIRTABLE_BASE` | **required** |
| `SANDBOX_SECRET` | signs invite links and the board cookie. Falls back to `SESSION_SECRET` |
| `SANDBOX_ADMINS` | who may read the list. Falls back to `ADMIN_EMAILS` |
| `SANDBOX_ADMIN_KEY` | passphrase way into the board, for projects with no sign-in |
| `SANDBOX_WEBHOOK` | any POST-JSON hook — Slack, Make, IFTTT — pinged on each report |
| `SANDBOX_RESEND_KEY` + `SANDBOX_FROM` + `SANDBOX_NOTIFY` | email on each report |
| `SANDBOX_PROJECT` `SANDBOX_LABEL` `SANDBOX_TABLE` `SANDBOX_SESSION_COOKIE` `SANDBOX_INCLUDE_UNTAGGED` | override the config file per deploy |
| `SANDBOX_FIELDS` | JSON map, to bind to a table whose fields are named differently |

Widget attributes: `data-endpoint`, `data-label`, `data-accent`, `data-position`,
`data-require-invite="1"` (show the button only to people who came in on an invite link).

## Working the list

The board sorts newest first and opens on what's still unresolved. **Copy the open
list** puts every open report — words, reporter, time, page, screenshot URL, browser —
on your clipboard as Markdown, ready to paste into a working session with Claude.

Screenshots live as Airtable attachments, so there's no bucket to set up. Airtable's
attachment URLs expire, which is why the board fetches them fresh each time you load
it rather than storing links.

## Sharing one base across projects

Point every project at the same `AIRTABLE_BASE` and `table`, give each a different
`project` key, and you get one table you can see whole in Airtable while each
project's board shows only its own.
