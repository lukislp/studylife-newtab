// Minimal in-memory stand-in for chrome.storage.local - just enough surface (get/set/remove, each
// keyed by a single string) for settings.ts's stored record and connect.ts's pending-connect
// marker. Cast through `unknown` when assigning to globalThis.chrome since @types/chrome's
// StorageArea type is far wider than what these modules actually call - a full mock would just be
// noise. Also stubs chrome.permissions (contains/request) so connect.ts's requestHostPermission
// is testable without a real browser. Mirrors studylife-focus's tests/chrome-storage-stub.ts.
export function createChromeStorageStub() {
  let local: Record<string, unknown> = {};
  let grantedOrigins: string[] = [];

  return {
    raw: () => local,
    reset: () => {
      local = {};
      grantedOrigins = [];
    },
    grantOrigins: (origins: string[]) => {
      grantedOrigins = [...new Set([...grantedOrigins, ...origins])];
    },
    install: () => {
      (globalThis as unknown as { chrome: unknown }).chrome = {
        storage: {
          local: {
            get: async (key: string) => ({ [key]: local[key] }),
            set: async (items: Record<string, unknown>) => {
              local = { ...local, ...items };
            },
            remove: async (key: string) => {
              const next = { ...local };
              delete next[key];
              local = next;
            },
          },
        },
        permissions: {
          contains: async (query: { origins?: string[] }) =>
            (query.origins ?? []).every((o) => grantedOrigins.includes(o)),
          request: async (query: { origins?: string[] }) => {
            grantedOrigins = [...new Set([...grantedOrigins, ...(query.origins ?? [])])];
            return true;
          },
        },
      };
    },
  };
}
