import fc from "fast-check";
import { describe, it } from "vitest";
import { buildConnectUrl, parseAuthRedirect, trimBase } from "../src/oauth";
import { normalizeServerUrl } from "../src/settings";

describe("normalizeServerUrl (property-based)", () => {
  it("is idempotent: normalizing a normalized URL changes nothing", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const once = normalizeServerUrl(raw);
        return normalizeServerUrl(once) === once;
      }),
    );
  });

  it("reduces any web URL to its bare origin, dropping path, query and hash", () => {
    fc.assert(
      fc.property(fc.webUrl({ withQueryParameters: true, withFragments: true }), (url) => {
        return normalizeServerUrl(url) === new URL(url).origin;
      }),
    );
  });

  it("never throws and never leaves trailing whitespace or a trailing slash", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const out = normalizeServerUrl(raw);
        return out === out.trimEnd() && !out.endsWith("/");
      }),
    );
  });
});

describe("oauth (property-based)", () => {
  it("trimBase never leaves a trailing slash and is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (base) => {
        const once = trimBase(base);
        return !once.endsWith("/") && trimBase(once) === once;
      }),
    );
  });

  it("buildConnectUrl carries redirect_uri, state and challenge through a URL round trip", () => {
    fc.assert(
      fc.property(
        fc.webUrl({ withQueryParameters: false, withFragments: false }),
        fc.string({ minLength: 1 }),
        fc.webUrl({ withQueryParameters: false, withFragments: false }),
        fc.string(),
        fc.string(),
        (base, clientId, redirect, state, challenge) => {
          const url = new URL(buildConnectUrl(base, clientId, redirect, state, challenge));
          return (
            url.searchParams.get("redirect_uri") === redirect &&
            url.searchParams.get("state") === state &&
            url.searchParams.get("code_challenge") === challenge &&
            url.searchParams.get("code_challenge_method") === "S256"
          );
        },
      ),
    );
  });

  it("parseAuthRedirect accepts exactly a redirect whose state matches and never throws on junk", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.string(), (assertion, state, other) => {
        const redirect = `https://abc.chromiumapp.org/?${new URLSearchParams({ assertion, state })}`;
        const ok = parseAuthRedirect(redirect, state);
        const mismatch = parseAuthRedirect(redirect, other);
        return (
          ok.ok === true &&
          ok.assertion === assertion &&
          (other === state ? mismatch.ok : !mismatch.ok && mismatch.kind === "state-mismatch")
        );
      }),
    );
    fc.assert(
      fc.property(fc.string(), fc.string(), (junk, expected) => {
        const result = parseAuthRedirect(junk, expected);
        return result.ok === true || result.kind === "invalid-redirect" || result.kind === "state-mismatch";
      }),
    );
  });
});
