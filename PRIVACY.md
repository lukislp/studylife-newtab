# Privacy Policy - StudyAtrium New Tab

StudyAtrium New Tab is a browser extension for a self-hosted
[StudyAtrium](https://github.com/lukislp/studylife) instance. There is no vendor server involved -
your data goes at most two places: your own StudyAtrium server, and your own device's local browser
storage.

**Controller:** the operator of your instance. **Publisher:** see the imprint at
<https://lktec.org/impressum>.

## What this extension reads

Every time you open a new tab, it makes **six read-only requests** (`GET`) to the StudyAtrium
server you configured, all in parallel, using the API key it holds:

- **`/api/metrics/summary`** - hours studied this week, your current and longest streak, and
  programme progress.
- **`/api/coursegoals`** - your course goals (course name, target date, completion), to show the
  nearest deadlines.
- **`/api/timerstate`** - whether a focus session is currently running, for the "Studying now"
  badge.
- **`/api/sessions`** - your study sessions, for the "Upcoming sessions" panel.
- **`/api/sessions/history?days=14&onlyCompleted=true`** - your completed sessions of the last
  14 days, for the "Recent activity" panel.
- **`/api/notes`** - **all of your notes, including their full text**, of which the page shows
  only the most recently updated ones as a title and a one-line preview. The full list is
  transferred from your server to your browser on every new tab; it is neither stored nor sent
  anywhere else.

A seventh request, **`/api/auth/whoami`**, is made only when you open the Settings page and right
after connecting, to confirm the key works.

The key is limited to exactly these seven read endpoints (the scopes `Whoami`, `TimerState.Get`,
`Metrics.GetSummary`, `CourseGoals.GetAll`, `Sessions.GetAll`, `Sessions.GetHistory` and
`Notes.GetAll`, enforced by your server). It has no write scope: it cannot start, stop, create or
change anything in your StudyAtrium account. Reading is not harmless, though - the key gives
access to your notes and study data, so treat it like a password.

## What this extension stores

Locally, in the browser's own extension storage (`chrome.storage.local`), never transmitted
anywhere except back to the StudyAtrium server you configured:

- Your StudyAtrium server's base URL.
- Your API key, stored as plain text in the extension storage of your browser profile (obtained
  via the passkey-backed browser-consent connect flow - you never see or copy/paste it yourself).
- A draft copy of the server URL you typed on the Settings page (kept so a connect attempt survives the browser's permission prompt; it stays until you remove the extension), and a pending-connect marker (server URL and timestamp) that is removed when the connect flow ends.

Nothing from the responses is cached: no stats, session data or notes persist between new-tab
opens. Each new tab fetches fresh data, and a failed fetch shows an explicit error state rather
than old numbers.

The extension also shows desktop notifications about the result of connecting (connected or
failed); these are local and contain only the server address.

## What this extension never does

- Never collects analytics, telemetry, or crash reports.
- Never contacts any server other than the one you explicitly configure.
- Never writes anything to your StudyAtrium account.
- Never shows stale data as if it were live - a failed request always says so.

## Deleting your data

Use **Disconnect** on the Settings page to remove the stored server URL and API key; remove the
extension to delete everything it stored locally, including the draft server URL. To make the key unusable on the server side as
well, revoke it in your StudyAtrium instance.

## Source

This extension is open source (AGPL-3.0): <https://github.com/lukislp/studylife-newtab>.

