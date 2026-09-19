import { describe, expect, it } from "vitest";
import { CLIENT_ID, buildConnectUrl, newPkcePair, newStateToken, parseAuthRedirect, trimBase } from "../src/oauth";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

describe("CLIENT_ID", () => {
  it("matches the clientId this extension registers as in studylife-developers", () => {
    expect(CLIENT_ID).toBe("studylife-newtab");
  });
});

describe("newStateToken", () => {
  it("produces an unpadded base64url string", () => {
    const state = newStateToken();
    expect(state).toMatch(BASE64URL_RE);
  });

  it("produces a different value on every call", () => {
    const a = newStateToken();
    const b = newStateToken();
    expect(a).not.toBe(b);
  });
});

describe("newPkcePair", () => {
  it("produces an unpadded base64url verifier and challenge", async () => {
    const { verifier, challenge } = await newPkcePair();
    expect(verifier).toMatch(BASE64URL_RE);
    expect(challenge).toMatch(BASE64URL_RE);
  });

  it("produces a different pair on every call", async () => {
    const a = await newPkcePair();
    const b = await newPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it("challenge is exactly the base64url SHA-256 digest of the verifier's ASCII bytes (S256, as the server expects)", async () => {
    const { verifier, challenge } = await newPkcePair();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    const expected = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });
});

describe("trimBase", () => {
  it("strips a single trailing slash", () => {
    expect(trimBase("https://studylife.example.com/")).toBe("https://studylife.example.com");
  });

  it("strips multiple trailing slashes", () => {
    expect(trimBase("https://studylife.example.com///")).toBe("https://studylife.example.com");
  });

  it("leaves a URL with no trailing slash unchanged", () => {
    expect(trimBase("https://studylife.example.com")).toBe("https://studylife.example.com");
  });
});

describe("buildConnectUrl", () => {
  it("assembles the generic dynamic-client connect URL exactly as the server expects", () => {
    const url = buildConnectUrl(
      "https://studylife.example.com",
      "studylife-newtab",
      "https://abc.chromiumapp.org/",
      "state123",
      "challenge456",
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://studylife.example.com");
    expect(parsed.pathname).toBe("/connect/client/studylife-newtab");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://abc.chromiumapp.org/");
    expect(parsed.searchParams.get("state")).toBe("state123");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge456");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("URL-encodes a clientId that needs it", () => {
    const url = buildConnectUrl("https://x.example.com", "weird client", "https://abc.chromiumapp.org/", "s", "c");
    expect(url).toContain("/connect/client/weird%20client");
  });

  it("strips a trailing slash from the base URL before concatenating the path", () => {
    const url = buildConnectUrl("https://x.example.com/", "studylife-newtab", "https://abc.chromiumapp.org/", "s", "c");
    expect(url.startsWith("https://x.example.com/connect/client/")).toBe(true);
    expect(url).not.toContain("//connect");
  });
});

describe("parseAuthRedirect", () => {
  const state = "abc123";

  it("returns the assertion for a valid redirect with matching state", () => {
    const result = parseAuthRedirect(`https://ext.chromiumapp.org/?assertion=tok&state=${state}`, state);
    expect(result).toEqual({ ok: true, assertion: "tok" });
  });

  it("flags invalid-redirect when assertion is missing", () => {
    const result = parseAuthRedirect(`https://ext.chromiumapp.org/?state=${state}`, state);
    expect(result).toEqual({ ok: false, kind: "invalid-redirect" });
  });

  it("flags invalid-redirect when state is missing", () => {
    const result = parseAuthRedirect("https://ext.chromiumapp.org/?assertion=tok", state);
    expect(result).toEqual({ ok: false, kind: "invalid-redirect" });
  });

  it("flags state-mismatch when the state does not round-trip", () => {
    const result = parseAuthRedirect("https://ext.chromiumapp.org/?assertion=tok&state=wrong", state);
    expect(result).toEqual({ ok: false, kind: "state-mismatch" });
  });

  it("flags invalid-redirect for an unparseable URL", () => {
    expect(parseAuthRedirect("not a url", state)).toEqual({ ok: false, kind: "invalid-redirect" });
  });

  it("tolerates extra query params", () => {
    const result = parseAuthRedirect(`https://ext.chromiumapp.org/?assertion=tok&state=${state}&extra=1`, state);
    expect(result).toEqual({ ok: true, assertion: "tok" });
  });
});
