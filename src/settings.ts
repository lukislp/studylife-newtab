// Self-hosted, so unlike a typical extension there's no single fixed API host - every user points
// this at their own StudyLife instance. Only the BASE URL is ever stored - every API call appends
// its own path (see api.ts), never the other way around, so the user never has to think about
// paths at all. Mirrors studylife-focus's settings.ts, trimmed to this extension's single
// generic-flow API key (no per-feature key split - there is only one audience here).
export interface NewTabExtensionSettings {
  serverUrl: string;
  apiKey: string;
}

const STORAGE_KEY = "settings";

export async function loadStoredSettings(): Promise<NewTabExtensionSettings | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<NewTabExtensionSettings> | undefined;
  if (!stored?.serverUrl || !stored.apiKey) return null;
  return { serverUrl: stored.serverUrl, apiKey: stored.apiKey };
}

export async function saveSettings(settings: NewTabExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

export async function clearSettings(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

// The server-URL-only draft the options page keeps while a connect attempt is in flight - so a
// page killed by the host-permission prompt (see connect.ts) doesn't lose what the user typed.
const DRAFT_KEY = "draftServerUrl";

export async function loadDraftServerUrl(): Promise<string> {
  const result = await chrome.storage.local.get(DRAFT_KEY);
  const draft = result[DRAFT_KEY];
  return typeof draft === "string" ? draft : "";
}

export async function saveDraftServerUrl(serverUrl: string): Promise<void> {
  await chrome.storage.local.set({ [DRAFT_KEY]: serverUrl });
}

// Strips a trailing slash and any path/query/hash the user might have pasted in - only the
// origin is ever kept, so `${serverUrl}/api/...` concatenation in api.ts always lands on a
// real endpoint regardless of what the user typed (with or without a trailing slash, with or
// without "https://", with a stray "/setup" copied along with the URL from their browser bar).
export function normalizeServerUrl(raw: string): string {
  // Trailing whitespace and slashes in any mix ("host/ /"): stripping only slashes left a
  // trailing space behind, so normalizing twice gave two different results - same property
  // studylife-focus's settings.ts guards against.
  const trimmed = raw.trim().replace(/[\s/]+$/, "");
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}
