import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSettings,
  loadDraftServerUrl,
  loadStoredSettings,
  normalizeServerUrl,
  saveDraftServerUrl,
  saveSettings,
} from "../src/settings";
import { createChromeStorageStub } from "./chrome-storage-stub";

const storage = createChromeStorageStub();

beforeEach(() => {
  storage.reset();
  storage.install();
});

describe("normalizeServerUrl", () => {
  it("strips a single trailing slash", () => {
    expect(normalizeServerUrl("https://studylife.example.com/")).toBe("https://studylife.example.com");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeServerUrl("https://studylife.example.com///")).toBe("https://studylife.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeServerUrl("  https://studylife.example.com  ")).toBe("https://studylife.example.com");
  });

  it("leaves a plain URL with no trailing slash unchanged", () => {
    expect(normalizeServerUrl("https://studylife.example.com")).toBe("https://studylife.example.com");
  });

  // The base-URL-only guarantee: whatever path/query/hash the user pastes in gets stripped down
  // to just the origin, so every API call in api.ts appends its own path onto a clean base
  // rather than accidentally duplicating or conflicting with one the user typed.
  it("strips a path down to just the origin", () => {
    expect(normalizeServerUrl("https://studylife.example.com/setup")).toBe("https://studylife.example.com");
  });

  it("strips a query string and hash down to just the origin", () => {
    expect(normalizeServerUrl("https://studylife.example.com/login?x=1#y")).toBe("https://studylife.example.com");
  });

  it("preserves a non-default port", () => {
    expect(normalizeServerUrl("https://studylife.example.com:8443/anything")).toBe("https://studylife.example.com:8443");
  });

  it("handles trailing whitespace mixed with trailing slashes without leaving a stray space", () => {
    expect(normalizeServerUrl("https://studylife.example.com/ /")).toBe("https://studylife.example.com");
  });
});

describe("loadStoredSettings / saveSettings / clearSettings", () => {
  const serverUrl = "https://studylife.example.com";

  it("returns null when nothing is stored", async () => {
    await expect(loadStoredSettings()).resolves.toBeNull();
  });

  it("returns null when only a draft (no apiKey) exists", async () => {
    await saveSettings({ serverUrl, apiKey: "" });
    await expect(loadStoredSettings()).resolves.toBeNull();
  });

  it("round-trips a fully connected settings record", async () => {
    await saveSettings({ serverUrl, apiKey: "secret" });
    await expect(loadStoredSettings()).resolves.toEqual({ serverUrl, apiKey: "secret" });
  });

  it("clearSettings removes a connected record", async () => {
    await saveSettings({ serverUrl, apiKey: "secret" });
    await clearSettings();
    await expect(loadStoredSettings()).resolves.toBeNull();
  });
});

describe("draft server URL", () => {
  it("returns an empty string when no draft is stored", async () => {
    await expect(loadDraftServerUrl()).resolves.toBe("");
  });

  it("round-trips a saved draft", async () => {
    await saveDraftServerUrl("https://studylife.example.com");
    await expect(loadDraftServerUrl()).resolves.toBe("https://studylife.example.com");
  });
});
