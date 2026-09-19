import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COURSE_GOAL_FIELDS,
  METRICS_HOURS_FIELDS,
  METRICS_STREAK_FIELDS,
  METRICS_SUMMARY_FIELDS,
  TIMER_STATE_FIELDS,
  WHOAMI_FIELDS,
  exchangeAssertion,
  fetchMetricsSummary,
  fetchWhoami,
} from "../src/api";

const settings = { serverUrl: "https://studylife.example.com", apiKey: "secret-key" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("field constants (contract-check.mjs diffs these against the OpenAPI spec)", () => {
  it("are all non-empty and contain the fields the dashboard actually reads", () => {
    expect(WHOAMI_FIELDS).toEqual(["userId", "credential"]);
    expect(TIMER_STATE_FIELDS).toContain("isRunning");
    expect(METRICS_SUMMARY_FIELDS).toEqual(["asOf", "streak", "hours"]);
    expect(METRICS_STREAK_FIELDS).toEqual(["current", "longest"]);
    expect(METRICS_HOURS_FIELDS).toEqual(["week"]);
    expect(COURSE_GOAL_FIELDS).toEqual(["courseId", "courseName", "targetDate", "completedAt"]);
  });
});

describe("fetchWhoami", () => {
  it("sends the X-Api-Key header and returns the parsed body on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ userId: 42, credential: "session" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWhoami(settings);

    expect(result).toEqual({ ok: true, data: { userId: 42, credential: "session" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://studylife.example.com/api/auth/whoami");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("secret-key");
  });

  it("reports unauthorized on a 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(fetchWhoami(settings)).resolves.toEqual({ ok: false, kind: "unauthorized" });
  });

  it("reports offline without calling fetch at all", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWhoami(settings)).resolves.toEqual({ ok: false, kind: "offline" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a network failure when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(fetchWhoami(settings)).resolves.toEqual({ ok: false, kind: "network", message: "boom" });
  });
});

describe("fetchMetricsSummary", () => {
  it("hits /api/metrics/summary and returns the parsed body", async () => {
    const body = { asOf: "2026-09-19T14:00:00", streak: { current: 3, longest: 10 }, hours: { week: 4.5 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMetricsSummary(settings)).resolves.toEqual({ ok: true, data: body });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://studylife.example.com/api/metrics/summary");
  });

  it("reports an http failure for a non-2xx, non-401/403 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(fetchMetricsSummary(settings)).resolves.toEqual({ ok: false, kind: "http", status: 500 });
  });
});

describe("exchangeAssertion", () => {
  const serverUrl = "https://studylife.example.com";

  it("posts clientId/assertion/codeVerifier with no X-Api-Key and returns the issued apiKey", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ apiKey: "new-key" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeAssertion(serverUrl, "studylife-newtab", "assertion-token", "verifier-value");

    expect(result).toEqual({ ok: true, apiKey: "new-key" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://studylife.example.com/api/auth/assertion-exchange");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      clientId: "studylife-newtab",
      assertion: "assertion-token",
      codeVerifier: "verifier-value",
    });
  });

  it("reports not-found on a 404 (server predates the generic connect endpoint)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    await expect(exchangeAssertion(serverUrl, "studylife-newtab", "a", "v")).resolves.toEqual({
      ok: false,
      kind: "not-found",
    });
  });

  it("flags a response missing apiKey as an http failure instead of returning undefined", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ userId: 1 })));
    const result = await exchangeAssertion(serverUrl, "studylife-newtab", "a", "v");
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "http") {
      expect(result.message).toContain("apiKey");
    } else {
      throw new Error("expected an http failure");
    }
  });
});
