// Service worker: runs the one-time generic dynamic-client connect flow (see connect.ts/oauth.ts
// for why this lives here rather than in options.ts). The dashboard itself (newtab.ts) fetches
// live every time a new tab opens - there is no polling/alarm infrastructure in this extension,
// unlike studylife-focus's Guard/Tune, since a new tab page has no persistent background need
// beyond "make Connect survive the permission-prompt focus loss".
import {
  CLIENT_ID,
  buildConnectUrl,
  newPkcePair,
  newStateToken,
  parseAuthRedirect,
} from "./oauth";
import {
  clearPendingConnect,
  describeConnectResult,
  isConnectMessage,
  takePendingConnect,
  type ConnectResult,
} from "./connect";
import { exchangeAssertion, fetchWhoami, type ApiFailure } from "./api";
import { normalizeServerUrl, saveSettings } from "./settings";

chrome.permissions.onAdded.addListener((added) => {
  void (async () => {
    const serverUrl = await takePendingConnect(added.origins ?? []);
    if (!serverUrl) return;
    await handleConnectRequest(serverUrl).catch((e: unknown) =>
      finishConnect({ ok: false, kind: "auth-window-failed", message: describeUnknownError(e) }),
    );
  })();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isConnectMessage(message)) return undefined;
  // Returning true keeps the message channel open so the sendResponse below can fire once
  // handleConnectRequest's async chain resolves - see connect.ts for why this whole flow lives
  // here rather than in the calling page. sendResponse is best-effort: if the options page
  // already closed (the expected, common case once the auth window opens), this simply has no
  // listener left to reach, and the notify() call inside handleConnectRequest is what the user
  // actually sees. The .catch is load-bearing: an unhandled rejection here dies silently in the
  // service worker and the user sees NOTHING.
  void handleConnectRequest(message.serverUrl)
    .catch((e: unknown) => finishConnect({ ok: false, kind: "auth-window-failed", message: describeUnknownError(e) }))
    .then(sendResponse);
  return true;
});

async function handleConnectRequest(rawServerUrl: string): Promise<ConnectResult> {
  const serverUrl = normalizeServerUrl(rawServerUrl);

  let origin: string;
  try {
    origin = `${new URL(serverUrl).origin}/*`;
  } catch {
    return { ok: false, kind: "invalid-url" };
  }

  // Contains-check ONLY - the actual permissions.request() happens in the calling page, inside
  // its own user gesture (permissions.request() throws outside one - see connect.ts's
  // requestHostPermission and options.ts). If the grant hasn't landed by the time this runs,
  // options.ts staked a pending-connect marker before prompting, and the
  // chrome.permissions.onAdded listener above resumes this exact flow once the grant does land -
  // page survival is not required either way.
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    return { ok: false, kind: "permission-denied" };
  }
  await clearPendingConnect();

  const state = newStateToken();
  const { verifier, challenge } = await newPkcePair();
  const redirectUri = chrome.identity.getRedirectURL();
  const connectUrl = buildConnectUrl(serverUrl, CLIENT_ID, redirectUri, state, challenge);

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: connectUrl, interactive: true });
  } catch (error) {
    const message = describeUnknownError(error);
    if (/did not approve|cancel/i.test(message)) {
      return finishConnect({ ok: false, kind: "cancelled" });
    }
    return finishConnect({ ok: false, kind: "auth-window-failed", message });
  }
  if (!responseUrl) {
    return finishConnect({ ok: false, kind: "cancelled" });
  }

  const redirectResult = parseAuthRedirect(responseUrl, state);
  if (!redirectResult.ok) {
    return finishConnect({ ok: false, kind: redirectResult.kind });
  }

  const exchange = await exchangeAssertion(serverUrl, CLIENT_ID, redirectResult.assertion, verifier);
  if (!exchange.ok) {
    if (exchange.kind === "not-found") return finishConnect({ ok: false, kind: "server-outdated" });
    if (exchange.kind === "offline") return finishConnect({ ok: false, kind: "offline" });
    const message = exchange.kind === "http" || exchange.kind === "network" ? exchange.message : "unknown error";
    return finishConnect({ ok: false, kind: "exchange-failed", message });
  }

  // Verify the freshly issued key actually works before persisting it as "connected" - this
  // project's standing rule is to never show a connected state the dashboard can't actually back
  // up with real data (see README "Offline and error states").
  const whoami = await fetchWhoami({ serverUrl, apiKey: exchange.apiKey });
  if (!whoami.ok) {
    return finishConnect({ ok: false, kind: "verify-failed", message: describeApiFailure(whoami) });
  }

  await saveSettings({ serverUrl, apiKey: exchange.apiKey });
  return finishConnect({ ok: true, serverUrl });
}

function finishConnect(result: ConnectResult): ConnectResult {
  if (result.ok) {
    notify("Connected to StudyLife", `New Tab is now showing stats from ${result.serverUrl}.`);
  } else {
    notify("StudyLife connect failed", describeConnectResult(result));
  }
  return result;
}

function notify(title: string, message: string): void {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title,
    message,
  });
}

function describeApiFailure(failure: ApiFailure): string {
  switch (failure.kind) {
    case "offline":
      return "you appear to be offline";
    case "unauthorized":
      return "the server rejected the key (401/403)";
    case "http":
      return `the server returned HTTP ${failure.status}`;
    case "network":
      return failure.message;
  }
}

function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
