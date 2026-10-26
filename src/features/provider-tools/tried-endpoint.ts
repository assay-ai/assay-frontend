/**
 * The endpoint a provider tool was tried at ("Paste a curl or OpenAPI and try
 * it"), kept for this browser tab (`sessionStorage`) so the connect step
 * starts from it instead of the account's base address. A curl like
 * `curl "https://api.frankfurter.app/latest?from=GBP&to=JPY"` is tried at
 * `https://api.frankfurter.app/latest`: dropping `/latest` sent the first
 * test to the wrong address (onboarding run 3).
 *
 * Only an origin and a path are kept: never a query, a fragment or a
 * user:password part (the server's own suggestion has none of them either).
 * Every entry is removed on logout.
 */

const PREFIX = "assay:provider-tool-endpoint:";

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** `https://host/path` with no query, fragment or credentials; null when it is not an http(s) address. */
export function cleanEndpoint(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, "");
    const value = `${url.origin}${path}`;
    return value.length > 2048 ? null : value;
  } catch {
    return null;
  }
}

export function rememberTriedEndpoint(toolId: string, endpoint: string | null | undefined): void {
  const value = cleanEndpoint(endpoint);
  if (!value) return;
  try {
    store()?.setItem(`${PREFIX}${toolId}`, value);
  } catch {
    // Blocked storage: the connect step starts from the account's address, as before.
  }
}

export function triedEndpointFor(toolId: string | null | undefined): string | null {
  if (!toolId) return null;
  try {
    return cleanEndpoint(store()?.getItem(`${PREFIX}${toolId}`));
  } catch {
    return null;
  }
}

/** On logout: nothing of the last person's endpoints stays in the tab. */
export function clearTriedEndpoints(): void {
  const storage = store();
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** The path of an address ("/latest"), "" for none or an address that does not parse. */
export function endpointPath(raw: string): string {
  try {
    return new URL(raw.trim()).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}
