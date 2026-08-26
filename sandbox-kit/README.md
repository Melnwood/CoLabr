# Sandbox kit

Let invited people report what's broken — screenshot, in their own words — from any
app you've built, and have it all land on **one list you work through daily**.

No npm packages, no build step, no framework.

## The shape of it

One deployment is **the desk**. It owns the Airtable table, and it's the page you
open each morning: every report from every app, newest first, with who and when.

Every other app is a **guest**. A guest needs no backend, no Airtable token, no
config — one script tag and its reports show up on the desk under its own name.

```
   your other app  ──┐
   another app     ──┼──►  the desk  ──►  one Airtable table
   a third thing   ──┘     /sandbox-desk.html
```

Co·labr is the desk today. Its config lives in `netlify/functions/sandbox.config.json`.

---

## Adding a new app (two minutes)

**1.** On the desk, open `netlify/functions/sandbox.config.json` and name the app:

```json
"guests": {
  "https://theotherapp.com": { "key": "otherapp", "label": "The Other App" }
}
```

The key is what its reports get filed under. The address is how the desk recognises
it — the project is decided by which origin the browser actually came from, never by
anything the page claims, so nobody can file reports as someone else's app.

**2.** On the new app, add one line to any page you want tested:

```html
<script src="https://colabr.app/sandbox-widget.js"
        data-endpoint="https://colabr.app/.netlify/functions/sandbox-report" defer></script>
```

That's it. Deploy the desk, deploy the app, and reports start arriving.

---

## Why it isn't a chatbot

A chat window invites prose. You end up reading four messages to learn which page
someone was on, and the screenshot is in a fifth. The kit asks one thing — *what
happened* — and collects the rest silently: page URL, browser, window size, and any
JavaScript errors that fired before they clicked. The tester writes a sentence; you
get a filed bug.

Keep a chatbot for questions if you want one. This is for reports.

## The desk

`/sandbox-desk.html` — open it daily.

- Every app in one list, or one app at a time; counts of what's still open
- Search across everything anyone wrote
- Set a status, and jot a working note on any item — saved when you click away
- **Copy for Claude** puts whatever you're looking at on your clipboard as Markdown —
  words, reporter, time, page, screenshot, browser — ready to paste into a session

I can also read and update the table directly through the Airtable connector, so
"let's work the sandbox list" is enough to start — no copying required.

## Giving an app its own backend instead

Only worth it if the app must work when the desk is down, or wants its own Airtable
base. Copy `_sandbox.js`, `sandbox-report.js` and `sandbox.config.json` into its
`netlify/functions/`, put `sandbox-widget.js` and `sandbox-desk.html` at its root,
set `AIRTABLE_TOKEN` and `AIRTABLE_BASE`, and set `project` in the config. Leave
`desk` false — only the desk reads across apps; everyone else sees their own.

If the token has `schema.bases:write` the table creates itself on first report.
Otherwise make it by hand:

| Field | Type |
|---|---|
| Note | Long text |
| Name | Single line text |
| Email | Email |
| Project | Single line text |
| Page | URL |
| Shot | Attachment |
| Context | Long text |
| Notes | Long text |
| Status | Single select — New, Working on it, Fixed, Not a bug |

## Who gets in

Three ways the kit learns a reporter's name, best first:

1. **The app's own sign-in.** If it already sets an HMAC-signed session cookie shaped
   `base64url(payload).base64url(sig)`, set `sessionCookie` to its name and
   `SANDBOX_SECRET` to the same secret. Signed-in people are named automatically.
   Same-origin only — a guest app can't send cookies cross-site.
2. **An invite link.** On the desk, type a name and an email (and the app's address
   if it isn't the desk) and press *Make a link*. The link carries their name,
   signed — no account, nothing stored, every report attributed.
3. **They type it.** Remembered on their device after the first report.

## Who can read the list

Either your email is in `SANDBOX_ADMINS` (or `ADMIN_EMAILS`) and the kit can see
you're signed in, or set `SANDBOX_ADMIN_KEY` to a passphrase and type it into the
desk once — it keeps you signed in on that device for a month.

Reading or changing the list is **same-origin only**. A guest app can file reports
and nothing else, even for you.

## Settings

Config file keys: `project`, `label`, `table`, `sessionCookie`, `admins`,
`includeUntagged`, `desk`, `guests`, `fields`.

| Variable | What it does |
|---|---|
| `AIRTABLE_TOKEN` / `SANDBOX_AIRTABLE_TOKEN` | **required** on the desk |
| `AIRTABLE_BASE` / `SANDBOX_AIRTABLE_BASE` | **required** on the desk |
| `SANDBOX_SECRET` | signs invite links and the desk cookie. Falls back to `SESSION_SECRET` |
| `SANDBOX_ADMINS` | who may read the list. Falls back to `ADMIN_EMAILS` |
| `SANDBOX_ADMIN_KEY` | passphrase way in, for a desk with no sign-in of its own |
| `SANDBOX_WEBHOOK` | any POST-JSON hook — Slack, Make, IFTTT — pinged on each report |
| `SANDBOX_RESEND_KEY` + `SANDBOX_FROM` + `SANDBOX_NOTIFY` | email on each report |
| `SANDBOX_GUESTS` `SANDBOX_DESK` `SANDBOX_PROJECT` `SANDBOX_LABEL` `SANDBOX_TABLE` `SANDBOX_SESSION_COOKIE` `SANDBOX_INCLUDE_UNTAGGED` | override the config file per deploy |
| `SANDBOX_FIELDS` | JSON map, to bind to a table whose fields are named differently |

Widget attributes: `data-endpoint`, `data-label`, `data-accent`, `data-position`,
`data-require-invite="1"` (show the button only to people who came in on an invite link).

## Notes

Screenshots live as Airtable attachments — no bucket to set up. Airtable's attachment
URLs expire, which is why the desk fetches them fresh on each load rather than
storing links. The widget shrinks anything large to 1600px before sending.

Co·labr runs the kit from copies, like any other project would. Edit `sandbox-kit/`,
then run `scripts/sync-sandbox-kit.sh`.
