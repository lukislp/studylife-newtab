// Options page: the one UI surface for the one-time "Connect" action (and its inverse,
// "Disconnect"). Mirrors studylife-focus's options.ts Connect-button pattern, trimmed to this
// extension's single generic-flow audience (no per-feature tabs).
import { CONNECT_MESSAGE_TYPE } from "./connect";
import { clearPendingConnect, describeConnectResult, requestHostPermission, setPendingConnect, type ConnectResult } from "./connect";
import { fetchWhoami } from "./api";
import { clearSettings, loadDraftServerUrl, loadStoredSettings, normalizeServerUrl, saveDraftServerUrl, type NewTabExtensionSettings } from "./settings";

const connectSection = document.getElementById("connect-section") as HTMLElement;
const connectedSection = document.getElementById("connected-section") as HTMLElement;
const serverUrlInput = document.getElementById("server-url") as HTMLInputElement;
const connectButton = document.getElementById("connect-button") as HTMLButtonElement;
const connectStatus = document.getElementById("connect-status") as HTMLParagraphElement;
const connectedDesc = document.getElementById("connected-desc") as HTMLParagraphElement;
const disconnectButton = document.getElementById("disconnect-button") as HTMLButtonElement;
const disconnectStatus = document.getElementById("disconnect-status") as HTMLParagraphElement;

type StatusKind = "success" | "error" | "";

function setStatus(el: HTMLElement, message: string, kind: StatusKind): void {
  el.textContent = message;
  el.className = kind ? `status ${kind}` : "status";
}

async function render(): Promise<void> {
  const settings = await loadStoredSettings();
  if (settings) {
    await showConnected(settings);
  } else {
    connectedSection.hidden = true;
    connectSection.hidden = false;
    serverUrlInput.value = (await loadDraftServerUrl()) || serverUrlInput.value;
  }
}

async function showConnected(settings: NewTabExtensionSettings): Promise<void> {
  connectSection.hidden = true;
  connectedSection.hidden = false;
  connectedDesc.textContent = `Connected to ${settings.serverUrl}. Checking the key...`;
  const whoami = await fetchWhoami(settings);
  if (whoami.ok) {
    connectedDesc.textContent = `Connected to ${settings.serverUrl} as account #${whoami.data.userId}. Open a new tab to see your stats.`;
  } else {
    connectedDesc.textContent =
      `Connected to ${settings.serverUrl}, but the stored key no longer works` +
      (whoami.kind === "unauthorized" ? " (the server rejected it)." : ` (${whoami.kind}).`) +
      " Disconnect and connect again.";
  }
}

connectButton.addEventListener("click", () => {
  void onConnectClick();
});

async function onConnectClick(): Promise<void> {
  const serverUrl = normalizeServerUrl(serverUrlInput.value);
  if (!serverUrl || !/^https?:\/\//i.test(serverUrl)) {
    setStatus(connectStatus, describeConnectResult({ ok: false, kind: "invalid-url" }), "error");
    return;
  }
  await saveDraftServerUrl(serverUrl);

  connectButton.disabled = true;
  setStatus(connectStatus, "Connecting...", "");

  const originPattern = `${serverUrl}/*`;
  if (!(await chrome.permissions.contains({ origins: [originPattern] }))) {
    // Stake the marker BEFORE prompting: the permission prompt itself steals focus and can close
    // this page before the sendMessage below ever runs. background.ts's
    // chrome.permissions.onAdded listener picks the marker up and finishes the flow regardless
    // of whether this page survives the prompt.
    await setPendingConnect(serverUrl);
    setStatus(connectStatus, "Grant the permission prompt - StudyLife's login page then opens automatically.", "success");
    const granted = await requestHostPermission([originPattern]);
    if (!granted) {
      await clearPendingConnect();
      connectButton.disabled = false;
      setStatus(connectStatus, "Permission to access this server was denied - connecting needs it (click again to retry).", "error");
    }
    return;
  }

  chrome.runtime
    .sendMessage({ type: CONNECT_MESSAGE_TYPE, serverUrl })
    .then((result: ConnectResult) => {
      connectButton.disabled = false;
      setStatus(connectStatus, describeConnectResult(result), result.ok ? "success" : "error");
      if (result.ok) void render();
    })
    .catch(() => {
      connectButton.disabled = false;
      setStatus(
        connectStatus,
        "Lost contact with the extension while connecting - check chrome://extensions for errors and try again.",
        "error",
      );
    });
}

disconnectButton.addEventListener("click", () => {
  void onDisconnectClick();
});

async function onDisconnectClick(): Promise<void> {
  disconnectButton.disabled = true;
  await clearSettings();
  setStatus(disconnectStatus, "Disconnected.", "success");
  disconnectButton.disabled = false;
  await render();
}

void render();
