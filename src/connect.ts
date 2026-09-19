// Browser-consent connect flow: shared between options.ts (where the user clicks "Connect", i.e.
// where the trusted user gesture originates) and background.ts (which actually runs the flow). It
// has to live in the service worker, not the options page, because
// chrome.identity.launchWebAuthFlow()'s interactive auth window steals focus and closes the
// extension's page mid-await - the same focus-loss behavior the plain chrome.permissions.request()
// prompt already shows. Running the whole chain (permission request, auth window, token exchange)
// in the service worker means it survives regardless of what happens to the calling page once
// either dialog opens. Mirrors studylife-focus's connect.ts, minus the per-audience parameter -
// this extension only ever speaks to one audience (the generic dynamic-client flow, clientId
// "studylife-newtab"), unlike Guard/Tune's two separately-consented hardcoded slots.

export const CONNECT_MESSAGE_TYPE = "studylife-newtab:connect";

export interface ConnectMessage {
  type: typeof CONNECT_MESSAGE_TYPE;
  serverUrl: string;
}

export function isConnectMessage(message: unknown): message is ConnectMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; serverUrl?: unknown };
  return candidate.type === CONNECT_MESSAGE_TYPE && typeof candidate.serverUrl === "string";
}

export type ConnectResult =
  | { ok: true; serverUrl: string }
  | { ok: false; kind: "invalid-url" }
  | { ok: false; kind: "permission-denied" }
  | { ok: false; kind: "cancelled" }
  | { ok: false; kind: "auth-window-failed"; message: string }
  | { ok: false; kind: "invalid-redirect" }
  | { ok: false; kind: "state-mismatch" }
  | { ok: false; kind: "server-outdated" }
  | { ok: false; kind: "offline" }
  | { ok: false; kind: "exchange-failed"; message: string }
  | { ok: false; kind: "verify-failed"; message: string };

// Single source of truth for the connect flow's user-facing text, so background.ts's notification
// (the reliable channel, since the options page is expected to close mid-flow - see above) and
// options.ts's inline status (a best-effort extra, shown only if the page happens to survive)
// never drift into inconsistent wording for the same outcome.
export function describeConnectResult(result: ConnectResult): string {
  if (result.ok) {
    return "Connected to StudyLife.";
  }
  switch (result.kind) {
    case "invalid-url":
      return "Enter a valid server URL, e.g. https://studylife.example.com";
    case "permission-denied":
      return "Permission to access this server was denied - try connecting again and allow access when prompted.";
    case "cancelled":
      return "Connection cancelled.";
    case "auth-window-failed":
      return `Couldn't open StudyLife's login page: ${result.message}`;
    case "invalid-redirect":
      return "StudyLife's response was missing the expected data - try connecting again.";
    case "state-mismatch":
      return "Couldn't verify the connection response - try connecting again.";
    case "server-outdated":
      return "This StudyLife server doesn't support browser connect yet, or \"studylife-newtab\" isn't registered on it - see the README for how to register it once via studylife-developers.";
    case "offline":
      return "You're offline - connect again once you're back online.";
    case "exchange-failed":
      return `Couldn't complete the connection: ${result.message}`;
    case "verify-failed":
      return `Connected, but the new API key didn't work: ${result.message}`;
  }
}

// Called from options.ts inside the Connect button's own user gesture (permissions.request throws
// outside one) - requests access to exactly the given origin(s), no broader host_permissions
// declared upfront (see manifest.json). Persists once granted, so this is a no-op on every later
// call unless something in the requested set isn't already held.
export async function requestHostPermission(origins: readonly string[]): Promise<boolean> {
  if (await chrome.permissions.contains({ origins: [...origins] })) return true;
  return chrome.permissions.request({ origins: [...origins] });
}

// Page-death handoff for the connect flow: the host-permission prompt steals focus and closes
// the options page, killing its JS BETWEEN the user's grant and the sendMessage that would start
// the auth flow. So the page stakes a pending-connect marker BEFORE prompting, and background.ts's
// chrome.permissions.onAdded listener takes it from there: grant lands -> the service worker
// consumes the marker and opens the auth window itself, page survival not required. take* is
// consume-once and TTL-bound so a stale marker from an abandoned attempt can't fire minutes later
// on an unrelated permission grant. Mirrors studylife-focus's connect.ts, minus the per-audience
// key (only one connect flow exists here).
const PENDING_CONNECT_KEY = "pendingConnect";
const PENDING_CONNECT_TTL_MS = 2 * 60 * 1000;

export async function setPendingConnect(serverUrl: string): Promise<void> {
  await chrome.storage.local.set({ [PENDING_CONNECT_KEY]: { serverUrl, ts: Date.now() } });
}

export async function clearPendingConnect(): Promise<void> {
  await chrome.storage.local.remove(PENDING_CONNECT_KEY);
}

// grantedOrigins: the origins of the permission grant that woke the caller - the marker is only
// consumed when it actually belongs to one of them, so an unrelated grant (e.g. for a different
// server origin) can neither trigger nor destroy a pending connect. A malformed or expired marker
// is always cleaned up.
export async function takePendingConnect(grantedOrigins: readonly string[]): Promise<string | undefined> {
  const stored = (await chrome.storage.local.get(PENDING_CONNECT_KEY))[PENDING_CONNECT_KEY] as
    | { serverUrl?: unknown; ts?: unknown }
    | undefined;
  if (!stored) return undefined;
  if (typeof stored.serverUrl !== "string" || typeof stored.ts !== "number" || Date.now() - stored.ts > PENDING_CONNECT_TTL_MS) {
    await chrome.storage.local.remove(PENDING_CONNECT_KEY);
    return undefined;
  }
  let origin: string;
  try {
    origin = `${new URL(stored.serverUrl).origin}/*`;
  } catch {
    await chrome.storage.local.remove(PENDING_CONNECT_KEY);
    return undefined;
  }
  if (!grantedOrigins.includes(origin)) return undefined;
  await chrome.storage.local.remove(PENDING_CONNECT_KEY);
  return stored.serverUrl;
}
