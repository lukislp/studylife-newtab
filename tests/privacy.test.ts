import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// PRIVACY.md promises an exact list of server requests. Keep it in step with what api.ts really
// calls, so the policy cannot silently drift from the code again.
const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const privacy = readFileSync(new URL("../PRIVACY.md", import.meta.url), "utf8");

function calledGetPaths(): string[] {
  const paths = [...apiSource.matchAll(/getJson<[^>]*(?:>\[\])?>\(\s*settings,\s*[`"]([^`"?$]+)/g)].map((m) => m[1]!);
  return [...new Set(paths)].sort();
}

describe("PRIVACY.md request list", () => {
  it("finds the read endpoints in api.ts", () => {
    expect(calledGetPaths()).toHaveLength(7);
  });

  it("names every endpoint the extension calls", () => {
    for (const path of calledGetPaths()) {
      expect(privacy, `PRIVACY.md does not mention ${path}`).toContain(`\`${path}`);
    }
  });

  it("states the correct number of requests per new tab", () => {
    expect(privacy).toContain("six read-only requests");
  });

  it("carries the controller and publisher block", () => {
    expect(privacy).toContain("the operator of your instance");
    expect(privacy).toContain("https://lktec.org/impressum");
  });
});
