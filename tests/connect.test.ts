import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_MESSAGE_TYPE,
  clearPendingConnect,
  describeConnectResult,
  isConnectMessage,
  requestHostPermission,
  setPendingConnect,
  takePendingConnect,
  type ConnectResult,
} from "../src/connect";
import { createChromeStorageStub } from "./chrome-storage-stub";

const storage = createChromeStorageStub();

beforeEach(() => {
  storage.reset();
  storage.install();
});

describe("isConnectMessage", () => {
  it("recognizes a well-formed message", () => {
    expect(isConnectMessage({ type: CONNECT_MESSAGE_TYPE, serverUrl: "https://x" })).toBe(true);
  });

  it("rejects unrelated or malformed shapes", () => {
    expect(isConnectMessage(null)).toBe(false);
    expect(isConnectMessage(undefined)).toBe(false);
    expect(isConnectMessage({})).toBe(false);
    expect(isConnectMessage({ type: "some-other-message", serverUrl: "https://x" })).toBe(false);
    expect(isConnectMessage({ type: CONNECT_MESSAGE_TYPE })).toBe(false);
    expect(isConnectMessage({ type: CONNECT_MESSAGE_TYPE, serverUrl: 123 })).toBe(false);
  });
});

describe("describeConnectResult", () => {
  const allResults: ConnectResult[] = [
    { ok: true, serverUrl: "https://example.com" },
    { ok: false, kind: "invalid-url" },
    { ok: false, kind: "permission-denied" },
    { ok: false, kind: "cancelled" },
    { ok: false, kind: "auth-window-failed", message: "boom" },
    { ok: false, kind: "invalid-redirect" },
    { ok: false, kind: "state-mismatch" },
    { ok: false, kind: "server-outdated" },
    { ok: false, kind: "offline" },
    { ok: false, kind: "exchange-failed", message: "boom" },
    { ok: false, kind: "verify-failed", message: "boom" },
  ];

  it.each(allResults)("returns a non-empty string for every ConnectResult kind", (result) => {
    expect(describeConnectResult(result).length).toBeGreaterThan(0);
  });

  it("returns the exact connected message", () => {
    expect(describeConnectResult({ ok: true, serverUrl: "https://x" })).toBe("Connected to StudyLife.");
  });

  it("returns the exact cancelled message", () => {
    expect(describeConnectResult({ ok: false, kind: "cancelled" })).toBe("Connection cancelled.");
  });

  it("includes the underlying message for exchange-failed", () => {
    expect(describeConnectResult({ ok: false, kind: "exchange-failed", message: "network down" })).toBe(
      "Couldn't complete the connection: network down",
    );
  });
});

describe("requestHostPermission", () => {
  it("returns true immediately if the origin is already granted", async () => {
    storage.grantOrigins(["https://x/*"]);
    await expect(requestHostPermission(["https://x/*"])).resolves.toBe(true);
  });

  it("requests and grants when not already held", async () => {
    await expect(requestHostPermission(["https://x/*"])).resolves.toBe(true);
  });
});

describe("pending connect marker", () => {
  const serverUrl = "https://studylife.example.com";
  const origin = "https://studylife.example.com/*";

  it("round-trips through set -> take with a matching granted origin", async () => {
    await setPendingConnect(serverUrl);
    await expect(takePendingConnect([origin])).resolves.toBe(serverUrl);
  });

  it("returns nothing and leaves the marker when granted origins don't match", async () => {
    await setPendingConnect(serverUrl);
    await expect(takePendingConnect(["https://other.example.com/*"])).resolves.toBeUndefined();
    await expect(takePendingConnect([origin])).resolves.toBe(serverUrl);
  });

  it("cleans up an expired marker", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      vi.setSystemTime(start);
      await setPendingConnect(serverUrl);
      vi.setSystemTime(start + 2 * 60 * 1000 + 1); // just past the 2-minute TTL
      await expect(takePendingConnect([origin])).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    expect(storage.raw().pendingConnect).toBeUndefined();
  });

  it("cleans up a malformed marker", async () => {
    storage.raw().pendingConnect = { serverUrl: 123, ts: "not-a-number" };
    await expect(takePendingConnect([origin])).resolves.toBeUndefined();
    expect(storage.raw().pendingConnect).toBeUndefined();
  });

  it("returns nothing on a second take after the marker was already consumed", async () => {
    await setPendingConnect(serverUrl);
    await takePendingConnect([origin]);
    await expect(takePendingConnect([origin])).resolves.toBeUndefined();
  });

  it("clearPendingConnect removes the marker", async () => {
    await setPendingConnect(serverUrl);
    await clearPendingConnect();
    await expect(takePendingConnect([origin])).resolves.toBeUndefined();
  });
});
