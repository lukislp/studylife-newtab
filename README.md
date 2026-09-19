# StudyLife New Tab

[![CI](https://github.com/lukislp/studylife-newtab/actions/workflows/ci.yml/badge.svg)](https://github.com/lukislp/studylife-newtab/actions/workflows/ci.yml) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/lukislp/studylife-newtab/badge)](https://scorecard.dev/viewer/?uri=github.com/lukislp/studylife-newtab) [![CodeQL](https://github.com/lukislp/studylife-newtab/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/lukislp/studylife-newtab/security/code-scanning)
[![Release](https://img.shields.io/github/v/release/lukislp/studylife-newtab)](https://github.com/lukislp/studylife-newtab/releases)
[![License: AGPL-3.0](https://img.shields.io/github/license/lukislp/studylife-newtab)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](https://www.typescriptlang.org/)

A browser extension that replaces the New Tab page with a calm, read-only dashboard of your
[StudyLife](https://github.com/lukislp/studylife) stats: hours studied this week, your current
streak, and your next course-goal deadline - one glance, every time you open a tab, no clicking
into the app required.

Part of the `studylife-*` family of companion add-ons for a self-hosted study tracker
(alongside [studylife-focus](https://github.com/lukislp/studylife-focus),
[studylife-tray](https://github.com/lukislp/studylife-tray),
[studylife-raycast](https://github.com/lukislp/studylife-raycast), and others). Like those, it
speaks only to the StudyLife server you configure - there is no vendor server, no analytics, no
telemetry.

## What it shows

- **Hours studied this week** - the dashboard's focal number. There is deliberately no "today"
  number: `GET /api/metrics/summary` (StudyLife's `MetricsSummaryDto`) only carries week/month/
  total studied hours, not a per-day figure, so this extension shows the number the server
  actually, honestly provides rather than inventing one client-side.
- **Current streak** (and your longest, once you beat it).
- **Your next open course-goal deadline** - "in 3 days", "today", or "2 days overdue" - found by
  reading your full course-goal list directly (`GET /api/coursegoals`), not through the metrics
  endpoint's separately-cached, 5-item-capped projection.
- **A small "Studying now" badge** when a focus session is currently running
  (`GET /api/timerstate`).
- A greeting that changes with the time of day, and a clear "Updated HH:MM (StudyLife server
  time)" line so you always know how fresh what you're looking at is.

This extension is **read-only**: it holds no write scope at all, so it cannot start, stop, or
change anything in your StudyLife account, even if it wanted to. If you want to control your
timer from the browser, see
[studylife-focus](https://github.com/lukislp/studylife-focus) or
[studylife-tray](https://github.com/lukislp/studylife-tray) instead.

## Install

There is no Chrome Web Store listing, so installing means loading it **unpacked** - either from
the packaged release archive, or from your own build. It is a Manifest V3 extension built for
Chrome 120 or newer (`target: chrome120` in `build.mjs`); other Chromium-based browsers use the
same packaging, only their extensions page lives at a different URL.

### From a release

1. Download `studylife-newtab-v<version>.zip` from the
   [latest release](https://github.com/lukislp/studylife-newtab/releases/latest).
2. Unzip it into a folder you intend to keep. `manifest.json` sits at the top level of the
   archive, so the unzipped folder *is* the extension folder - don't wrap it in another one.
3. Open `chrome://extensions` and turn **Developer mode** on (top right).
4. Click **Load unpacked** and select that folder.
5. Open a new tab - you'll see the "Connect" screen. Click it, or go to the extension's own
   Settings page (its **Details -> Extension options** on `chrome://extensions`), and continue
   with "Connecting" below.

Every release also carries a keyless [Sigstore](https://www.sigstore.dev/) signature bundle
(`studylife-newtab-v<version>.zip.sigstore.json`) and a GitHub build-provenance attestation
(`provenance.intoto.jsonl`) next to the archive, both produced by this repo's own CI run. To
check the download is the artifact that pipeline built, before unpacking it:

```bash
cosign verify-blob --bundle studylife-newtab-v<version>.zip.sigstore.json \
  --certificate-identity-regexp '^https://github.com/lukislp/studylife-newtab/\.github/workflows/ci\.yml@refs/heads/main$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  studylife-newtab-v<version>.zip
```

### From source

```bash
npm ci
npm run build      # -> dist/
```

Load `dist/` as an unpacked extension the same way as above.

## Development / stable extension ID

`manifest.json` embeds a fixed public key in its `"key"` field, which makes Chrome derive the
**same extension ID every time** this is loaded unpacked, instead of a random one that would
change on every reload or every machine. This is the standard, documented technique for a
deterministic dev extension ID (`openssl genrsa` a keypair, DER-encode the public half, base64 it
into `manifest.json`'s `key`) - it needs no private key committed anywhere, since only the public
half is ever used this way.

This matters here specifically because of how the connect flow works: `chrome.identity
.launchWebAuthFlow()`'s redirect always lands on `https://<extension-id>.chromiumapp.org/`, and
the generic dynamic-client OAuth+PKCE flow this extension uses (see "Connecting" below) validates
`redirect_uri` by **exact match** against whatever URI was registered for the client in
studylife-developers. A random, reload-dependent ID would mean that registered URI going stale
every time the extension reloads - fixing the ID once, up front, means it never does.

This repository's own extension ID (and therefore its one fixed redirect URI) is:

```
Extension ID:  coempecnaaoacipdjcmkjemkcbfebkem
Redirect URI:  https://coempecnaaoacipdjcmkjemkcbfebkem.chromiumapp.org/
```

If you fork this repository and generate your own key instead of reusing the one already in
`manifest.json`, your extension ID (and redirect URI) will differ - register *your* computed
redirect URI with your own client, not the one above.

## Connecting

StudyLife New Tab authenticates via StudyLife's **generic dynamic-client OAuth+PKCE flow** (the
same one [studylife-raycast](https://github.com/lukislp/studylife-raycast) and
[studylife-vscode](https://github.com/lukislp/studylife-vscode) use), not a pre-vetted
hardcoded-audience slot - so before it can connect, the client has to be registered once on your
server:

1. Open your StudyLife instance's **studylife-developers** portal.
2. Register a new client:
   - **Client ID:** `studylife-newtab`
   - **Scopes:** `Whoami`, `TimerState.Get`, `Metrics.GetSummary`, `CourseGoals.GetAll` (exactly
     these four - no write scope)
   - **Redirect URI:** `https://coempecnaaoacipdjcmkjemkcbfebkem.chromiumapp.org/` (see
     "Development / stable extension ID" above - use your own computed URI instead if you built
     from your own key)
3. In the extension's Settings page, enter your StudyLife server's base URL and click **Connect**.
   A permission prompt appears first (this extension needs your explicit approval to talk to that
   one server origin - it has no broad host permission by default); after granting it, StudyLife's
   own login page opens to confirm the connection. Approve it there, and you're done - open a new
   tab to see your stats.

If step 3 fails with "this StudyLife server doesn't support browser connect yet, or
'studylife-newtab' isn't registered on it", double check step 2 - especially that the redirect URI
matches exactly.

## Offline and error states

This extension never shows stale data as if it were live. Every new tab fetches fresh - there is
no cross-open cache. If a fetch fails, the page says so explicitly instead of falling back to old
numbers:

- **Not connected yet** - StudyLife's brand, a short explanation, and a Connect button.
- **Offline / network error** - an explicit message and a "Try again" button.
- **The stored key was rejected (401/403)** - a message pointing at Settings to reconnect.
- **Partial failure** - if `Metrics.GetSummary` succeeds but `CourseGoals.GetAll` or
  `TimerState.Get` doesn't, the hours/streak numbers (which are real, current data) still render;
  only the affected tile shows its own "couldn't load" message, rather than the whole page failing
  for a fetch it didn't actually need.

## Security

Every release is built by this repository's own CI, keylessly signed with
[Sigstore](https://www.sigstore.dev/), and carries a GitHub build-provenance attestation - see
"From a release" above for how to verify a download. `SECURITY.md` covers how to report a
vulnerability privately.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0](LICENSE).
