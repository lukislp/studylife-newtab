// Pure half of the generic dynamic-client OAuth+PKCE login round trip: no chrome.* APIs in here,
// so the parts that are easy to get subtly wrong (PKCE shape, connect-URL assembly, redirect
// parsing) are unit-testable without any browser mocking.
//
// Ported in shape from studylife-raycast's oauth.ts (itself the generic-flow port of
// studylife-vscode's oauth.ts / studylife-cli's login.py), adapted from Node's node:crypto to the
// Web Crypto API (SubtleCrypto) - this runs inside a Manifest V3 service worker, which has no
// node:crypto. Keep the wire shapes identical to that reference: the server validates them
// strictly, and this extension has no loopback listener of its own - it uses
// chrome.identity.launchWebAuthFlow() instead (see connect.ts/background.ts), whose redirect
// lands on this extension's fixed https://<extension-id>.chromiumapp.org/ callback (fixed because
// manifest.json embeds a "key", see README "Development / stable extension ID").

export const CLIENT_ID = "studylife-newtab";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Unreserved-character base64url, with no padding - both the verifier and the state token use
 *  this alphabet, matching the server's S256 PKCE validation. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newStateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** (verifier, challenge) as the server's S256 validation expects: a random verifier and the
 *  unpadded base64url SHA-256 digest of its ASCII bytes. */
export async function newPkcePair(): Promise<PkcePair> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = toBase64Url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = toBase64Url(new Uint8Array(digest));
  return { verifier, challenge };
}

/** Strips a trailing slash so callers can concatenate paths without producing "//". */
export function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function buildConnectUrl(
  baseUrl: string,
  clientId: string,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const query = new URLSearchParams({
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${trimBase(baseUrl)}/connect/client/${encodeURIComponent(clientId)}?${query}`;
}

export interface AuthRedirectResult {
  assertion: string;
}

export type AuthRedirectParseResult =
  | { ok: true; assertion: string }
  | { ok: false; kind: "invalid-redirect" | "state-mismatch" };

/** Parses the redirect chrome.identity.launchWebAuthFlow() hands back
 *  (<redirect_uri>?assertion=..&state=..) and checks the state round-trips, guarding against a
 *  forged or replayed redirect landing on the extension's own chromiumapp.org callback URL. */
export function parseAuthRedirect(responseUrl: string, expectedState: string): AuthRedirectParseResult {
  let parsed: URL;
  try {
    parsed = new URL(responseUrl);
  } catch {
    return { ok: false, kind: "invalid-redirect" };
  }
  const assertion = parsed.searchParams.get("assertion");
  const state = parsed.searchParams.get("state");
  if (!assertion || !state) {
    return { ok: false, kind: "invalid-redirect" };
  }
  if (state !== expectedState) {
    return { ok: false, kind: "state-mismatch" };
  }
  return { ok: true, assertion };
}
