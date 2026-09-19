# Privacy Policy - StudyLife New Tab

StudyLife New Tab is a browser extension for a self-hosted
[StudyLife](https://github.com/lukislp/studylife) instance. There is no vendor server involved -
your data goes at most two places: your own StudyLife server, and your own device's local browser
storage.

## What this extension reads

Every time you open a new tab, it makes four read-only calls to the StudyLife server you
configured, using one API key scoped to exactly these four capabilities and nothing else (see the
`studylife` repo's `ApiKeyScopes` for the server-enforced scope):

- **`GET /api/auth/whoami`** - to confirm the stored key still works (shown on the Settings page,
  and used right after connecting to verify the new key before it's saved).
- **`GET /api/timerstate`** - whether a focus session is currently running, to show the "Studying
  now" badge.
- **`GET /api/metrics/summary`** - hours studied this week and your current/longest streak.
- **`GET /api/coursegoals`** - your course goals, to find and show the nearest upcoming deadline.

No other endpoint is ever called. This extension has no write scope at all - the key it holds
cannot start, stop, or change anything in your StudyLife account, even if it wanted to.

## What this extension stores

Locally, in the browser's own extension storage, never transmitted anywhere except back to the
StudyLife server you configured:

- Your StudyLife server's base URL.
- Your API key (obtained via the passkey-backed browser-consent connect flow - you never see or
  copy/paste it yourself).

Nothing else is stored: no cache of your stats persists between new-tab opens - each new tab
fetches fresh data, and a fetch that fails shows an explicit error state rather than old numbers.

## What this extension never does

- Never collects analytics, telemetry, or crash reports.
- Never contacts any server other than the one you explicitly configure.
- Never writes anything to your StudyLife account - the API key is read-only by server-side
  design (no write scope is ever requested), and this extension has no UI to write anything even
  if it held one.
- Never shows stale data as if it were live - a failed request always says so.

## Source

This extension is open source (AGPL-3.0): <https://github.com/lukislp/studylife-newtab>.
